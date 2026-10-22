import { ToExtension } from '../shared/protocol';

interface VsCodeApi {
  postMessage(message: ToExtension): void;
  getState(): unknown;
  setState(state: unknown): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let vscodeInstance: VsCodeApi | null = null;

export function getVsCodeApi(): VsCodeApi {
  if (!vscodeInstance) {
    if (typeof acquireVsCodeApi === 'function') {
      vscodeInstance = acquireVsCodeApi();
    } else {
      // Mock for browser testing outside VS Code
      vscodeInstance = {
        postMessage: (msg: ToExtension) => {
          console.log('[mock-vscode] postMessage:', msg);
        },
        getState: () => null,
        setState: () => {},
      };
    }
  }
  return vscodeInstance;
}
