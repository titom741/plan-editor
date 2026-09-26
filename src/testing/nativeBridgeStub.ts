/**
 * Stands in for the macOS shell's file bridge.
 *
 * The real one is a `WKScriptMessageHandlerWithReply` reachable at
 * `window.webkit.messageHandlers.planEditorFiles`; from the web app's
 * side it is one `postMessage` that returns a promise. That is small
 * enough to reproduce exactly, which is what lets the save and open
 * paths be tested without a Mac in the loop.
 */

/** What the fake shell answers, per action. Anything unhandled replies with an error. */
export interface NativeBridgeResponses {
  saveAs?: (message: Record<string, unknown>) => unknown;
  save?: (message: Record<string, unknown>) => unknown;
  open?: (message: Record<string, unknown>) => unknown;
  chooseFolder?: (message: Record<string, unknown>) => unknown;
}

export interface NativeBridgeStub {
  /** The actions requested, in order — enough to assert that a plain save never opened a panel. */
  actions: string[];
  /** The payload of the last write, so a test can check what would have hit the disk. */
  lastContents: string | null;
  restore(): void;
}

export function installNativeBridge(responses: NativeBridgeResponses): NativeBridgeStub {
  const globals = globalThis as { webkit?: unknown };
  const previous = globals.webkit;

  const stub: NativeBridgeStub = {
    actions: [],
    lastContents: null,
    restore: () => {
      globals.webkit = previous;
    },
  };

  globals.webkit = {
    messageHandlers: {
      planEditorFiles: {
        postMessage: (message: unknown) => {
          const record = (message ?? {}) as Record<string, unknown>;
          const action = String(record.action);
          stub.actions.push(action);
          if (typeof record.contents === "string") stub.lastContents = record.contents;
          const responder = responses[action as keyof NativeBridgeResponses];
          if (!responder) return Promise.resolve({ error: `unhandled action: ${action}` });
          return Promise.resolve(responder(record));
        },
      },
    },
  };

  return stub;
}
