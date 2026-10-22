# PLAN — Laravel ERD Viewer (VS Code extension)

> Audience: AI coding agents. This file is the source of truth for scope,
> decisions, contracts and task order. Follow it literally; if reality
> contradicts it, stop and update this file before diverging.

## 0. TL;DR

VS Code extension that statically parses a Laravel project's
`database/migrations/*.php`, rebuilds the final DB schema, and renders an
interactive ER diagram in a webview (tables, columns, PK/FK, relations).
No PHP, no DB connection required.

## 1. Locked decisions

| Topic | Decision |
|---|---|
| Name / display name | **Laravel ERD Viewer** |
| Extension ID (`name`) | `laravel-erd-viewer` |
| Command/config prefix | `laravelErd` |
| Primary input | Laravel migrations (PHP) |
| MVP scope | **Laravel only.** DBML is post-MVP. |
| Eloquent models as relation source | **Deferred** (not in MVP or V1) |
| PHP parsing | `php-parser` (glayzzle, pure JS) → AST. No regex-based parsing, no PHP runtime |
| Webview UI | React + TypeScript + `@xyflow/react` (React Flow) |
| Auto layout | `elkjs` (layered algorithm) |
| Build | `esbuild` for extension host, `vite` for webview |
| Tests | `vitest` (core), `@vscode/test-electron` (e2e) |
| Language | TypeScript, `strict: true` |
| Package manager | `npm` |
| Min VS Code | `engines.vscode: ^1.85.0` |
| Distribution | Personal use now; **must stay Marketplace-ready** (MIT license, README, icon, no hardcoded paths/secrets) |

Verify latest stable versions of dependencies at install time; do not pin
from memory.

## 2. Scope

### In scope (MVP)
- Command `Laravel ERD: Show Diagram` opens a webview panel.
- Auto-detect `database/migrations` in workspace (setting override).
- Parse P0 + P1 schema builder calls (section 6).
- Rebuild final schema by applying migrations in filename order.
- Draw tables, columns (type, PK/FK, nullable, unique), and FK relations.
- Auto-refresh on migration file create/change/delete (debounced).
- Click table/column → open migration file at the source line.
- Table search, highlight neighbors on selection, parse-warnings panel.
- Theme-aware (light/dark via `--vscode-*` CSS vars).

### Out of scope / Non-goals (until explicitly requested)
- DBML import/export/custom editor (planned **Phase 7+**, after MVP).
- Reading Eloquent models.
- Live DB introspection, running `artisan`, executing PHP.
- Editing migrations from the diagram (read-only viewer).
- Non-Laravel frameworks.

## 3. Architecture

```
database/migrations/*.php
        │  (php-parser AST)
        ▼
  core/laravel/parser  →  core/laravel/interpreter  →  Schema IR
                                                        │
              extension host (vscode API) ◄─────────────┘
                     ▲  │ postMessage (typed protocol, §5)
                     │  ▼
                 webview (React + React Flow + ELK)
```

Layering rules (enforce strictly):
1. `src/core/**` MUST NOT import `vscode`, DOM, or Node-only UI APIs. Pure
   TS functions: `(files: {path, content}[]) => ParseResult`.
2. `src/webview/**` MUST NOT import `vscode` or `src/extension/**`. It
   communicates only through the message protocol in §5.
3. `src/extension/**` is the only layer touching `vscode`, the filesystem and
   file watching. It reads files, calls `core`, and posts results to webview.
4. Shared types live in `src/shared/` (IR + protocol) and are imported by all
   layers.

## 4. Data contracts — Schema IR (`src/shared/model.ts`)

