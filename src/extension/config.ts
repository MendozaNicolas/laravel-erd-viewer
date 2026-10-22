import * as vscode from 'vscode';

export interface ExtensionConfig {
  migrationsPath: string;
  inferRelations: boolean;
  hideTables: string[];
}

export function getExtensionConfig(resourceUri?: vscode.Uri): ExtensionConfig {
  const config = vscode.workspace.getConfiguration('laravelErd', resourceUri);
  return {
    migrationsPath: config.get<string>('migrationsPath', 'database/migrations'),
    inferRelations: config.get<boolean>('inferRelations', true),
    hideTables: config.get<string[]>('hideTables', []),
  };
}
