/**
 * The browser side of persistence: keeping one autosaved project around
 * between sessions.
 *
 * **Why IndexedDB and not `localStorage`.** A project's own data is tiny —
 * a few kilobytes of layers, objects and calibration. Its *background* is
 * not: an imported plan is held as a `data:` URL (see
 * `ui/hooks/useHtmlImage.ts`), and base64 inflates a photo by about a
 * third. A single 4 MB scan therefore blows straight through
 * `localStorage`'s ~5 MB budget, and it does so by throwing on write —
 * which, for an autosave, means the user's work silently stops being
 * saved at exactly the moment it became worth saving. IndexedDB's quota is
 * orders of magnitude larger and it stores structured values directly, so
 * the image isn't re-encoded as a JSON string on every keystroke.
 *
 * Everything here is failure-tolerant by design. Storage can be absent
 * (private windows, disabled site data), blocked, full, or corrupt, and
 * none of that is exceptional enough to break the editor: the app must
 * still open and still let the user work and export a file by hand. So
 * every function resolves to a result object instead of rejecting, and the
 * UI decides what to say.
 *
 * This is the only file in `persistence/` that touches a browser API;
 * `projectFile.ts` next to it stays pure and carries all the validation.
 */

import { parseProjectFile, toProjectFile } from "./projectFile";
import type { ParseError, ProjectFile } from "./projectFile";
import type { Project } from "../domain/types";

const DATABASE_NAME = "kl-implantation";
const DATABASE_VERSION = 1;
const STORE_NAME = "projects";

/** Key of the single autosave record. Named rather than numbered so adding named slots later doesn't collide. */
const AUTOSAVE_KEY = "autosave";

export type LoadResult =
  | { status: "loaded"; file: ProjectFile }
  | { status: "empty" }
  | { status: "unavailable" }
  /** A record was there but didn't survive validation — the user should be told, not silently given a blank project. */
  | { status: "corrupt"; error: ParseError };

export type SaveResult =
  | { status: "saved"; savedAt: string }
  | { status: "unavailable" }
  | { status: "quotaExceeded" }
  | { status: "failed"; message: string };

/** Wraps an IDBRequest in a promise. Rejections are handled by the callers below, which never let one escape. */
function promisifyRequest<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function openDatabase(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    } catch {
      // Some browsers throw synchronously rather than firing onerror when
      // site data is disabled entirely.
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    // A private window can leave the open request hanging instead of
    // failing; don't let that stall the app's startup forever.
    request.onblocked = () => resolve(null);
  });
}

/**
 * Reads the autosaved project, if any. The stored value goes through the
 * same `parseProjectFile` validation as a file the user picked: a record
 * written by an older build, or half-written when the tab was killed, is
 * untrusted in exactly the same way.
 */
export async function loadAutosavedProject(): Promise<LoadResult> {
  const db = await openDatabase();
  if (!db) return { status: "unavailable" };
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const stored = await promisifyRequest(transaction.objectStore(STORE_NAME).get(AUTOSAVE_KEY));
    if (stored === undefined) return { status: "empty" };
    const result = parseProjectFile(stored);
    if (!result.ok) return { status: "corrupt", error: result.error };
    return { status: "loaded", file: result.file };
  } catch {
    return { status: "unavailable" };
  } finally {
    db.close();
  }
}

export async function saveAutosavedProject(project: Project): Promise<SaveResult> {
  const db = await openDatabase();
  if (!db) return { status: "unavailable" };
  const file = toProjectFile(project);
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    // The value is stored as a structured clone, not a JSON string, so a
    // large background isn't re-serialized on every save.
    await promisifyRequest(transaction.objectStore(STORE_NAME).put(file, AUTOSAVE_KEY));
    return { status: "saved", savedAt: file.savedAt };
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") {
      return { status: "quotaExceeded" };
    }
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}

// There is deliberately no `clear` function. Every way of leaving a
// project behind (opening a file, starting a new one) replaces it with
// another project that the autosave then writes over the same record, so a
// delete would only ever race that write — and losing that race would
// destroy the document the user had just chosen.