```ts
export interface SourceRef {
  file: string;        // workspace-relative path, forward slashes
  migration: string;   // file basename without .php
  line: number;        // 1-based
  column: number;      // 1-based
}

export interface Column {
  name: string;
  type: string;                 // normalized: 'bigInteger','string','uuid',...
  rawMethod: string;            // original blueprint method, e.g. 'foreignId'
  length?: number;
  precision?: number;
  scale?: number;
  enumValues?: string[];
  nullable: boolean;
  default?: string | number | boolean | null | { raw: string };
  unsigned: boolean;
  autoIncrement: boolean;
  primary: boolean;
  unique: boolean;
  index: boolean;
  comment?: string;
  source: SourceRef;
}

export interface Index {
  name?: string;
  kind: 'primary' | 'unique' | 'index' | 'fulltext' | 'spatial';
  columns: string[];
  source: SourceRef;
}

export interface Table {
  name: string;
  columns: Column[];            // in declaration order
  indexes: Index[];
  comment?: string;
  source: SourceRef;            // the Schema::create call
}

export interface Relation {
  id: string;                                   // deterministic: `${from.table}.${from.column}->${to.table}.${to.column}`
  from: { table: string; column: string };      // FK side (child)
  to:   { table: string; column: string };      // referenced side (parent)
  kind: 'explicit' | 'inferred' | 'polymorphic';
  cardinality: '1:N' | '1:1';                   // 1:1 if FK column is unique
  onDelete?: string;                            // 'cascade' | 'set null' | 'restrict' | 'no action'
  onUpdate?: string;
  source?: SourceRef;
}

export interface Warning {
  code: 'UNSUPPORTED_CALL' | 'DYNAMIC_VALUE' | 'PARSE_ERROR'
      | 'UNKNOWN_TABLE' | 'UNKNOWN_COLUMN' | 'RAW_SQL';
  message: string;
  source: SourceRef;
}

export interface SchemaIR {
  tables: Table[];
  relations: Relation[];
  warnings: Warning[];
  migrationsApplied: string[];  // ordered
}
```

Invariants:
- Output is **deterministic** (stable ordering: tables by first-creation
  order, columns by declaration order).
- Parser never throws on user code; failures become `Warning`s and the file
  is skipped or partially applied.
- Lookups of tables/columns are case-sensitive on exact names as written.

## 5. Webview message protocol (`src/shared/protocol.ts`)

```ts
// extension → webview
type ToWebview =
  | { type: 'schema'; schema: SchemaIR; layout: SavedLayout | null }
  | { type: 'loading'; value: boolean }
  | { type: 'error'; message: string };

// webview → extension
type ToExtension =
  | { type: 'ready' }
  | { type: 'openSource'; source: SourceRef }
  | { type: 'saveLayout'; layout: SavedLayout }
  | { type: 'refresh' };

interface SavedLayout {
  version: 1;
  nodes: Record<string /* table name */, { x: number; y: number }>;
}
```

Flow: webview posts `ready` → extension replies `schema`. Extension pushes a
new `schema` on every debounced file change. Layout persisted to
`.vscode/laravel-erd.layout.json` (written by extension only).

## 6. Parsing & interpretation spec (`src/core/laravel/`)

### 6.1 Pipeline
1. Collect `*.php` in migrations dir; sort ascending by basename.
2. For each file: `php-parser` → AST (with `withPositions: true`). On syntax
   error → `PARSE_ERROR` warning, continue.
3. Locate `up()` method (anonymous `return new class extends Migration` and
   named classes). **Ignore `down()`.**
4. Walk `up()` for static calls on `Schema` (`create`, `table`, `drop`,
   `dropIfExists`, `rename`); optionally `Schema::connection('x')->…`.
5. For `create`/`table`, interpret the closure body: each statement is a call
   chain rooted at the closure's Blueprint param (e.g. `$table`). Chains are
   `base method → modifiers…`.
6. Apply operations to an in-memory `Map<string, Table>`.
7. After all files: resolve relations, run inference, emit `SchemaIR`.

### 6.2 Value resolution
- Resolve string/number/bool/null literals, arrays of literals,
  `Class::class` (→ string), and simple local `$var = 'literal'` assignments.
- Anything else → `{ raw: <source text> }` or `DYNAMIC_VALUE` warning if the
  table/column name itself is unresolvable (then skip that operation).

### 6.3 Blueprint support matrix

