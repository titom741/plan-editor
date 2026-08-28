import { TOOLS } from "../tools";
import type { ToolId } from "../tools";

interface ToolsPanelProps {
  activeToolId: ToolId;
  onSelectTool: (toolId: ToolId) => void;
  snapEnabled: boolean;
  onSnapEnabledChange: (enabled: boolean) => void;
  gridVisible: boolean;
  onGridVisibleChange: (visible: boolean) => void;
  gridLimited: boolean;
  onGridLimitedChange: (limited: boolean) => void;
  gridLimitForced?: boolean;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function ToolsPanel({ activeToolId, onSelectTool, snapEnabled, onSnapEnabledChange, gridVisible, onGridVisibleChange, gridLimited, onGridLimitedChange, gridLimitForced = false, collapsed = false, onToggleCollapsed }: ToolsPanelProps) {
  return (
    <aside className={`tools-panel${collapsed ? " is-collapsed" : ""}`}>
      <h2 className="panel__title"><button type="button" className="panel__collapse" onClick={onToggleCollapsed} aria-expanded={!collapsed} title={collapsed ? "Déplier les outils" : "Replier les outils"}>{collapsed ? "🛠" : "Outils ‹"}</button></h2>
      {!collapsed && <>
      <ul className="tools-panel__list">
        {TOOLS.map((tool) => (
          <li key={tool.id}>
            <button
              type="button"
              className={`tools-panel__button${tool.id === activeToolId ? " is-active" : ""}`}
              onClick={() => onSelectTool(tool.id)}
              title={tool.label}
            >
              <span aria-hidden="true">{tool.icon}</span>
              <span>{tool.label}</span>
            </button>
          </li>
        ))}
      </ul>
      <label className="tools-panel__toggle">
        <input
          type="checkbox"
          checked={snapEnabled}
          onChange={(e) => onSnapEnabledChange(e.target.checked)}
        />
        <span>Magnétisme</span>
      </label>
      <label className="tools-panel__toggle">
        <input type="checkbox" checked={gridVisible} onChange={(e) => onGridVisibleChange(e.target.checked)} />
        <span>Afficher la grille</span>
      </label>
      <label className="tools-panel__toggle">
        <input type="checkbox" checked={gridLimited} disabled={!gridVisible || gridLimitForced} onChange={(e) => onGridLimitedChange(e.target.checked)} />
        <span>{gridLimitForced ? "Grille bornée au plan" : "Limiter au fond"}</span>
      </label>
      <p className="tools-panel__hint">
        {activeToolId === "measure" &&
          "Cliquez les points à mesurer. Entrée l'ajoute au plan, Échap l'efface."}
        {activeToolId === "polygon" &&
          "Cliquez pour ajouter des points, Entrée pour terminer, Échap pour annuler."}
        {activeToolId === "calibrate" &&
          "Cliquez deux points d'une distance connue sur le fond de plan, Échap pour annuler."}
        {activeToolId !== "polygon" &&
          activeToolId !== "calibrate" &&
          activeToolId !== "measure" &&
          "Échap désélectionne. Suppr efface l'objet sélectionné."}
      </p>
      <p className="tools-panel__hint">
        {snapEnabled
          ? "Les points s'aimantent à la grille et aux objets. Maintenez Alt pour l'ignorer."
          : "Magnétisme désactivé — les points suivent exactement le curseur."}
      </p>
      </>}
    </aside>
  );
}
