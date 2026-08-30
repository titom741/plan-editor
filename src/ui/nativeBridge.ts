/**
 * The macOS shell's file bridge.
 *
 * `WKWebView` implements no File System Access, so inside the macOS app
 * the web build had no way to ask "where do you want this?" — every save
 * fell back to a download into Downloads. The shell therefore exposes
 * `NSOpenPanel` and `NSSavePanel` over a `WKScriptMessageHandlerWithReply`
 * channel, which is the only route a web view has to a real file path.
 *
 * Nothing here assumes the bridge exists: `isNativeBridgeAvailable()` is
 * false in every browser, and the callers fall back to the web paths. The
 * shell is one host among several, not the primary one.
 */

/** What a save or open returned. `cancelled` is a normal outcome, not a failure. */
export type NativeFileResult =
  | { status: "ok"; path: string; name: string; contents?: string }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

interface NativeMessageHandler {
  postMessage: (message: unknown) => Promise<unknown>;
}

function handler(): NativeMessageHandler | null {
  const webkit = (
    globalThis as {
      webkit?: { messageHandlers?: Record<string, NativeMessageHandler | undefined> };
    }
  ).webkit;
  return webkit?.messageHandlers?.planEditorFiles ?? null;
}

export function isNativeBridgeAvailable(): boolean {
  return handler() !== null;
}

/**
 * Normalises whatever came back across the bridge. The Swift side is
 * trusted to send the right shape, but a reply that lost its way must
 * degrade to a reported failure rather than crash the editor.
 */
function readResult(reply: unknown): NativeFileResult {
  if (typeof reply !== "object" || reply === null) {
    return { status: "failed", message: "Réponse inattendue du pont natif." };
  }
  const record = reply as Record<string, unknown>;
  if (record.cancelled === true) return { status: "cancelled" };
  if (typeof record.error === "string") return { status: "failed", message: record.error };
  if (typeof record.path !== "string" || typeof record.name !== "string") {
    return { status: "failed", message: "Réponse incomplète du pont natif." };
  }
  return {
    status: "ok",
    path: record.path,
    name: record.name,
    ...(typeof record.contents === "string" ? { contents: record.contents } : {}),
  };
}

async function send(message: Record<string, unknown>): Promise<NativeFileResult> {
  const channel = handler();
  if (!channel) return { status: "failed", message: "Pont natif indisponible." };
  try {
    return readResult(await channel.postMessage(message));
  } catch (error) {
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  }
}

/** Shows the system save panel and writes the file the user chose. */
export function nativeSaveAs(suggestedName: string, contents: string): Promise<NativeFileResult> {
  return send({ action: "saveAs", suggestedName, contents });
}

/** Overwrites a file already chosen in this session, with no panel. */
export function nativeSave(path: string, contents: string): Promise<NativeFileResult> {
  return send({ action: "save", path, contents });
}

/** Shows the system open panel and reads the file the user picked. */
export function nativeOpen(): Promise<NativeFileResult> {
  return send({ action: "open" });
}

/** A document the shell handed over — opened from the Finder or the Dock. */
export interface NativeOpenedFile {
  path: string;
  name: string;
  contents: string;
}

/**
 * Registers the callback the macOS shell invokes when a `.kli` file is
 * double-clicked. The shell calls `window.planEditorOpenFile?.(payload)`,
 * with the `?.` doing the work: a build that predates this, or a page
 * still loading, simply ignores the call instead of throwing inside the
 * web view where nobody would see it.
 *
 * Returns a function that unregisters, so an effect can clean up.
 */
export function onNativeFileOpened(handler: (file: NativeOpenedFile) => void): () => void {
  const globals = globalThis as { planEditorOpenFile?: (payload: unknown) => void };
  globals.planEditorOpenFile = (payload: unknown) => {
    if (typeof payload !== "object" || payload === null) return;
    const record = payload as Record<string, unknown>;
    if (
      typeof record.path !== "string" ||
      typeof record.name !== "string" ||
      typeof record.contents !== "string"
    ) {
      return;
    }
    handler({ path: record.path, name: record.name, contents: record.contents });
  };
  const registered = globals.planEditorOpenFile;
  return () => {
    // Only take back our own hook: an effect that re-ran has already
    // installed the next one, and unregistering it would leave the shell
    // calling into nothing.
    if (globals.planEditorOpenFile === registered) delete globals.planEditorOpenFile;
  };
}