| Pri | Methods |
|---|---|
| P0 columns | `id`, `bigIncrements`, `increments`, `mediumIncrements`, `smallIncrements`, `tinyIncrements`, `uuid`, `ulid`, `string`, `char`, `text`, `mediumText`, `longText`, `tinyText`, `integer`, `bigInteger`, `mediumInteger`, `smallInteger`, `tinyInteger`, `unsignedInteger`, `unsignedBigInteger`, `unsignedSmallInteger`, `unsignedTinyInteger`, `boolean`, `decimal`, `double`, `float`, `date`, `dateTime`, `dateTimeTz`, `time`, `timeTz`, `timestamp`, `timestampTz`, `year`, `json`, `jsonb`, `binary`, `enum`, `set`, `ipAddress`, `macAddress` |
| P0 composite | `timestamps`, `timestampsTz`, `nullableTimestamps`, `softDeletes`, `softDeletesTz`, `rememberToken`, `morphs`, `nullableMorphs`, `uuidMorphs`, `nullableUuidMorphs`, `ulidMorphs`, `nullableUlidMorphs` |
| P0 foreign | `foreignId`, `foreignUuid`, `foreignUlid`, `foreignIdFor` (+ `->constrained()`, `->references()->on()`), `foreign()->references()->on()` |
| P0 modifiers | `nullable`, `default`, `unsigned`, `unique`, `index`, `primary`, `comment`, `autoIncrement`, `useCurrent`, `useCurrentOnUpdate`, `after`, `first`, `charset`, `collation`, `cascadeOnDelete`, `cascadeOnUpdate`, `restrictOnDelete`, `nullOnDelete`, `noActionOnDelete`, `onDelete`, `onUpdate` |
| P0 table-level | `$table->primary([...])`, `unique([...])`, `index([...])`, `fullText`, `spatialIndex` |
| P1 alter | `dropColumn`, `renameColumn`, `->change()`, `dropForeign`, `dropIndex`, `dropUnique`, `dropPrimary`, `dropTimestamps`, `dropSoftDeletes`, `dropRememberToken`, `dropMorphs`, `renameIndex` |
| P1 schema | `Schema::rename`, `Schema::drop`, `Schema::dropIfExists`, multiple `Schema::*` per file, `Schema::table` on tables created earlier |
| P2 | `Schema::hasTable/hasColumn` conditionals (assume true-branch applied, emit warning), `DB::statement/unprepared` (→ `RAW_SQL` warning, ignored), `Schema::connection()`, `Schema::createIfNotExists`-style helpers |

Type normalization: map every column method to a stable `type` string
(e.g. `id`/`bigIncrements`/`foreignId` → `bigInteger`+`unsigned`+
(`autoIncrement` for id/increments)). Keep `rawMethod` for display/tooltip.

Special expansions:
- `id()` → column `id`, bigInteger, unsigned, autoIncrement, primary. (First
  arg overrides name.)
- `timestamps()` → `created_at`, `updated_at` (timestamp, nullable).
- `softDeletes()` → `deleted_at` (timestamp, nullable) or custom name.
- `rememberToken()` → `remember_token` string(100) nullable.
- `morphs('x')` → `x_type` string, `x_id` bigInteger unsigned, index;
  `uuidMorphs`/`ulidMorphs` → `x_id` uuid/ulid. Nullable variants set nullable.
  Also record a `polymorphic` relation marker (see 6.4).
- `foreignId('user_id')->constrained()` → FK to table inferred by pluralizing
  the name without `_id` (`user_id`→`users`); `constrained('t', 'c')` overrides.
- `foreignIdFor(Model::class)` → column `<snake_model>_id`, target table =
  pluralized snake model name (best effort; emit inferred relation).

### 6.4 Relations & inference
1. **Explicit** relations come from `constrained`, `foreign()->references()->on()`,
   `foreignId()->references()->on()`. Copy `onDelete/onUpdate`.
2. If FK column has `unique` (inline or via index) → cardinality `1:1`.
3. `dropForeign` removes the relation (match by column or by index name).
4. **Inferred** (toggle `laravelErd.inferRelations`, default `true`): column
   named `<singular>_id` with no explicit relation and whose pluralized table
   exists → relation `kind: 'inferred'`. Use a pluralization lib (e.g.
   `pluralize`); match both singular→plural and exact table name.
5. **Polymorphic**: `morphs` produce a relation record with
   `kind: 'polymorphic'`, `to.table: '*'`. Webview renders as a badge on the
   column, **not** as an edge.
6. Pivot detection (UI hint only): table with exactly two FK columns and
   name equal to the two singular names joined by `_` → flag `isPivot` in
   the view model.
7. Relation to a missing table → keep relation, emit `UNKNOWN_TABLE`.

## 7. Webview spec (`src/webview/`)

- Stack: React 18+, TS, `@xyflow/react`, `elkjs`, plain CSS (VS Code theme
  variables). No UI kit.
- Custom node `TableNode`: header (table name), rows for each column with
  icons (PK 🔑 / FK 🔗), name, type (muted), nullable/unique markers.
  Per-column source/target `Handle`s so edges attach to the exact row.
- Custom edge `RelationEdge`: crow's-foot/cardinality markers; dashed style for
  `inferred`; label on hover with `onDelete`.
- Layout: ELK `layered`, direction RIGHT, run in a worker or async;
  apply saved positions over ELK output; new tables use ELK positions.
