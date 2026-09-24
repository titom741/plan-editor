import { formatPowerW, type ElectricalNetwork } from "../../domain/electrical";
import type { LabelDisplay } from "../../domain/display";
import { TOOLS, type ToolId } from "../tools";

interface ElectricalPanelProps {
  activeToolId: ToolId;
  onSelectTool: (toolId: ToolId) => void;
  network: ElectricalNetwork;
  /** Opens the single-line diagram, balance and alerts (KL-046). */
  onOpenDiagram: () => void;
  labelDisplay: LabelDisplay;
  onLabelDisplayChange: (display: LabelDisplay) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

const ELECTRICAL_TOOLS = TOOLS.filter((tool) => tool.group === "electrical");

/**
 * The Électricité menu of the left rail (KL-047).
 *
 * It used to be a heading at the bottom of Outils, below eleven drawing
 * tools and the snapping switches — the part of the palette you scroll
 * to. Laying out a network is a job of its own, with its own tools, its
 * own labels and its own diagram, so it gets a menu of its own, one of
 * the four the rail opens one at a time.
 */
export function ElectricalPanel({
  activeToolId,
  onSelectTool,
  network,
  onOpenDiagram,
  labelDisplay,
  onLabelDisplayChange,
  collapsed,
  onToggleCollapsed,
}: ElectricalPanelProps) {
  const errors = network.issues.filter((issue) => issue.severity === "error").length;
  const warnings = network.issues.filter((issue) => issue.severity === "warning").length;

  return (
    <section className={`tools-panel electrical-panel${collapsed ? " is-collapsed" : ""}`}>
      <h2 className="panel__title">
        <button
          type="button"
          className="panel__collapse"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Déplier Électricité" : "Replier Électricité"}
        >
          <span className="panel__title-icon" aria-hidden="true">
            ⚡
          </span>
          <span className="panel__title-text">Électricité {collapsed ? "›" : "‹"}</span>
        </button>
      </h2>
      {!collapsed && (
        <div className="panel__body">
          <ul className="tools-panel__list">
            {ELECTRICAL_TOOLS.map((tool) => (
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
            {activeToolId === "elecCable"
              ? "Tracez le câble d'un équipement à l'autre, comme un tracé : ses extrémités se branchent sur l'équipement où elles tombent. Entrée ou double-clic termine."
              : activeToolId.startsWith("elec")
                ? "Cliquez sur le plan pour poser l'équipement ; ses caractéristiques se règlent dans les propriétés."
                : "Choisissez un équipement, puis cliquez sur le plan. Reliez-les ensuite par des câbles."}
          </p>

          <label className="tools-panel__toggle">
            <input
              type="checkbox"
              checked={labelDisplay.electrical}
              onChange={(event) =>
                onLabelDisplayChange({ ...labelDisplay, electrical: event.target.checked })
              }
            />
            <span>Caractéristiques sur le plan</span>
          </label>

          {!network.isEmpty && (
            <p className="electrical-panel__summary">
              Puissance installée <strong>{formatPowerW(network.totalLoadW)}</strong>
              <br />
              <span className={errors > 0 ? "is-error" : undefined}>{errors} erreur(s)</span> ·{" "}
              <span className={warnings > 0 ? "is-warning" : undefined}>
                {warnings} avertissement(s)
              </span>
            </p>
          )}
          <button type="button" className="properties-panel__button" onClick={onOpenDiagram}>
            ⚡ Schéma électrique…
          </button>
        </div>
      )}
    </section>
  );
}
