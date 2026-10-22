import * as vscode from 'vscode';
import { getExtensionConfig } from './config';

export function setupMigrationWatcher(
  workspaceRoot: vscode.Uri,
  onMigrationsChanged: () => void
): vscode.Disposable {
  const disposables: vscode.Disposable[] = [];
  const config = getExtensionConfig(workspaceRoot);
  const cleanFolder = config.migrationsPath.replace(/\\/g, '/').replace(/^\.?\//, '');

  let debounceTimer: NodeJS.Timeout | null = null;
  const triggerDebounced = () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
    }
    debounceTimer = setTimeout(() => {
      onMigrationsChanged();
    }, 250);
  };

  // Helper to check if a URI belongs to the migrations folder
  const isMigrationUri = (uri: vscode.Uri): boolean => {
    const p = uri.fsPath.replace(/\\/g, '/').toLowerCase();
    const folderName = cleanFolder.toLowerCase();
    return p.endsWith('.php') && (p.includes(`/${folderName}/`) || p.includes('/database/migrations/') || p.includes('\\database\\migrations\\'));
  };

  // 1. Filesystem Watcher across workspace (catches external tools like php artisan make:migration)
  const globPattern = `**/${cleanFolder}/**/*.php`;
  const fsWatcher = vscode.workspace.createFileSystemWatcher(globPattern);
  disposables.push(
    fsWatcher.onDidCreate(() => triggerDebounced()),
    fsWatcher.onDidChange(() => triggerDebounced()),
    fsWatcher.onDidDelete(() => triggerDebounced()),
    fsWatcher
  );

  // 2. RelativePattern watcher for the active workspace root specifically
  if (workspaceRoot) {
    try {
      const relWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(workspaceRoot, `${cleanFolder}/**/*.php`)
      );
      disposables.push(
        relWatcher.onDidCreate(() => triggerDebounced()),
        relWatcher.onDidChange(() => triggerDebounced()),
        relWatcher.onDidDelete(() => triggerDebounced()),
        relWatcher
      );
    } catch {
      // Ignore if pattern cannot be constructed
    }
  }

  // 3. Document Save Event (instant response when user saves Ctrl+S in editor)
  disposables.push(
    vscode.workspace.onDidSaveTextDocument((doc) => {
      if (isMigrationUri(doc.uri)) {
        triggerDebounced();
      }
    })
  );

  // 4. VS Code File Events (create, delete, rename inside VS Code explorer)
  disposables.push(
    vscode.workspace.onDidCreateFiles((e) => {
      if (e.files.some(isMigrationUri)) {
        triggerDebounced();
      }
    }),
    vscode.workspace.onDidDeleteFiles((e) => {
      if (e.files.some(isMigrationUri)) {
        triggerDebounced();
      }
    }),
    vscode.workspace.onDidRenameFiles((e) => {
      if (e.files.some((f) => isMigrationUri(f.newUri) || isMigrationUri(f.oldUri))) {
        triggerDebounced();
      }
    })
  );

  return {
    dispose: () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      for (const d of disposables) {
        try {
          d.dispose();
        } catch {
          // Ignore
        }
      }
    },
  };
}
