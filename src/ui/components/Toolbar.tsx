import { getCommand, type CommandId } from "../commands";
import { useState } from "react";
import type { SaveStatus } from "../hooks/useAutosave";

interface ToolbarProps {
  projectName: string;
  /**
   * The file this session is writing to, already described for display.
   * `null` before the first save — there is genuinely nothing to name.
   */
  savedFile: { label: string; detail: string | null } | null;
  onRenameProject: (name?: string) => void;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveStatus: SaveStatus;
  onFitPlan: () => void;
  canFitPlan: boolean;
  /** The commands the user chose to keep within one click. Everything else lives in the left-hand menus. */
  pinnedIds: readonly CommandId[];
  onRunCommand: (id: CommandId) => void;
}

function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
}

/**
 * The autosave indicator's wording. It deliberately never says just
 * "Enregistré" without qualification: the save is local to this browser,
 * and a user who reads it as "my work is safe" would be wrong the moment
 * they clear their site data or open the plan on another machine. The
 * title attribute spells that out, and the failure states point at the
 * one action that actually protects the project — exporting a file.
 */
function describeSaveStatus(status: SaveStatus): {
  label: string;
  title: string;
  modifier: string;
} {
  switch (status.state) {
    case "idle":
      return { label: "", title: "", modifier: "idle" };
    case "dirty":
      return {
        label: "Modifications en cours…",
        title: "Modifications non encore enregistrées.",
        modifier: "dirty",
      };
    case "saving":
      return {
        label: "Enregistrement…",
        title: "Enregistrement local en cours.",
        modifier: "saving",
      };
    case "saved":
      return {
        label: `Enregistré ${formatTime(status.savedAt)}`,
        title:
          "Enregistré dans ce navigateur. Utilisez « Enregistrer un fichier » pour une copie durable, transférable sur une autre machine.",
        modifier: "saved",
      };
    case "unavailable":
      return {
        label: "Sauvegarde locale indisponible",
        title:
          "Ce navigateur n'autorise pas le stockage local (navigation privée ou données de site désactivées). Enregistrez votre projet dans un fichier.",
        modifier: "warning",
      };
    case "error":
      return status.reason === "quota"
        ? {
            label: "Espace de stockage saturé",
            title:
              "Le navigateur n'a plus de place — un fond de plan volumineux en est souvent la cause. Enregistrez votre projet dans un fichier.",
            modifier: "warning",
          }
        : {
            label: "Échec de l'enregistrement",
            title: "L'enregistrement local a échoué. Enregistrez votre projet dans un fichier.",
            modifier: "warning",
          };
  }
}

/**
 * The top bar: what the project is, what state it is in, and the few
 * actions worth permanent space.
 *
 * It used to carry every action the app had — fifteen buttons in one row,
 * none of them findable. The actions now live in the left-hand
 * `CommandMenu`s, and this bar shows only what the user pinned (see
 * `ui/commands.ts`). Undo, redo, fit and the zoom readout stay fixed:
 * they are about the state of the editor rather than things to do with
 * the document, and their enabled state has to be visible at all times.
 */
export function Toolbar({
  projectName,
  savedFile,
  onRenameProject,
  zoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveStatus,
  onFitPlan,
  canFitPlan,
  pinnedIds,
  onRunCommand,
}: ToolbarProps) {
  const save = describeSaveStatus(saveStatus);
  const pinned = pinnedIds.map(getCommand).filter((command) => command !== undefined);
  // The name is a draft while the field has focus, so the commits that
  // land on every keystroke don't yank a half-typed name back. Outside
  // editing it tracks the project — a file opened or an undo has to show.
  // `editingName` is state rather than a read of `document.activeElement`:
  // a render must not depend on where the browser's focus happens to be.
  const [draftName, setDraftName] = useState(projectName);
  const [editingName, setEditingName] = useState(false);
  if (!editingName && draftName !== projectName) setDraftName(projectName);

  return (
    <header className="toolbar">
      <div className="toolbar__brand">Plan Editor</div>
      <div className="toolbar__project">
        <input
          className="toolbar__project-name"
          value={draftName}
          aria-label="Nom du projet"
          title="Modifier le nom du projet"
          onFocus={() => setEditingName(true)}
          onChange={(event) => setDraftName(event.target.value)}
          onBlur={() => {
            setEditingName(false);
            const trimmed = draftName.trim();
            // An emptied field reverts instead of committing: a project
            // with no name is not something anyone means to create.
            if (trimmed && trimmed !== projectName) onRenameProject(trimmed);
            else setDraftName(projectName);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.currentTarget.blur();
            if (event.key === "Escape") {
              setDraftName(projectName);
              setEditingName(false);
              event.currentTarget.blur();
            }
          }}
        />
        {save.label && (
          <span className={`toolbar__save toolbar__save--${save.modifier}`} title={save.title}>
            {save.label}
          </span>
        )}
        {savedFile && (
          // The path when the host can give one — which only the macOS
          // shell's save panel does. A browser names the file and stops
          // there, so the tooltip says why rather than leaving the user
          // to wonder which of the two they are looking at.
          <span
            className="toolbar__file-path"
            title={savedFile.detail ? `${savedFile.label} — ${savedFile.detail}` : savedFile.label}
          >
            {savedFile.label}
          </span>
        )}
      </div>
      <div className="toolbar__file">
        {pinned.map((command) => (
          <button
            key={command.id}
            type="button"
            className="toolbar__button"
            onClick={() => onRunCommand(command.id)}
            title={command.title}
          >
            <span aria-hidden="true">{command.icon}</span> {command.shortLabel}
          </button>
        ))}
        <button
          type="button"
          className="toolbar__button toolbar__button--ghost"
          onClick={() => onRunCommand("customizeToolbar")}
          title="Choisir les boutons épinglés dans cette barre"
          aria-label="Personnaliser la barre"
        >
          ⚙
        </button>
      </div>
      <div className="toolbar__history">
        <button
          type="button"
          className="toolbar__button"
          onClick={onUndo}
          disabled={!canUndo}
          title="Annuler (Ctrl+Z)"
        >
          ↶ Annuler
        </button>
        <button
          type="button"
          className="toolbar__button"
          onClick={onRedo}
          disabled={!canRedo}
          title="Rétablir (Ctrl+Maj+Z)"
        >
          ↷ Rétablir
        </button>
      </div>
      <div className="toolbar__zoom" data-testid="zoom-indicator">
        <button
          type="button"
          className="toolbar__button"
          onClick={onFitPlan}
          disabled={!canFitPlan}
          title="Recentrer et afficher tout le fond de plan"
        >
          Cadrer le plan
        </button>
        Zoom&nbsp;: {Math.round(zoom * 100)}&nbsp;%
      </div>
    </header>
  );
}
