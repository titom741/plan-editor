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
import { createId } from "../domain/ids";

const DATABASE_NAME = "kl-implantation";
const DATABASE_VERSION = 1;
const STORE_NAME = "projects";

/** Key of the single autosave record. Named rather than numbered so adding named slots later doesn't collide. */
const AUTOSAVE_KEY = "autosave";
const PROJECT_KEY_PREFIX = "project:";
const VERSION_KEY_PREFIX = "version:";

export interface StoredProjectSummary {
  id: string;
  name: string;
  location: string;
  updatedAt: string;
  savedAt: string;
  objectCount: number;
}

export interface StoredVersionSummary {
  key: string;
  projectId: string;
  savedAt: string;
  name: string;
  objectCount: number;
  automatic: boolean;
}

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
    const store = transaction.objectStore(STORE_NAME);
    await Promise.all([
      promisifyRequest(store.put(file, AUTOSAVE_KEY)),
      promisifyRequest(store.put(file, `${PROJECT_KEY_PREFIX}${project.id}`)),
    ]);
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

export async function listStoredProjects(): Promise<StoredProjectSummary[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const store = transaction.objectStore(STORE_NAME);
    const keysRequest = promisifyRequest(store.getAllKeys());
    const valuesRequest = promisifyRequest(store.getAll());
    const [keys, allValues] = await Promise.all([keysRequest, valuesRequest]);
    const projectKeys = keys.filter((key): key is string => typeof key === "string" && key.startsWith(PROJECT_KEY_PREFIX));
    const summaries: StoredProjectSummary[] = [];
    keys.forEach((key, index) => {
      if (typeof key !== "string" || !projectKeys.includes(key)) return;
      const value = allValues[index];
      const parsed = parseProjectFile(value);
      if (!parsed.ok) return;
      const { project } = parsed.file;
      summaries.push({ id: project.id, name: project.name, location: project.location, updatedAt: project.updatedAt, savedAt: parsed.file.savedAt, objectCount: project.objects.length });
    });
    return summaries.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function loadStoredProject(id: string): Promise<LoadResult> {
  const db = await openDatabase();
  if (!db) return { status: "unavailable" };
  try {
    const transaction = db.transaction(STORE_NAME, "readonly");
    const stored = await promisifyRequest(transaction.objectStore(STORE_NAME).get(`${PROJECT_KEY_PREFIX}${id}`));
    if (stored === undefined) return { status: "empty" };
    const result = parseProjectFile(stored);
    return result.ok ? { status: "loaded", file: result.file } : { status: "corrupt", error: result.error };
  } catch {
    return { status: "unavailable" };
  } finally {
    db.close();
  }
}

export async function deleteStoredProject(id: string): Promise<boolean> {
  const db = await openDatabase();
  if (!db) return false;
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await promisifyRequest(transaction.objectStore(STORE_NAME).delete(`${PROJECT_KEY_PREFIX}${id}`));
    return true;
  } catch {
    return false;
  } finally {
    db.close();
  }
}

