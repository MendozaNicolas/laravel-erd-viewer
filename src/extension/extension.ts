import * as vscode from 'vscode';
import { ErdWebviewPanel } from './panel';
import { scanAndParseMigrations } from './scanner';
import { exportToDbml } from '../core/export/dbml';
import { exportToMermaid } from '../core/export/mermaid';

export function activate(context: vscode.ExtensionContext) {
  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.show', async () => {
      await ErdWebviewPanel.createOrShow(context.extensionUri);
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.refresh', async () => {
      if (ErdWebviewPanel.currentPanel) {
        await ErdWebviewPanel.currentPanel.refresh();
      } else {
        await ErdWebviewPanel.createOrShow(context.extensionUri);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.resetLayout', async () => {
      if (ErdWebviewPanel.currentPanel) {
        await ErdWebviewPanel.currentPanel.resetLayout();
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.exportDbml', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      try {
        const schema = await scanAndParseMigrations(workspaceFolders[0].uri);
        const dbml = exportToDbml(schema);
        const doc = await vscode.workspace.openTextDocument({
          content: dbml,
          language: 'dbml',
        });
        await vscode.window.showTextDocument(doc);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Export to DBML failed: ${err.message || err}`);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('laravelErd.exportMermaid', async () => {
      const workspaceFolders = vscode.workspace.workspaceFolders;
      if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage('No workspace folder open.');
        return;
      }
      try {
        const schema = await scanAndParseMigrations(workspaceFolders[0].uri);
        const mermaid = exportToMermaid(schema);
        const markdown = `\`\`\`mermaid\n${mermaid}\n\`\`\``;
        const doc = await vscode.workspace.openTextDocument({
          content: markdown,
          language: 'markdown',
        });
        await vscode.window.showTextDocument(doc);
      } catch (err: any) {
        vscode.window.showErrorMessage(`Export to Mermaid failed: ${err.message || err}`);
      }
    })
  );
}

export function deactivate() {
  if (ErdWebviewPanel.currentPanel) {
    ErdWebviewPanel.currentPanel.dispose();
  }
}
