import * as vscode from 'vscode';
import { SavedLayout } from '../shared/protocol';

const LAYOUT_FILE = '.vscode/laravel-erd.layout.json';

export async function loadSavedLayout(workspaceRoot: vscode.Uri): Promise<SavedLayout | null> {
  const fileUri = vscode.Uri.joinPath(workspaceRoot, LAYOUT_FILE);
  try {
    const data = await vscode.workspace.fs.readFile(fileUri);
    const content = Buffer.from(data).toString('utf-8');
    const parsed = JSON.parse(content);
    if (parsed && parsed.version === 1 && parsed.nodes) {
      return parsed as SavedLayout;
    }
  } catch {
    // File not found or invalid
  }
  return null;
}

export async function saveLayout(workspaceRoot: vscode.Uri, layout: SavedLayout): Promise<void> {
  const vscodeDir = vscode.Uri.joinPath(workspaceRoot, '.vscode');
  try {
    await vscode.workspace.fs.createDirectory(vscodeDir);
  } catch {
    // Ignore if directory exists
  }

  const fileUri = vscode.Uri.joinPath(workspaceRoot, LAYOUT_FILE);
  const data = Buffer.from(JSON.stringify(layout, null, 2), 'utf-8');
  await vscode.workspace.fs.writeFile(fileUri, data);
}

export async function clearSavedLayout(workspaceRoot: vscode.Uri): Promise<void> {
  const fileUri = vscode.Uri.joinPath(workspaceRoot, LAYOUT_FILE);
  try {
    await vscode.workspace.fs.delete(fileUri);
  } catch {
    // Ignore if doesn't exist
  }
}
