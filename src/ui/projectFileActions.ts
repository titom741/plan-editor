import { deserializeProject, serializeProject } from "../persistence/projectFile";
import type { ParseError, ParseResult } from "../persistence/projectFile";
import type { Project } from "../domain/types";
import { isNativeBridgeAvailable, nativeOpen, nativeSave, nativeSaveAs } from "./nativeBridge";

/**
 * Saving a project to, and opening one from, a file the user picks —
 * the manual counterpart to the automatic local save.
 *
 * This is the only durable copy the user *owns*: the autosave lives in
 * browser storage, which a cleared cache, a different browser, or a
 * different machine will not have. Exporting is what makes a project
 * survivable and shareable, so it's a first-class action rather than a
 * hidden one.
 */

/**
 * The extension new files are written with.
 *
 * A single component, not `.kl.json`: macOS associates documents by
 * extension through Launch Services, and it does not reliably match a
 * two-part one — `.kl.json` is seen as `.json`, and claiming *that* would
 * mean claiming every JSON file on the machine. The contents are still
 * JSON, which is the part that matters: a project file is the only copy
 * the user owns, and it stays readable in any text editor.
 */
const FILE_EXTENSION = ".kli";

/** Still opened, and always will be: files written before the rename must not become unreadable. */
const LEGACY_FILE_EXTENSION = ".kl.json";

/** Extensions an open dialog accepts, current one first. */
export const PROJECT_FILE_EXTENSIONS: readonly string[] = [
  FILE_EXTENSION,
  LEGACY_FILE_EXTENSION,
  ".json",
];

/** Builds a filename from the project's name — accents folded, punctuation collapsed — falling back to a generic name if nothing usable is left. */
export function suggestedFileName(project: Project): string {
  const slug = project.name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `${slug || "projet"}${FILE_EXTENSION}`;
}

/** Triggers a download of the project as a `.kli` file. */
export function downloadProjectFile(project: Project): void {
  const blob = new Blob([serializeProject(project)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = suggestedFileName(project);
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Freed on the next tick rather than immediately: revoking synchronously
  // can cancel the download in some browsers before it has started reading.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** The slice of File System Access this app uses. Declared here because the DOM lib doesn't ship it and Safari/WKWebView don't implement it. */
interface SaveFilePicker {
  (options: {
    suggestedName: string;
    types: { description: string; accept: Record<string, string[]> }[];
  }): Promise<{
    /** The file the user settled on — which may not be `suggestedName`, and is all a browser will name. */
    name: string;
    createWritable: () => Promise<{
      write: (data: string) => Promise<void>;
      close: () => Promise<void>;
    }>;
  }>;
}

/**
 * Where a save went, so a later plain "Enregistrer" can go back to the
 * same place without asking again. `null` means nothing has been chosen
 * yet and a save must ask.
 */
export type SaveDestination =
  /** The macOS shell's save panel: a real path on disk, which is the point of the shell. */
  | { kind: "path"; path: string; name: string }
  /** File System Access: the user picked the folder, but the browser does not name it to us. */
  | { kind: "picked"; name: string }
  /** The download fallback: it went wherever this browser puts downloads. */
  | { kind: "downloaded"; name: string }
  | null;

export type SaveOutcome =
  | { status: "saved"; destination: SaveDestination }
  | { status: "cancelled" }
  | { status: "failed"; message: string };

/**
 * Saves where the user says, by whichever of three routes the host
 * offers, in decreasing order of how much control it gives them:
 *
 * 1. **The macOS shell's `NSSavePanel`.** A real file path, and the one
 *    reason this bridge exists: `WKWebView` has no File System Access, so
 *    inside the app every save used to land in Downloads.
 * 2. **File System Access.** Chrome and Edge; the user picks the folder.
 * 3. **A plain download.** Safari and Firefox. Not an error path — it is
 *    simply all those browsers can do.
 *
 * A dismissed dialog reports `cancelled`. Cancelling is a decision, and
 * telling the user their save failed for it would be a lie.
 */
export async function saveProjectFileAs(project: Project): Promise<SaveOutcome> {
  const contents = serializeProject(project);
  const suggestedName = suggestedFileName(project);

  if (isNativeBridgeAvailable()) {
    const result = await nativeSaveAs(suggestedName, contents);
    if (result.status === "cancelled") return { status: "cancelled" };
    if (result.status === "failed") return { status: "failed", message: result.message };
    return { status: "saved", destination: { kind: "path", path: result.path, name: result.name } };
  }

  const picker = (globalThis as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    downloadProjectFile(project);
    return { status: "saved", destination: { kind: "downloaded", name: suggestedName } };
  }
  let writable;
  // Held outside the try so the saved file can be named afterwards; the
  // picker's own rejection is the only thing that block is guarding.
  let savedName = suggestedName;
  try {
    const handle = await picker({
      suggestedName,
      types: [
        {
          description: "Projet d'implantation",
          accept: { "application/json": [FILE_EXTENSION, LEGACY_FILE_EXTENSION] },
        },
      ],
    });
    savedName = handle.name;
    writable = await handle.createWritable();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      return { status: "cancelled" };
    }
    throw error;
  }
  await writable.write(contents);
  await writable.close();
  // `handle.name` is the file, and all of it a browser will say: the
  // folder the user just picked is deliberately never exposed to a page.
  return { status: "saved", destination: { kind: "picked", name: savedName } };
}

/**
 * Writes back to the file this session already saved to, with no dialog.
 * Falls through to `saveProjectFileAs` when there is nowhere known to
 * write — the first save of a session, or a host that never gave us a
 * path in the first place.
 */
export async function saveProjectFile(
  project: Project,
  destination: SaveDestination,
): Promise<SaveOutcome> {
  if (destination?.kind === "path" && isNativeBridgeAvailable()) {
    const result = await nativeSave(destination.path, serializeProject(project));
    if (result.status === "cancelled") return { status: "cancelled" };
    if (result.status === "failed") return { status: "failed", message: result.message };
    return { status: "saved", destination };
  }
  return saveProjectFileAs(project);
}

/**
 * Opens through the system panel when the shell provides one. Returns
 * `null` when there is no bridge, so the caller falls back to its hidden
 * `<input type="file">`.
 */
export async function openProjectFileNatively(): Promise<
  { result: ParseResult; destination: SaveDestination } | { cancelled: true } | null
> {
  if (!isNativeBridgeAvailable()) return null;
  const opened = await nativeOpen();
  if (opened.status === "cancelled") return { cancelled: true };
  if (opened.status === "failed" || opened.contents === undefined) {
    return { result: { ok: false, error: { code: "notJson" } }, destination: null };
  }
  return {
    result: deserializeProject(opened.contents),
    destination: { kind: "path", path: opened.path, name: opened.name },
  };
}

/** Reads a picked file and validates it. Rejects nothing — an unreadable file comes back as a `ParseError` like any other bad input. */
export async function readProjectFile(file: File): Promise<ParseResult> {
  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: { code: "notJson" } };
  }
  return deserializeProject(text);
}

