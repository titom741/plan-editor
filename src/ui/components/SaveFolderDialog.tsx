import { useState } from "react";
import { canPickFolderInBrowser, type SaveFolder } from "../../persistence/saveFolder";
import { isNativeBridgeAvailable, nativeChooseFolder } from "../nativeBridge";

interface SaveFolderDialogProps {
  folder: SaveFolder | null;
  onChange: (folder: SaveFolder | null) => void;
  onClose: () => void;
}

/**
 * The "Dossier d'enregistrement" setting (KL-053): where "Enregistrer
 * sous" and "Ouvrir" open. What it can offer depends on the host, and it
 * says so rather than showing a button that cannot work — see
 * `persistence/saveFolder.ts`.
 */
export function SaveFolderDialog({ folder, onChange, onClose }: SaveFolderDialogProps) {
  const native = isNativeBridgeAvailable();
  const browser = !native && canPickFolderInBrowser();
  const [error, setError] = useState<string | null>(null);

  const choose = async () => {
    setError(null);
    if (native) {
      const result = await nativeChooseFolder(folder?.kind === "path" ? folder.path : undefined);
      if (result.status === "failed") setError(result.message);
      if (result.status === "ok") onChange({ kind: "path", path: result.path, name: result.name });
      return;
    }
    const picker = (
      globalThis as {
        showDirectoryPicker?: (options: {
          id?: string;
          mode?: "read" | "readwrite";
          startIn?: FileSystemDirectoryHandle;
        }) => Promise<FileSystemDirectoryHandle>;
      }
    ).showDirectoryPicker;
    if (!picker) return;
    try {
      const handle = await picker({
        id: "plan-editor-save-folder",
        mode: "readwrite",
        ...(folder?.kind === "handle" ? { startIn: folder.handle } : {}),
      });
      onChange({ kind: "handle", handle, name: handle.name });
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog save-folder-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="save-folder-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="save-folder-title">Dossier d&apos;enregistrement</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        {native || browser ? (
          <>
            <p>
              {native
                ? "« Enregistrer sous » et « Ouvrir » s'ouvrent"
                : "« Enregistrer sous » s'ouvre"}{" "}
              directement dans ce dossier. Le choix reste possible à chaque fois : c&apos;est un
              point de départ, pas une obligation.
            </p>
            <div className="save-folder-dialog__current">
              <span>Dossier actuel</span>
              <strong>
                {folder
                  ? folder.kind === "path"
                    ? folder.path
                    : `📁 ${folder.name}`
                  : "Aucun — la fenêtre s'ouvre là où elle était la dernière fois"}
              </strong>
            </div>
            {browser && (
              <p className="properties-panel__hint">
                Le navigateur ne donne que le nom du dossier, jamais son chemin complet : c&apos;est
                une protection de la vie privée. L&apos;app macOS, elle, affiche le chemin.
              </p>
            )}
            {error && <p className="app-notice__text">⚠ {error}</p>}
          </>
        ) : (
          <p>
            Ce navigateur (Safari, Firefox…) ne sait qu&apos;enregistrer par téléchargement : le
            fichier va dans son dossier de téléchargements, réglable dans ses propres préférences.
            Pour choisir un dossier ici, utilise Chrome, Edge ou l&apos;app macOS.
          </p>
        )}

        <div className="dialog__actions">
          {(native || browser) && (
            <button type="button" className="dialog__primary" onClick={() => void choose()}>
              {folder ? "Changer de dossier…" : "Choisir un dossier…"}
            </button>
          )}
          {folder && (
            <button type="button" onClick={() => onChange(null)}>
              Ne plus utiliser de dossier
            </button>
          )}
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
