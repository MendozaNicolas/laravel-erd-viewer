# PLAN — Export: SQL, SVG, PNG, PDF (Laravel ERD Viewer)

> Audience: AI coding agents. Extends `PLAN.md`. Same rules apply (layering,
> AST-only parsing, parsing never throws). Do not start a phase before the
> previous one is green (`npm run lint && npm test && npm run build`).

## 0. Goal

1. **SQL export**: generate classic `CREATE TABLE` DDL (columns, PK, unique,
   indexes, FKs) from the parsed `SchemaIR`, per SQL dialect.
2. **Image/document export**: export the ER diagram as **SVG, PNG, PDF**,
   oriented to **technical documentation readable by project managers**
   (clean, print-friendly, titled, legend, indexes), not a screenshot of the
   dark editor UI.

Existing: `core/export/dbml.ts`, `core/export/mermaid.ts`, commands
`laravelErd.exportDbml`, `laravelErd.exportMermaid`. They stay; they get
folded into the same export registry/UI (Phase 6).

## 1. Decisions (LOCKED after user review — see §13)

| Topic | Decision |
|---|---|
| SQL dialects v1 | **MySQL (8.x), PostgreSQL, SQLite**. SQL Server is **out of scope** for now |
| SQL generation location | `src/core/export/sql/` (pure TS, no `vscode`) → works without opening the panel |
| SVG generation | **Static renderer in core** (`src/core/render/`): `SchemaIR → SVG string`. Deterministic, independent of React Flow / VS Code theme |
| Layout engine for export | Reuse ELK (`elkjs`, works in Node and browser). Move layout logic from `webview/layout/elk.ts` to a shared module |
| Layout mode (`layoutMode`) | **`fresh`** (default: new ELK layout, consistent docs) or **`saved`** (use the user's manual positions from `.vscode/laravel-erd.layout.json`). **The user is always asked** (QuickPick / Export dialog); `saved` is offered only if a saved layout file exists |
| PNG | Rasterize the SVG in the **webview** (offscreen `<canvas>`), scale ×1/×2/×3/×4 |
| PDF | **jsPDF + svg2pdf.js** in the webview (vector, pure JS, no native deps) + `jspdf-autotable` for documentation tables |
| File saving | Always in extension host: `showSaveDialog` → `workspace.fs.writeFile` → toast with *Open* / *Reveal* |
| Export theme | Independent of editor theme: `light` (default, print), `grayscale`, `dark` |
| Fonts in exports | Standard safe stack only (Helvetica/Arial + monospace). No webfonts, no emoji/icon glyphs (PDF Unicode safety). Spanish accents must render correctly |
| i18n of documentation labels | `en` (default) and `es` shipped from the start via `laravelErd.export.language` |
| PDF engine | webview **jsPDF + svg2pdf.js** (confirmed) |
| Descriptions for PMs | Only from Laravel `->comment()` (table + column). **No sidecar docs file** for now |
| Inferred relations in SQL | **Excluded by default** (not real constraints); optional flag |
| Polymorphic relations | Never emitted as FK; documented as notes in PDF |

## 2. Non-goals (this plan)

- Executing SQL, connecting to a DB, or diffing against a real DB.
- Editing schema from the UI.
- SQL Server / Oracle dialects (backlog).
- Exporting Eloquent-derived relations (still deferred).
- Interactive HTML export (backlog).
- Sidecar business-description file (`.vscode/laravel-erd.docs.json`) (backlog).
- SQL Server dialect (backlog).

## 3. Prerequisites — Phase 0 (must fix before SQL work)

Verified in current code:

1. **Type normalization bug** — `core/laravel/blueprint.ts`:
   `unsignedBigInteger` produces `type = 'biginteger'` (lowercase via
   `methodName.replace('unsigned','').toLowerCase()`) while `bigInteger`
   produces `'bigInteger'`. Unsigned variants must map to canonical camelCase
   (`bigInteger`, `integer`, `mediumInteger`, `smallInteger`, `tinyInteger`).
   Add regression tests.
2. **Canonical type model**: define in `src/shared/model.ts` a closed union
   `ColumnType` (e.g. `'bigInteger' | 'integer' | ... | 'string' | 'text' |
   'decimal' | 'json' | 'uuid' | 'enum' | ...`) instead of free `string`, plus
   `unknown` fallback (emit warning + safe SQL type `TEXT`). Keep `rawMethod`.
3. **Laravel defaults**: apply when args omitted: `string` length 255,
   `char` 255, `decimal` (8,2), `timestamp/dateTime` precision (nullable int).
   Store resolved values in IR (`length`, `precision`, `scale`).
4. **Table comment**: parse `$table->comment('...')` (Laravel 11+) into
   `Table.comment` (field already exists). Column `->comment()` already parsed.
5. **Shared layout module**: extract ELK layout to `src/core/layout/` (no DOM),
   used by webview and by the static renderer.
6. **Export registry**: `src/core/export/index.ts` exposing
   `exportSql(schema, opts)`, `exportDbml`, `exportMermaid`, `renderSvg(schema, opts)`.
7. **Export options type** in `src/shared/export-options.ts` (see §9).

Acceptance: tests green; existing fixtures unchanged except the normalized
types; new fixture `types/` covering every column method → expected canonical type.

## 4. Architecture

```
SchemaIR ──► core/export/sql/{mysql,postgres,sqlite}.ts ──► string
SchemaIR ──► core/layout (ELK) ──► core/render/svg.ts ──► SVG string
                                         │
        extension host (vscode)          ▼
  commands ─ QuickPick options ─► panel (webview) ─ rasterize PNG / build PDF
        ▲                                │  postMessage { exportSave, bytes }
        └──────── showSaveDialog + writeFile ◄───────────┘
```

Rules:
- SQL and SVG: generated **in the extension host** (pure core) → commands work
  with no panel open. No webview round-trip.
- PNG/PDF: need canvas/DOM → performed in webview. If the panel is closed,
  the command opens the panel first, waits for `ready`, then posts the export
  request.
- Binary data crosses `postMessage` as `base64` string (`{type:'exportSave',
  format, suggestedName, encoding:'base64'|'utf8', data}`).
- `src/core/render/**` MUST NOT import `vscode` or touch DOM. Text width is
  estimated with a fixed metrics table (avg char width per font size), with
  ellipsis truncation, so output is deterministic across machines.

### Protocol additions (`src/shared/protocol.ts`)

```ts
// extension → webview
| { type: 'export'; format: 'png' | 'pdf'; options: ExportOptions; schema: SchemaIR }
// webview → extension
| { type: 'exportSave'; format: 'png' | 'pdf'; suggestedName: string;
    encoding: 'base64'; data: string }
| { type: 'exportError'; format: string; message: string }
```

## 5. SQL export (`src/core/export/sql/`)

### 5.1 Output shape
- Header comment: tool name, generation date (ISO), dialect, table count,
  last migration applied, disclaimer: *"Derived statically from migrations; may
  differ from the real database."*
- Per table: `DROP TABLE IF EXISTS` (optional) + `CREATE TABLE [IF NOT EXISTS]`.
- Columns in declaration order; PK (single inline or composite constraint);
  `UNIQUE` constraints; `CREATE INDEX` statements after tables.
- **FK strategy** (`fkMode`): `alter` (default: all `CREATE TABLE` first, then
  `ALTER TABLE ... ADD CONSTRAINT ... FOREIGN KEY`, order-independent and
  cycle-safe) or `inline` (tables topologically sorted; cycles fall back to alter).
  SQLite: always `inline` (no ADD CONSTRAINT support) with topological order.
- Constraint/index names follow Laravel: `{table}_{cols}_foreign|unique|index|primary`
  (truncate to dialect max identifier length: MySQL 64, PG 63).
- FK actions from `onDelete/onUpdate` (`CASCADE`, `SET NULL`, `RESTRICT`, `NO ACTION`).
- Relation to a missing table (`UNKNOWN_TABLE`) → FK omitted, SQL comment left.
- `inferred` relations → omitted unless `includeInferredFks: true`.
- `polymorphic` → never.
- Identifier quoting: MySQL `` `x` ``, PG/SQLite `"x"`. Escape quotes.
- Defaults: strings quoted/escaped; numbers raw; booleans per dialect;
  `{raw}` (e.g. `CURRENT_TIMESTAMP`) emitted unquoted.
- Comments: MySQL inline `COMMENT '...'` (column + table); PG `COMMENT ON
  COLUMN/TABLE` statements; SQLite → SQL `-- comments` above the column/table.
- MySQL extras (options): `ENGINE=InnoDB`, `DEFAULT CHARSET=utf8mb4`,
  `COLLATE=utf8mb4_unicode_ci`.

### 5.2 Type mapping (verify against Laravel's `Illuminate/Database/Schema/Grammars/*`)

| Canonical | MySQL | PostgreSQL | SQLite |
|---|---|---|---|
| bigInteger (+id/foreignId) | `BIGINT [UNSIGNED]` + `AUTO_INCREMENT` | `BIGINT` / `BIGSERIAL` if autoInc | `INTEGER` (`INTEGER PRIMARY KEY AUTOINCREMENT` when autoInc PK) |
| integer | `INT [UNSIGNED]` | `INTEGER` / `SERIAL` | `INTEGER` |
| mediumInteger | `MEDIUMINT` | `INTEGER` | `INTEGER` |
| smallInteger | `SMALLINT` | `SMALLINT` / `SMALLSERIAL` | `INTEGER` |
| tinyInteger | `TINYINT` | `SMALLINT` | `INTEGER` |
| string(n) | `VARCHAR(n)` | `VARCHAR(n)` | `VARCHAR(n)` |
| char(n) | `CHAR(n)` | `CHAR(n)` | `VARCHAR(n)` |
| text / mediumText / longText / tinyText | `TEXT` / `MEDIUMTEXT` / `LONGTEXT` / `TINYTEXT` | `TEXT` | `TEXT` |
| boolean | `TINYINT(1)` | `BOOLEAN` | `INTEGER` |
| decimal(p,s) | `DECIMAL(p,s)` | `NUMERIC(p,s)` | `NUMERIC` |
| float / double | `FLOAT` / `DOUBLE` | `REAL`-class / `DOUBLE PRECISION` | `REAL` |
| date / time / year | `DATE` / `TIME` / `YEAR` | `DATE` / `TIME(0)` / `INTEGER` | `DATE` / `TIME` / `INTEGER` |
| dateTime / timestamp | `DATETIME` / `TIMESTAMP` | `TIMESTAMP(0) WITHOUT TIME ZONE` | `DATETIME` |
| *Tz variants | same as base | `... WITH TIME ZONE` | `DATETIME` |
| json / jsonb | `JSON` | `JSON` / `JSONB` | `TEXT` |
| uuid / ulid | `CHAR(36)` / `CHAR(26)` | `UUID` / `CHAR(26)` | `VARCHAR(36)` / `VARCHAR(26)` |
| enum(values) | `ENUM('a','b')` | `VARCHAR(255) CHECK (col IN (...))` | `TEXT CHECK (col IN (...))` |
| binary | `BLOB` | `BYTEA` | `BLOB` |
| ipAddress / macAddress | `VARCHAR(45)` / `VARCHAR(17)` | same | same |
| unknown | `TEXT` + warning comment | `TEXT` | `TEXT` |

`unsigned` only affects MySQL (ignored elsewhere; PG/SQLite emit no CHECK by default).

### 5.3 API

```ts
export type SqlDialect = 'mysql' | 'postgres' | 'sqlite';
export interface SqlExportOptions {
  dialect: SqlDialect;
  fkMode: 'alter' | 'inline';
  dropIfExists: boolean;
  ifNotExists: boolean;
  includeInferredFks: boolean;
  includeComments: boolean;
  mysql?: { engine: string; charset: string; collation: string };
}
export function exportSql(schema: SchemaIR, opts: SqlExportOptions): string;
```

### 5.4 Commands / UX
- `laravelErd.exportSql`: QuickPick dialect → QuickPick extras (toggle list) →
  destination: **Save as .sql** / **Open in editor (untitled, language `sql`)** /
  **Copy to clipboard**.
- Default filename: `<project>-schema-<dialect>.sql`.

## 6. Static SVG renderer (`src/core/render/`)

Single source of truth for SVG/PNG/PDF diagrams.

- Input: `SchemaIR` + `RenderOptions` (§9). Output: self-contained SVG string
  (`<svg xmlns viewBox>`, no external refs, no scripts, inline styles/attrs).
- Layout via shared ELK module. Behavior depends on `layoutMode`:
  - `fresh` (default): ELK computes node positions **and** orthogonal edge
    routes (reuse ELK sections).
  - `saved`: positions come from the saved layout (`SavedLayout.nodes`,
    loaded by the host via `layout-store`). Tables missing from the saved
    layout are placed by ELK (same as the live UI). Positions are filtered by
    scope and translated so the bounding box starts at the origin. Because
    ELK routes are invalid for manual positions, edges are re-routed with
    simple orthogonal elbow paths computed from final node boxes/column ports.
    Export cards can differ in size from UI cards (`columnMode`, source line),
    so run an **overlap-resolution pass** (push-apart) and emit a note if any
    card had to be moved.
  - The renderer receives `savedPositions?: Record<string,{x:number;y:number}>`
    as a plain parameter (core stays free of `vscode`).
- Table card: header (name), optional source line (migration file, small
  muted text), rows (icon-free PK/FK text badges `PK`/`FK`, name, type,
  `NULL`/`UQ` badges). Column display modes (`columnMode`):
  `all` | `keys` (PK/FK/unique only) | `names` | `none` (headers only).
- Edges: crow's-foot markers (`1` / `N`), dashed for inferred, label optional.
  Polymorphic columns get a small `∗`-free text badge `poly` (no special glyphs).
- Themes: `light` (white bg, dark text, blue headers), `grayscale` (printer
  friendly), `dark` (matches editor).
- Title block (optional): title, subtitle, date, legend (PK, FK, nullable,
  inferred/dashed). Legend is part of the SVG.
- Scoping (`scope`): `all` | `selection` (tables + `neighborDepth` hops) |
  `tables` (explicit list) ; plus `hideTables` and a `hideFrameworkTables`
  preset (`jobs, job_batches, failed_jobs, cache, cache_locks, sessions,
  password_reset_tokens, migrations, personal_access_tokens`).
- Determinism: same input ⇒ byte-identical SVG (stable ids, no random,
  fixed number formatting).
- Command `laravelErd.exportSvg` (host-side, no panel needed).

## 7. PNG export

- Webview: `SVG string → Blob(image/svg+xml) → Image → <canvas> → toBlob('image/png')`.
- Options: `scale` (1–4, default 2), `background` (`white` | `transparent`).
- Guards: Chromium canvas limits (~16 384 px per side, ~268 M px area).
  If exceeded: reduce scale automatically, warn the user, and suggest SVG/PDF.
- CSP change required: add `blob:` and `data:` to `img-src` (already `data:`).
- Command `laravelErd.exportPng` (opens panel if needed).

## 8. PDF export (project-manager documentation)

Two modes (`pdfMode`):

### 8.1 `diagram` — diagram only
- Paper: `A4 | A3 | A2 | Letter | Tabloid`, orientation `landscape|portrait|auto`.
- Fit-to-page vector diagram (svg2pdf), title block, legend, page footer
  (`Page x of y`, generation date).
- If diagram too dense for the paper: option `tiling` (multi-page tiles with
  overlap + page grid labels) or scale down with warning.

### 8.2 `documentation` — technical documentation (default for PMs)
1. **Cover page**: project title (from `composer.json` `name` → fallback
   workspace folder), subtitle "Database Schema Documentation", generation
   date, author (setting), optional logo (setting path), summary KPIs:
   tables, columns, relations, migrations applied; Laravel version
   (from `composer.json` `laravel/framework` constraint, best effort).
2. **Overview ERD**: full diagram page (paper size configurable), legend.
3. **Table index**: alphabetical list: table, #columns, #relations in/out,
   description (from table comment), source migration.
4. **Table sections** (one per table; page break control):
   - Description (table comment) + source migration file.
   - Columns table via `jspdf-autotable`: Name | Type | Null | Default | Key | Notes
     (notes = column comment).
   - Relationships: "References" (outgoing FKs with ON DELETE/UPDATE) and
     "Referenced by" (incoming).
   - Optional mini-diagram: table + 1-hop neighbors (SVG→PDF).
5. **Appendix**: legend, glossary of types, list of parse warnings (optional),
   notes on polymorphic relations, disclaimer that the doc is derived from
   migrations.
- `audience` option: `technical` (raw types `varchar(255)`) vs `business`
  (humanized types: "Text (max 255)", "Whole number", "Date and time",
  "Yes/No", "Decimal (10,2)", "Unique identifier"). Mapping table lives in
  `src/core/export/humanize-types.ts` (en/es).
- Labels localized (`en`/`es`) via `src/core/export/i18n.ts`.
- PDF metadata: title, author, subject, keywords, creation date; bookmarks
  (outline) per table + clickable index links (jsPDF internal links).
- Fonts: jsPDF standard `helvetica`/`courier` (WinAnsi, covers Spanish
  accents). Sanitize text: replace unsupported glyphs with ASCII fallbacks.
- Bundle: load jsPDF/svg2pdf/autotable **lazily** (see risk R3).
- Command `laravelErd.exportPdf` (QuickPick: mode → paper → audience).

## 9. Options, settings and commands

```ts
// src/shared/export-options.ts
export interface ExportOptions {
  scope: 'all' | 'selection' | 'tables';
  tables?: string[];            // when scope = 'tables' | 'selection'
  neighborDepth?: number;       // default 1
  layoutMode: 'fresh' | 'saved'; // default 'fresh'; user is asked; 'saved' needs a saved layout file
  hideFrameworkTables: boolean; // default true for docs
  hideTables?: string[];
  includeInferred: boolean;     // default false in docs/SQL
  theme: 'light' | 'grayscale' | 'dark';
  columnMode: 'all' | 'keys' | 'names' | 'none';
  showSourceMigration: boolean;
  title?: string; subtitle?: string; author?: string; logoPath?: string;
  language: 'en' | 'es';
  audience: 'technical' | 'business';
  png?:  { scale: 1 | 2 | 3 | 4; background: 'white' | 'transparent' };
  pdf?:  { mode: 'diagram' | 'documentation'; paper: 'A4'|'A3'|'A2'|'Letter'|'Tabloid';
           orientation: 'landscape'|'portrait'|'auto'; tiling: boolean;
           perTablePages: boolean; includeWarnings: boolean };
}
```

New `package.json` contributions:
- Commands: `laravelErd.exportSql`, `laravelErd.exportSvg`,
  `laravelErd.exportPng`, `laravelErd.exportPdf` (+ existing DBML/Mermaid).
- Settings (`laravelErd.export.*`): `defaultDialect`, `defaultTheme`,
  `language`, `audience`, `author`, `logoPath`, `outputDirectory`
  (default `docs/erd`), `hideFrameworkTables`, `pdf.paper`, `png.scale`,
  `mysql.engine|charset|collation`.
- Webview toolbar: **Export ▾** menu (SQL…, SVG, PNG, PDF…, DBML, Mermaid).
  Selecting an item with options opens an **Export dialog** (modal, same styling
  as `WarningsModal`) with the relevant fields and a live SVG preview
  thumbnail; "Use current selection" shortcut when a table is selected.
  The dialog includes a **Layout** radio group: *Automatic layout
  (recommended)* / *My saved layout* (disabled with tooltip when no saved
  layout exists). Command Palette flows ask the same question via QuickPick
  (`Automatic layout (recommended)` first).
- Default save location: `<workspace>/<outputDirectory>/<project>-erd.<ext>`;
  remember last used directory in `globalState`.

## 10. Phased tasks

Legend: `[ ]` todo. Each phase ends with **Acceptance**.

### Phase 0 — Prerequisites
- [ ] Fix unsigned type normalization + regression tests.
- [ ] `ColumnType` union + Laravel defaults (string 255, decimal 8,2) in IR.
- [ ] Parse table-level `comment()`.
- [ ] Extract ELK layout to `src/core/layout/` (no DOM); webview imports it.
- [ ] Export registry + `ExportOptions` type.
- **Acceptance:** types fixture test passes; `npm run lint && npm test && npm run build` green; UI unchanged.

### Phase 1 — SQL export
- [ ] `core/export/sql/` common builder + `mysql.ts`, `postgres.ts`, `sqlite.ts`.
- [ ] Topological sort of tables, FK `alter`/`inline`, cycle handling.
- [ ] Identifier truncation, quoting, escaping, defaults.
- [ ] Command `laravelErd.exportSql` + QuickPicks + save/open/copy.
- [ ] Golden-file tests per dialect for fixtures `default`, `blog`, `types`, `alterations`.
- **Acceptance:** SQLite output executes without error in `sql.js` (test);
  PG output parses with `pgsql-ast-parser`; MySQL output parses with
  `node-sql-parser`; golden files stable; FK cycle fixture works.

### Phase 2 — Static SVG renderer + SVG export
- [ ] `core/render/` (metrics, table card, edges, legend, title block, themes).
- [ ] Scoping/filters (all / selection / tables / framework preset).
- [ ] `layoutMode` `fresh` | `saved` (saved positions input, ELK fallback for missing tables, re-routing, overlap resolution) + tests (saved layout with moved/missing/extra tables).
- [ ] Command `laravelErd.exportSvg` (host side).
- [ ] Snapshot tests (deterministic output) for 3 themes × 2 column modes.
- **Acceptance:** SVG opens correctly in browser and Inkscape; no overlapping
  cards (test via layout bounding boxes); byte-identical across runs.

### Phase 3 — PNG export
- [ ] Webview rasterizer with scale + background + size guards.
- [ ] Message protocol (`export`, `exportSave`, `exportError`); host save flow.
- [ ] CSP update (`img-src blob:`).
- [ ] Command `laravelErd.exportPng` (opens panel if closed).
- **Acceptance:** PNG saved at requested scale; oversized schema triggers
  auto-downscale + warning; works with panel opened by the command.

### Phase 4 — PDF diagram-only
- [ ] jsPDF + svg2pdf pipeline (vector), paper/orientation/auto, footer, title block.
- [ ] Tiling option for dense diagrams.
- **Acceptance:** vector (text selectable) PDF; opens in Acrobat/Chrome/Preview;
  A4/A3 landscape verified on `blog` and a 50+ table synthetic schema.

### Phase 5 — PDF technical documentation (PM-oriented)
- [ ] Cover, overview, index, per-table sections (autotable), relationships,
  appendix; bookmarks + internal links; PDF metadata.
- [ ] `humanize-types` (en/es), i18n labels, `audience` switch.
- [ ] Project metadata reader (`composer.json`: name, laravel version).
- **Acceptance:** generated doc for a real project (GAOS) reviewed manually:
  correct accents, no text overflow, working index links, page numbers,
  consistent with diagram data.

### Phase 6 — UI + settings integration
- [ ] Toolbar **Export ▾** menu + Export dialog + preview thumbnail.
- [ ] `laravelErd.export.*` settings, last-directory memory.
- [ ] Fold DBML/Mermaid exports into the same menu and save flow.
- **Acceptance:** every format reachable from toolbar and Command Palette;
  options persisted; keyboard accessible; unique ids on interactive elements.

### Phase 7 — Polish & release
- [ ] README (GIFs of exports), CHANGELOG, sample outputs in `docs/examples/`.
- [ ] Bundle-size review; lazy-load PDF libs if feasible.
- [ ] Performance check: 300 tables SVG < 3 s, PDF documentation < 15 s.
- **Acceptance:** `npm run package` clean; `.vsix` verified in a clean profile.

## 11. Testing

- **Unit (vitest)**: SQL golden files; type-mapping table-driven tests (every
  canonical type × 3 dialects); identifier truncation; topological sort incl.
  cycles; renderer snapshots; humanize/i18n key coverage (en/es parity test).
- **Validation tests**: `sql.js` (SQLite execution), `pgsql-ast-parser`,
  `node-sql-parser` — dev dependencies only.
- **Determinism**: two renders deep-equal.
- **PDF/PNG**: smoke tests in webview environment (jsdom/`@vitest/browser`
  optional) or e2e via `@vscode/test-electron`: file exists, header bytes
  (`%PDF-`, PNG signature), PDF page count > 0.
- **Manual QA checklist** in `docs/QA-export.md` (GAOS project).

## 12. Risks

| # | Risk | Mitigation |
|---|---|---|
| R1 | Canvas size limits for big PNGs | Auto-downscale, warn, recommend SVG/PDF |
| R2 | Fonts/Unicode in PDF (Spanish accents, symbols) | Standard Helvetica (WinAnsi), ASCII fallbacks, no emoji/icons; test with accents |
| R3 | Webview CSP + dynamic `import()` of PDF chunks (current bundle is a classic non-module script with nonce-only `script-src`) | Start with static imports (accept bigger bundle) or set rollup `inlineDynamicImports`; optimize later by switching to `<script type="module">` and adding `${cspSource}` to `script-src` |
| R4 | Dialect differences/edge cases (enum, unsigned, autoincrement) | Golden + executable validation; document limitations in header comment |
| R5 | Unreadable diagrams for 100+ tables | Scoping, framework-table preset, column modes, tiling, big paper sizes |
| R6 | IR gaps (charset/collation, table engine, generated columns, fulltext) | Warn in SQL header; extend IR incrementally |
| R7 | Saved layout vs export card sizes (overlaps, stale/missing tables) | `fresh` is default; in `saved` mode: ELK fallback for missing tables, drop unknown tables, overlap-resolution pass, re-route edges, note in output |
| R8 | Large `postMessage` payloads (big PDFs) | base64 chunking if > ~20 MB; typical docs are small |

## 13. Resolved questions (user review)

1. **Dialects**: MySQL + PostgreSQL + SQLite. SQL Server skipped.
2. **PDF engine**: webview jsPDF + svg2pdf.js.
3. **Doc language**: `en` + `es` from the start.
4. **PM descriptions**: only Laravel `->comment()` for now (no sidecar file).
5. **Inferred relations in SQL**: excluded by default.
6. **Layout for exports**: both modes supported. `fresh` ELK layout is the
   default; the user is explicitly asked to choose between `fresh` and `saved`
   on every export flow (dialog radio / QuickPick). `saved` only available when
   a saved layout exists.

No open questions remain. Next step: start Phase 0.

## 14. Agent rules (additions)

1. SQL/SVG code lives in `core` (no `vscode`, no DOM). PNG/PDF code lives in `webview`.
2. Every new export has a golden/snapshot test before UI wiring.
3. Never emit non-deterministic content (timestamps only in header, injectable
   via option for tests: `generatedAt?: string`).
4. No remote assets, no webfonts, no emoji in exports.
5. Keep `PLAN-EXPORT.md` checkboxes updated; report build/test results per phase.
