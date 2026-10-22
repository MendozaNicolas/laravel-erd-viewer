import * as vscode from 'vscode';
import { parseLaravelMigrations, MigrationFileInput } from '../core/laravel';
import { SchemaIR } from '../shared/model';
import { getExtensionConfig } from './config';

export async function scanAndParseMigrations(workspaceRoot: vscode.Uri): Promise<SchemaIR> {
  const config = getExtensionConfig(workspaceRoot);
  const migrationsFolder = config.migrationsPath.replace(/\\/g, '/');

  // Find all .php files in the migrations directory
  const pattern = new vscode.RelativePattern(workspaceRoot, `${migrationsFolder}/**/*.php`);
  const uris = await vscode.workspace.findFiles(pattern);

  const inputs: MigrationFileInput[] = [];
  for (const uri of uris) {
    try {
      const data = await vscode.workspace.fs.readFile(uri);
      const content = Buffer.from(data).toString('utf-8');
      const relPath = vscode.workspace.asRelativePath(uri);
      inputs.push({
        path: relPath,
        content,
      });
    } catch (err) {
      console.error(`[laravel-erd] Failed to read ${uri.fsPath}`, err);
    }
  }

  // Parse migrations
  const ir = parseLaravelMigrations(inputs, {
    inferRelations: config.inferRelations,
  });

  // Filter hidden tables if configured
  if (config.hideTables && config.hideTables.length > 0) {
    const hiddenSet = new Set(config.hideTables);
    ir.tables = ir.tables.filter((t) => !hiddenSet.has(t.name));
    ir.relations = ir.relations.filter(
      (r) => !hiddenSet.has(r.from.table) && !hiddenSet.has(r.to.table)
    );
  }

  return ir;
}
