import { TOOLS } from "../tools";
import type { ToolId } from "../tools";

interface ToolsPanelProps {
  activeToolId: ToolId;
  onSelectTool: (toolId: ToolId) => void;
}

export function ToolsPanel({ activeToolId, onSelectTool }: ToolsPanelProps) {
  return (
    <aside className="tools-panel">
      <h2 className="panel__title">Outils</h2>
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
      <p className="tools-panel__hint">
        {activeToolId === "polygon" &&
          "Cliquez pour ajouter des points, Entrée pour terminer, Échap pour annuler."}
        {activeToolId === "calibrate" &&
          "Cliquez deux points d'une distance connue sur le fond de plan, Échap pour annuler."}
        {activeToolId !== "polygon" &&
          activeToolId !== "calibrate" &&
          "Échap désélectionne. Suppr efface l'objet sélectionné."}
      </p>
    </aside>
  );
}