/**
 * Validates text that already came from a file. The macOS shell hands
 * over the contents rather than a `File`, so this is the same door as
 * `readProjectFile` with the reading already done.
 */
export function readProjectText(contents: string): ParseResult {
  return deserializeProject(contents);
}

/** French, user-facing explanation of why a file couldn't be opened. The persistence layer emits codes; the wording lives here, with the rest of the UI's copy. */
export function describeParseError(error: ParseError): string {
  switch (error.code) {
    case "notJson":
      return "Ce fichier n'est pas lisible : ce n'est pas du JSON valide.";
    case "notAnObject":
      return "Ce fichier ne contient pas un projet.";
    case "unknownFormat":
      return `Ce fichier n'est pas un projet d'implantation (extension attendue : ${FILE_EXTENSION}).`;
    case "unsupportedVersion":
      return `Ce fichier a été enregistré par une version plus récente de l'application (format ${error.found}, cette version lit jusqu'au format ${error.supported}). Mettez l'application à jour pour l'ouvrir.`;
    case "invalidField":
      return `Ce fichier est incomplet ou endommagé : le champ « ${error.path} » est absent ou invalide.`;
    case "danglingLayerRef":
      return `Ce fichier est incohérent : l'objet « ${error.objectId} » référence un calque absent (« ${error.layerId} »).`;
  }
}

/**
 * What to show the user about the file they are editing.
 *
 * The honest part is the second half. A browser never tells the page which
 * folder a save panel landed in — that is a deliberate boundary, not a
 * gap to work around — so the web build can name the file and no more.
 * The macOS shell goes through `NSSavePanel` and gets the real path, which
 * is the whole reason it exists; saying so is better than showing a bare
 * file name in both and letting the user wonder which one they are in.
 */
export function describeSaveDestination(destination: SaveDestination): {
  label: string;
  detail: string | null;
} | null {
  if (!destination) return null;
  switch (destination.kind) {
    case "path":
      return { label: destination.path, detail: null };
    case "picked":
      return {
        label: destination.name,
        detail: "Le navigateur ne communique pas le dossier choisi à la page.",
      };
    case "downloaded":
      return {
        label: destination.name,
        detail: "Enregistré dans les téléchargements de ce navigateur.",
      };
  }
}
