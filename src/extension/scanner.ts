import * as vscode from 'vscode';
import { parseLaravelMigrations, MigrationFileInput } from '../core/laravel';
import { SchemaIR } from '../shared/model';
import { getExtensionConfig } from './config';

export async function scanAndParseMigrations(workspaceRoot: vscode.Uri): Promise<SchemaIR> {
  const config = getExtensionConfig(workspaceRoot);
  const cleanFolder = config.migrationsPath.replace(/\\/g, '/').replace(/^\.?\//, '');

  // 1. Try finding files within the specific workspaceRoot
  const pattern = new vscode.RelativePattern(workspaceRoot, `${cleanFolder}/**/*.php`);
  let uris: vscode.Uri[] = [];
  try {
    uris = await vscode.workspace.findFiles(pattern);
  } catch {
    uris = [];
  }

  // 2. Fallback: search globally across workspace if no files found
  if (uris.length === 0) {
    try {
      uris = await vscode.workspace.findFiles(`**/${cleanFolder}/**/*.php`);
    } catch {
      uris = [];
    }
  }

  // 3. Fallback: try standard database/migrations if custom path yielded nothing
  if (uris.length === 0 && cleanFolder !== 'database/migrations') {
    try {
      uris = await vscode.workspace.findFiles('**/database/migrations/**/*.php');
    } catch {
      uris = [];
    }
  }

  const inputs: MigrationFileInput[] = [];
  for (const uri of uris) {
    try {
      // Check if open in editor in memory
      const openDoc = vscode.workspace.textDocuments.find(
        (d) => d.uri.toString() === uri.toString()
      );
      const content = openDoc
        ? openDoc.getText()
        : Buffer.from(await vscode.workspace.fs.readFile(uri)).toString('utf-8');

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
