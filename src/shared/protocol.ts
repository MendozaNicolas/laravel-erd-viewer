import { SchemaIR, SourceRef } from './model';

export interface SavedLayout {
  version: 1;
  nodes: Record<string /* table name */, { x: number; y: number }>;
}

// extension -> webview
export type ToWebview =
  | { type: 'schema'; schema: SchemaIR; layout: SavedLayout | null }
  | { type: 'loading'; value: boolean }
  | { type: 'error'; message: string };

// webview -> extension
export type ToExtension =
  | { type: 'ready' }
  | { type: 'openSource'; source: SourceRef }
  | { type: 'saveLayout'; layout: SavedLayout }
  | { type: 'refresh' };