async function putProjectFile(key: string, project: Project): Promise<SaveResult> {
  const db = await openDatabase();
  if (!db) return { status: "unavailable" };
  const file = toProjectFile(project);
  try {
    const transaction = db.transaction(STORE_NAME, "readwrite");
    await promisifyRequest(transaction.objectStore(STORE_NAME).put(file, key));
    return { status: "saved", savedAt: file.savedAt };
  } catch (error) {
    if (error instanceof DOMException && error.name === "QuotaExceededError") return { status: "quotaExceeded" };
    return { status: "failed", message: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
}

export async function renameStoredProject(id: string, name: string): Promise<boolean> {
  const loaded = await loadStoredProject(id);
  if (loaded.status !== "loaded") return false;
  const now = new Date().toISOString();
  const project = { ...loaded.file.project, name: name.trim() || loaded.file.project.name, updatedAt: now };
  return (await putProjectFile(`${PROJECT_KEY_PREFIX}${id}`, project)).status === "saved";
}

export async function duplicateStoredProject(id: string, name?: string): Promise<Project | null> {
  const loaded = await loadStoredProject(id);
  if (loaded.status !== "loaded") return null;
  const now = new Date().toISOString();
  const copy: Project = {
    ...loaded.file.project,
    id: createId("project"),
    name: name?.trim() || `${loaded.file.project.name} — copie`,
    createdAt: now,
    updatedAt: now,
  };
  const result = await putProjectFile(`${PROJECT_KEY_PREFIX}${copy.id}`, copy);
  return result.status === "saved" ? copy : null;
}

export async function saveProjectVersion(project: Project): Promise<SaveResult> {
  const savedAt = new Date().toISOString();
  return putProjectFile(`${VERSION_KEY_PREFIX}${project.id}:manual:${savedAt}`, project);
}

const AUTOMATIC_VERSION_INTERVAL_MS = 5 * 60 * 1000;
const MAX_AUTOMATIC_VERSIONS = 20;

/** Keeps a bounded, automatic recovery trail without duplicating a large background after every keystroke. */
export async function saveAutomaticProjectVersion(project: Project): Promise<SaveResult> {
  const versions = await listProjectVersions(project.id);
  const latestAutomatic = versions.find((version) => version.automatic);
  if (latestAutomatic && Date.now() - new Date(latestAutomatic.savedAt).getTime() < AUTOMATIC_VERSION_INTERVAL_MS) {
    return { status: "saved", savedAt: latestAutomatic.savedAt };
  }
  const savedAt = new Date().toISOString();
  const result = await putProjectFile(`${VERSION_KEY_PREFIX}${project.id}:auto:${savedAt}`, project);
  if (result.status !== "saved") return result;

  const db = await openDatabase();
  if (!db) return result;
  try {
    const automatic = (await listProjectVersions(project.id)).filter((version) => version.automatic);
    const obsolete = automatic.slice(MAX_AUTOMATIC_VERSIONS);
    if (obsolete.length > 0) {
      const store = db.transaction(STORE_NAME, "readwrite").objectStore(STORE_NAME);
      await Promise.all(obsolete.map((version) => promisifyRequest(store.delete(version.key))));
    }
  } catch {
    // The project itself is saved; pruning an old recovery point is best-effort.
  } finally {
    db.close();
  }
  return result;
}

export async function listProjectVersions(projectId: string): Promise<StoredVersionSummary[]> {
  const db = await openDatabase();
  if (!db) return [];
  try {
    const store = db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME);
    const [keys, values] = await Promise.all([promisifyRequest(store.getAllKeys()), promisifyRequest(store.getAll())]);
    const prefix = `${VERSION_KEY_PREFIX}${projectId}:`;
    const versionKeys = keys.filter((key): key is string => typeof key === "string" && key.startsWith(prefix));
    const versions: StoredVersionSummary[] = [];
    keys.forEach((key, index) => {
      if (typeof key !== "string" || !versionKeys.includes(key)) return;
      const value = values[index];
      const parsed = parseProjectFile(value);
      if (!parsed.ok) return;
      versions.push({ key, projectId, savedAt: parsed.file.savedAt, name: parsed.file.project.name, objectCount: parsed.file.project.objects.length, automatic: key.includes(":auto:") });
    });
    return versions.sort((a, b) => b.savedAt.localeCompare(a.savedAt));
  } catch {
    return [];
  } finally {
    db.close();
  }
}

export async function loadProjectVersion(key: string): Promise<LoadResult> {
  if (!key.startsWith(VERSION_KEY_PREFIX)) return { status: "empty" };
  const db = await openDatabase();
  if (!db) return { status: "unavailable" };
  try {
    const stored = await promisifyRequest(db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(key));
    if (stored === undefined) return { status: "empty" };
    const parsed = parseProjectFile(stored);
    return parsed.ok ? { status: "loaded", file: parsed.file } : { status: "corrupt", error: parsed.error };
  } catch {
    return { status: "unavailable" };
  } finally {
    db.close();
  }
}

// There is deliberately no `clear` function. Every way of leaving a
// project behind (opening a file, starting a new one) replaces it with
// another project that the autosave then writes over the same record, so a
// delete would only ever race that write — and losing that race would
// destroy the document the user had just chosen.
