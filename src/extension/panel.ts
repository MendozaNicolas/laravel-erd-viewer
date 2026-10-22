import * as vscode from 'vscode';
import { SchemaIR, SourceRef } from '../shared/model';
import { SavedLayout, ToExtension, ToWebview } from '../shared/protocol';
import { scanAndParseMigrations } from './scanner';
import { clearSavedLayout, loadSavedLayout, saveLayout } from './layout-store';
import { setupMigrationWatcher } from './watcher';

export class ErdWebviewPanel {
  public static currentPanel: ErdWebviewPanel | undefined;
  private readonly _panel: vscode.WebviewPanel;
  private readonly _extensionUri: vscode.Uri;
  private readonly _workspaceRoot: vscode.Uri;
  private _disposables: vscode.Disposable[] = [];

  public static async createOrShow(extensionUri: vscode.Uri) {
    const column = vscode.window.activeTextEditor
      ? vscode.window.activeTextEditor.viewColumn
      : undefined;

    if (ErdWebviewPanel.currentPanel) {
      ErdWebviewPanel.currentPanel._panel.reveal(column);
      await ErdWebviewPanel.currentPanel.refresh();
      return;
    }

    let workspaceRoot = extensionUri;
    if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
      if (vscode.window.activeTextEditor) {
        const folder = vscode.workspace.getWorkspaceFolder(vscode.window.activeTextEditor.document.uri);
        workspaceRoot = folder ? folder.uri : vscode.workspace.workspaceFolders[0].uri;
      } else {
        workspaceRoot = vscode.workspace.workspaceFolders[0].uri;
      }
    }

    const panel = vscode.window.createWebviewPanel(
      'laravelErd',
      'Laravel ERD',
      column || vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [
          vscode.Uri.joinPath(extensionUri, 'dist-webview'),
        ],
      }
    );

    ErdWebviewPanel.currentPanel = new ErdWebviewPanel(panel, extensionUri, workspaceRoot);
  }

  private constructor(
    panel: vscode.WebviewPanel,
    extensionUri: vscode.Uri,
    workspaceRoot: vscode.Uri
  ) {
    this._panel = panel;
    this._extensionUri = extensionUri;
    this._workspaceRoot = workspaceRoot;

    this._panel.webview.html = this._getHtmlForWebview(this._panel.webview);

    this._panel.onDidDispose(() => this.dispose(), null, this._disposables);

    this._panel.webview.onDidReceiveMessage(
      (message: ToExtension) => {
        this._handleMessage(message);
      },
      null,
      this._disposables
    );

    // Watch migrations in workspace
    const watcher = setupMigrationWatcher(this._workspaceRoot, () => {
      this.refresh();
    });
    this._disposables.push(watcher);
  }

  public postMessage(message: ToWebview) {
    this._panel.webview.postMessage(message);
  }

  public async refresh() {
    this.postMessage({ type: 'loading', value: true });
    try {
      const schema = await scanAndParseMigrations(this._workspaceRoot);
      const layout = await loadSavedLayout(this._workspaceRoot);
      this.postMessage({
        type: 'schema',
        schema,
        layout,
      });
    } catch (err: any) {
      this.postMessage({
        type: 'error',
        message: err.message || 'Failed to scan migrations.',
      });
    }
  }

  public async resetLayout() {
    await clearSavedLayout(this._workspaceRoot);
    await this.refresh();
  }

  private async _handleMessage(message: ToExtension) {
    switch (message.type) {
      case 'ready': {
        await this.refresh();
        break;
      }
      case 'refresh': {
        await this.refresh();
        break;
      }
      case 'openSource': {
        await this._openSourceFile(message.source);
        break;
      }
      case 'saveLayout': {
        await saveLayout(this._workspaceRoot, message.layout);
        break;
      }
    }
  }

  private async _openSourceFile(source: SourceRef) {
    try {
      const targetUri = vscode.Uri.joinPath(this._workspaceRoot, source.file);
      const doc = await vscode.workspace.openTextDocument(targetUri);
      const line = Math.max(0, (source.line || 1) - 1);
      const col = Math.max(0, (source.column || 1) - 1);
      const pos = new vscode.Position(line, col);
      await vscode.window.showTextDocument(doc, {
        selection: new vscode.Range(pos, pos),
        preview: true,
      });
    } catch (err: any) {
      vscode.window.showWarningMessage(`Could not open source file: ${source.file}`);
    }
  }

  public dispose() {
    ErdWebviewPanel.currentPanel = undefined;
    this._panel.dispose();

    while (this._disposables.length) {
      const x = this._disposables.pop();
      if (x) {
        x.dispose();
      }
    }
  }

  private _getHtmlForWebview(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist-webview', 'assets', 'index.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'dist-webview', 'assets', 'index.css')
    );

    const nonce = getNonce();

    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; font-src ${webview.cspSource}; img-src ${webview.cspSource} https: data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <link rel="stylesheet" href="${styleUri}">
  <title>Laravel ERD Viewer</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function getNonce(): string {
  let text = '';
  const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) {
    text += possible.charAt(Math.floor(Math.random() * possible.length));
  }
  return text;
}