- Interactions: pan/zoom, minimap, drag nodes (→ debounced `saveLayout`),
  search box (focus + center table), click select → dim non-neighbors,
  double-click column/table header → `openSource`.
- Panels: warnings list (click → `openSource`), toolbar (refresh,
  re-layout, toggle inferred relations, fit view).
- All interactive elements get unique, descriptive `id`s / `data-testid`.
- Accessibility: keyboard focusable toolbar, sufficient contrast.

## 8. Extension host spec (`src/extension/`)

- `activate()` registers commands:
  - `laravelErd.show` — open/reveal panel (single panel instance)
  - `laravelErd.refresh`
  - `laravelErd.resetLayout`
- Activation events: `onCommand:*`, `workspaceContains:artisan` (and
  `workspaceContains:database/migrations`).
- `contributes.configuration`:
  - `laravelErd.migrationsPath` (string, default `database/migrations`)
  - `laravelErd.inferRelations` (boolean, default `true`)
  - `laravelErd.hideTables` (string[], default `[]`; suggested preset for
    framework tables: `jobs`, `job_batches`, `failed_jobs`, `cache`,
    `cache_locks`, `sessions`, `password_reset_tokens`, `migrations`)
- `FileSystemWatcher` on `<migrationsPath>/**/*.php`; debounce 300 ms;
  re-parse all (cache per-file AST/ops by content hash).
- Webview HTML: strict CSP with nonce, `localResourceRoots` = built webview
  dir, assets via `asWebviewUri`. No remote resources.
- `openSource`: `vscode.window.showTextDocument` with selection at
  `source.line/column`.
- Multi-root: pick the folder containing the migrations path; if several,
  prompt with QuickPick.

## 9. Repo layout

```
larader_viewer/
├─ PLAN.md                    # this file (keep in sync)
├─ AGENTS.md                  # short rules for agents (derived from §12)
├─ package.json               # extension manifest + scripts
├─ tsconfig.json  tsconfig.webview.json
├─ esbuild.mjs  vite.config.ts  vitest.config.ts
├─ .vscodeignore  .gitignore  LICENSE (MIT)  README.md  CHANGELOG.md
├─ media/icon.png
├─ src/
│  ├─ shared/        model.ts  protocol.ts
│  ├─ core/laravel/  parse.ts  interpreter.ts  blueprint.ts  resolve-values.ts
│  │                 relations.ts  naming.ts  index.ts
│  ├─ extension/     extension.ts  panel.ts  watcher.ts  config.ts  layout-store.ts
│  └─ webview/       main.tsx  App.tsx  nodes/TableNode.tsx  edges/RelationEdge.tsx
│                    layout/elk.ts  components/{Toolbar,Search,Warnings}.tsx  styles.css
└─ test/
   ├─ fixtures/laravel/<case>/*.php   (+ expected.json per case)
   ├─ core/*.test.ts
   └─ e2e/*.test.ts
```

npm scripts (target): `build`, `build:ext`, `build:webview`, `watch`,
`test`, `test:e2e`, `lint`, `package` (`vsce package`).

## 10. Phased task list (execute in order; each phase must be green before next)

Legend: `[ ]` todo. Each task lists **Acceptance** (verifiable).

### Phase 1 — Scaffold
- [x] Init `package.json`, TS configs, esbuild (ext) + vite (webview),
  `.vscode/launch.json` (F5 Extension Host), `.vscode/tasks.json`.
- [x] Register `laravelErd.show` opening a webview that renders "Hello" from
  built React bundle with strict CSP.
- **Acceptance:** F5 launches host; command shows panel with React content; `npm run build` succeeds. (Verified)

### Phase 2 — Core parser (create-only)
- [x] `shared/model.ts` types per §4.
- [x] Parse files with `php-parser`; find `up()`; handle anonymous + named class.
- [x] Interpret `Schema::create` with P0 columns/composites/modifiers.
- [x] Fixtures: Laravel default migrations (users, cache, jobs), a blog schema
  (posts/comments/tags/post_tag), morphs example.
- **Acceptance:** `vitest` snapshot tests produce expected `SchemaIR` for all fixtures; no exceptions on malformed PHP. (Verified)

### Phase 3 — Relations
- [x] Explicit FK (`constrained`, `foreign()->references()->on()`), actions, 1:1 detection.
- [x] Inference + pluralization, polymorphic markers, unknown-table warning.
- **Acceptance:** tests cover each rule in §6.4. (Verified)

