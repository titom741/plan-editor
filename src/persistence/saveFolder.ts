/**
 * The folder projects are saved to by default (KL-053).
 *
 * "Enregistrer sous" still asks — the dialog simply opens in this folder,
 * so a different name or place remains one click away. How the folder is
 * remembered depends on what the host can hold on to:
 *
 * - **The macOS app** gets a real path from its folder panel. It is a
 *   string, kept in `localStorage` with the other preferences and handed
 *   back to the shell with every save and open.
 * - **Chrome and Edge** get a `FileSystemDirectoryHandle` from
 *   `showDirectoryPicker`. A handle is not a string and does not survive
 *   JSON, but IndexedDB stores it as is, and the browser accepts it as the
 *   `startIn` of its own save picker. It gives the folder's name and never
 *   its path — that is a security boundary, not an oversight.
 * - **Safari and Firefox** have no folder API at all: they download, into
 *   the folder set in the browser's own preferences.
 *
 * Every function here tolerates storage being absent, full or corrupt: a
 * preference that cannot be read is simply not set.
 */

export type SaveFolder =
  | { kind: "path"; path: string; name: string }
  | { kind: "handle"; handle: FileSystemDirectoryHandle; name: string };

const PATH_KEY = "kl-implantation/save-folder/v1";
const DATABASE_NAME = "kl-implantation-settings";
const STORE_NAME = "settings";
const HANDLE_KEY = "saveFolder";

function readPath(): SaveFolder | null {
  try {
    const stored = localStorage.getItem(PATH_KEY);
    if (stored === null) return null;
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    if (typeof record.path !== "string" || record.path === "") return null;
    const name = typeof record.name === "string" ? record.name : record.path;
    return { kind: "path", path: record.path, name };
  } catch {
    return null;
  }
}

function openSettings(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = indexedDB.open(DATABASE_NAME, 1);
    } catch {
      resolve(null);
      return;
    }
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) db.createObjectStore(STORE_NAME);
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => resolve(null);
    request.onblocked = () => resolve(null);
  });
}

function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>) {
  return openSettings().then(
    (db) =>
      new Promise<T | undefined>((resolve) => {
        if (!db) {
          resolve(undefined);
          return;
        }
        try {
          const request = work(db.transaction(STORE_NAME, mode).objectStore(STORE_NAME));
          request.onsuccess = () => {
            resolve(request.result);
            db.close();
          };
          request.onerror = () => {
            resolve(undefined);
            db.close();
          };
        } catch {
          resolve(undefined);
          db.close();
        }
      }),
  );
}

function isDirectoryHandle(value: unknown): value is FileSystemDirectoryHandle {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as { kind?: unknown }).kind === "directory" &&
    typeof (value as { name?: unknown }).name === "string"
  );
}

/**
 * The folder set for this host, or `null`. A path wins over a handle: the
 * two never coexist in practice, since each host only ever writes its own.
 */
export async function loadSaveFolder(): Promise<SaveFolder | null> {
  const path = readPath();
  if (path) return path;
  const handle = await run("readonly", (store) => store.get(HANDLE_KEY));
  return isDirectoryHandle(handle) ? { kind: "handle", handle, name: handle.name } : null;
}

/** Remembers `folder`, or forgets the setting when `null`. Resolves to what was actually stored. */
export async function storeSaveFolder(folder: SaveFolder | null): Promise<SaveFolder | null> {
  try {
    if (folder?.kind === "path") {
      localStorage.setItem(PATH_KEY, JSON.stringify({ path: folder.path, name: folder.name }));
    } else {
      localStorage.removeItem(PATH_KEY);
    }
  } catch {
    /* best effort — a full or disabled localStorage must not block the UI */
  }
  if (folder?.kind === "handle") {
    const stored = await run("readwrite", (store) => store.put(folder.handle, HANDLE_KEY));
    return stored === undefined ? null : folder;
  }
  await run("readwrite", (store) => store.delete(HANDLE_KEY));
  return folder;
}

/** Whether this browser can remember a folder at all — Chrome and Edge, not Safari or Firefox. */
export function canPickFolderInBrowser(): boolean {
  return (
    typeof (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker === "function"
  );
}
