import { deserializeProject, serializeProject } from "../persistence/projectFile";
import type { ParseError, ParseResult } from "../persistence/projectFile";
import type { Project } from "../domain/types";

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

const FILE_EXTENSION = ".kl.json";

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

/** Triggers a download of the project as a `.kl.json` file. */
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
    createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }>;
  }>;
}

/**
 * Saves through the browser's native save dialog when it has one, so the
 * user picks the folder and the name instead of the file landing in
 * Downloads. Falls back to a plain download everywhere else — Safari and
 * the macOS WKWebView shell included, which is why the fallback isn't
 * an error path.
 *
 * Returns `false` when the user dismissed the dialog. Cancelling is not a
 * failure and must not be reported as one, which is the whole reason this
 * doesn't simply let the `AbortError` escape.
 */
export async function saveProjectFileAs(project: Project): Promise<boolean> {
  const picker = (window as Window & { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
  if (!picker) {
    downloadProjectFile(project);
    return true;
  }
  let writable;
  try {
    const handle = await picker({
      suggestedName: suggestedFileName(project),
      types: [{ description: "Projet KL", accept: { "application/json": [".kl.json"] } }],
    });
    writable = await handle.createWritable();
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") return false;
    throw error;
  }
  await writable.write(serializeProject(project));
  await writable.close();
  return true;
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

/** French, user-facing explanation of why a file couldn't be opened. The persistence layer emits codes; the wording lives here, with the rest of the UI's copy. */
export function describeParseError(error: ParseError): string {
  switch (error.code) {
    case "notJson":
      return "Ce fichier n'est pas lisible : ce n'est pas du JSON valide.";
    case "notAnObject":
      return "Ce fichier ne contient pas un projet.";
    case "unknownFormat":
      return "Ce fichier n'est pas un projet d'implantation (extension attendue : .kl.json).";
    case "unsupportedVersion":
      return `Ce fichier a été enregistré par une version plus récente de l'application (format ${error.found}, cette version lit jusqu'au format ${error.supported}). Mettez l'application à jour pour l'ouvrir.`;
    case "invalidField":
      return `Ce fichier est incomplet ou endommagé : le champ « ${error.path} » est absent ou invalide.`;
    case "danglingLayerRef":
      return `Ce fichier est incohérent : l'objet « ${error.objectId} » référence un calque absent (« ${error.layerId} »).`;
  }
}
