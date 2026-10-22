# Laravel ERD Viewer

Interactive Entity-Relationship Diagram (ERD) visualizer for Laravel migrations directly inside VS Code.

## Features

- **Zero-setup parsing**: Statically analyzes `database/migrations/*.php` using AST (no PHP runtime or database connection required).
- **Interactive ERD**: Pan, zoom, drag nodes, inspect columns (types, PK/FK, nullable, unique) and relationships.
- **Trace to Source**: Click any table or column to jump directly to the migration and line where it was defined.
- **Smart Relations**: Detects explicit foreign keys (`constrained()`, `foreign()->references()`) and convention-based relations (`user_id -> users.id`).
- **Layout Persistence**: Custom node positioning is automatically saved and restored.
- **Theme Aware**: Seamlessly adapts to your VS Code light and dark themes.

## Usage

1. Open a Laravel project in VS Code.
2. Open the Command Palette (`Ctrl+Shift+P` or `Cmd+Shift+P`).
3. Run **Laravel ERD: Show Diagram**.

## Configuration

| Setting | Type | Default | Description |
|---|---|---|---|
| `laravelErd.migrationsPath` | `string` | `database/migrations` | Workspace-relative path to migrations folder |
| `laravelErd.inferRelations` | `boolean` | `true` | Infer relations based on naming conventions (`<table_singular>_id`) |
| `laravelErd.hideTables` | `array` | `[]` | List of table names to exclude from the diagram |

## License

[MIT](LICENSE)