### Phase 4 — Alterations & ordering
- [x] `Schema::table` add/drop/rename/change columns, indexes, FKs.
- [x] `drop`, `dropIfExists`, `rename`; filename-order application.
- **Acceptance:** fixture with create→alter→rename→drop yields correct final IR; `SourceRef` points to the *last effective* declaration for each column. (Verified)

### Phase 5 — Webview MVP (visual)
- [x] `shared/protocol.ts`; extension reads files → core → posts `schema`.
- [x] `TableNode`, `RelationEdge`, ELK layout, pan/zoom/minimap.
- **Acceptance:** opening panel on a real Laravel project shows all tables and edges; no overlapping nodes after initial layout. (Verified)

### Phase 6 — Interactions & live updates
- [x] Watcher + debounce, `openSource`, search, neighbor highlight, warnings panel, `hideTables`, layout persistence (`saveLayout`/`resetLayout`).
- **Acceptance (MVP done):** editing/saving a migration updates the diagram ≤1 s; clicking a column opens correct file/line; dragged positions survive reload. (Verified)

### Phase 7 — Export (post-MVP)
- [x] Export SVG/PNG, Mermaid `erDiagram`, **DBML** (IR → DBML text).
- **Acceptance:** exported DBML validates with `@dbml/core` parser. (Verified)

### Phase 8 — DBML import & custom editor (post-MVP)
- [ ] `@dbml/core` parse → IR; custom readonly editor for `*.dbml`.
- **Acceptance:** sample `.dbml` renders in same webview.

### Phase 9 — Release polish
- [ ] Icon, README with GIFs, CHANGELOG, MIT LICENSE, `repository`/`publisher`/`categories`/`keywords` in manifest, `vsce package` clean (no warnings), publish to Marketplace + Open VSX.
- **Acceptance:** `.vsix` installs in a clean VS Code profile and works on a sample project.

Backlog (not scheduled): focus mode (table + N-hop neighbors), group by
prefix, schema-at-migration slider/diff, Eloquent model relations, live DB
introspection.

## 11. Testing strategy

- **Unit (core):** table-driven tests per Blueprint method; golden `expected.json` per fixture dir. Include "dirty" fixtures (loops, conditionals, `DB::statement`, syntax errors) asserting warnings, not throws.
- **Determinism test:** parsing the same input twice yields deep-equal IR.
- **Perf budget:** 1000 migrations / 300 tables parse < 2 s (cold), < 300 ms incremental.
- **E2E:** open fixture workspace, run `laravelErd.show`, assert webview receives `schema` with expected table count.
- **Webview:** component tests for `TableNode` (vitest + testing-library) optional.

## 12. Agent working rules

1. Respect layering (§3). Never import `vscode` in `core` or `webview`.
2. Read this plan before editing; keep `PLAN.md` checkboxes updated as tasks complete.
3. Do not add features from "Out of scope" or "Backlog" unprompted.
4. Prefer small, tested increments: add fixture + failing test → implement → pass.
5. No regex parsing of PHP; always use the AST.
6. Never execute user PHP or shell out to `php`/`artisan`.
7. Parsing must be total: no uncaught exceptions on any input.
8. Keep IR and protocol types in `src/shared/` as the only cross-layer contract; change them first, then dependents.
9. Webview CSP: no inline scripts without nonce, no remote assets.
10. When unsure about Laravel semantics, check the official Schema Builder docs (`laravel.com/docs/migrations`) rather than guessing.
11. After each phase, run `npm run build && npm test` and report results.
12. Keep code comments/docs in English.

## 13. Risks

| Risk | Mitigation |
|---|---|
| Dynamic migrations (loops, raw SQL, conditionals) | Warnings (§4), skip safely, document limits in README |
| Huge schemas unreadable | `hideTables`, neighbor highlight, minimap; focus mode in backlog |
| Layout lost on refresh | Persist by table name; ELK only positions unsaved tables |
| Laravel syntax drift across versions | Centralized method table in `blueprint.ts`; fixtures per Laravel major |
| `php-parser` gaps (new PHP syntax) | Catch per-file, warn, continue; pin & test version |
| Pluralization wrong for irregular names | Allow explicit `constrained()` priority; inferred edges are visually distinct and toggleable |

## 14. Open items (non-blocking)

- Final `publisher` ID for Marketplace (needed only at Phase 9).
- Icon/branding assets (generate in Phase 9).
