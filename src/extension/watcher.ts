import * as vscode from 'vscode';
import { getExtensionConfig } from './config';

export function setupMigrationWatcher(
  workspaceRoot: vscode.Uri,
  onMigrationsChanged: () => void
): vscode.Disposable {
  const config = getExtensionConfig(workspaceRoot);
  const migrationsFolder = config.migrationsPath.replace(/\\/g, '/');
  const pattern = new vscode.RelativePattern(workspaceRoot, `${migrationsFolder}/**/*.php`);

  const watcher = vscode.workspace.createFileSystemWatcher(pattern);

  let debounceTimer: NodeJS.Timeout | null = null;
  const triggerDebounced = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      onMigrationsChanged();
    }, 300);
  };

  const d1 = watcher.onDidCreate(triggerDebounced);
  const d2 = watcher.onDidChange(triggerDebounced);
  const d3 = watcher.onDidDelete(triggerDebounced);

  return vscode.Disposable.from(watcher, d1, d2, d3, {
    dispose: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
    },
  });
}
