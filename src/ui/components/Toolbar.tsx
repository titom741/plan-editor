import type { SaveStatus } from "../hooks/useAutosave";

interface ToolbarProps {
  projectName: string;
  zoom: number;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  saveStatus: SaveStatus;
  onNewProject: () => void;
  onOpenProject: () => void;
  onSaveToFile: () => void;
  onExport: () => void;
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
function describeSaveStatus(status: SaveStatus): { label: string; title: string; modifier: string } {
  switch (status.state) {
    case "idle":
      return { label: "", title: "", modifier: "idle" };
    case "dirty":
      return { label: "Modifications en cours…", title: "Modifications non encore enregistrées.", modifier: "dirty" };
    case "saving":
      return { label: "Enregistrement…", title: "Enregistrement local en cours.", modifier: "saving" };
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

export function Toolbar({
  projectName,
  zoom,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  saveStatus,
  onNewProject,
  onOpenProject,
  onSaveToFile,
  onExport,
}: ToolbarProps) {
  const save = describeSaveStatus(saveStatus);

  return (
    <header className="toolbar">
      <div className="toolbar__brand">Implantation Événementielle</div>
      <div className="toolbar__project">
        {projectName}
        {save.label && (
          <span className={`toolbar__save toolbar__save--${save.modifier}`} title={save.title}>
            {save.label}
          </span>
        )}
      </div>
      <div className="toolbar__file">
        <button type="button" className="toolbar__button" onClick={onNewProject} title="Nouveau projet">
          Nouveau
        </button>
        <button type="button" className="toolbar__button" onClick={onOpenProject} title="Ouvrir un projet (.kl.json)">
          Ouvrir…
        </button>
        <button
          type="button"
          className="toolbar__button"
          onClick={onSaveToFile}
          title="Enregistrer le projet dans un fichier"
        >
          Enregistrer un fichier
        </button>
        <button
          type="button"
          className="toolbar__button"
          onClick={onExport}
          title="Exporter le plan en PDF ou PNG, à l'échelle"
        >
          🖨 Exporter…
        </button>
      </div>
      <div className="toolbar__history">
        <button type="button" className="toolbar__button" onClick={onUndo} disabled={!canUndo} title="Annuler (Ctrl+Z)">
          ↶ Annuler
        </button>
        <button type="button" className="toolbar__button" onClick={onRedo} disabled={!canRedo} title="Rétablir (Ctrl+Maj+Z)">
          ↷ Rétablir
        </button>
      </div>
      <div className="toolbar__zoom" data-testid="zoom-indicator">
        Zoom&nbsp;: {Math.round(zoom * 100)}&nbsp;%
      </div>
    </header>
  );
}
