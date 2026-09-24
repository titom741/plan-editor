import { LABEL_DISPLAY_KEYS, LABEL_DISPLAY_LABELS, type LabelDisplay } from "../../domain/display";
import { symbolsByGroup } from "../../domain/symbols";
import { TOOLS } from "../tools";
import type { ToolId } from "../tools";

/** The drawing tools, then the electrical ones under their own heading (KL-045). */
const TOOL_GROUPS = [
  { key: "draw", heading: null, tools: TOOLS.filter((tool) => !tool.group) },
  {
    key: "electrical",
    heading: "Électricité",
    tools: TOOLS.filter((tool) => tool.group === "electrical"),
  },
];

interface ToolsPanelProps {
  activeToolId: ToolId;
  onSelectTool: (toolId: ToolId) => void;
  /** The character the symbol tool places — shown as the selected cell of the palette below. */
  symbolCharacter: string;
  onSymbolCharacterChange: (character: string) => void;
  snapEnabled: boolean;
  onSnapEnabledChange: (enabled: boolean) => void;
  gridVisible: boolean;
  onGridVisibleChange: (visible: boolean) => void;
  gridLimited: boolean;
  onGridLimitedChange: (limited: boolean) => void;
  gridLimitForced?: boolean;
  /** Plan-wide label setting. Objects may override it one by one from the properties panel. */
  labelDisplay: LabelDisplay;
  onLabelDisplayChange: (display: LabelDisplay) => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

export function ToolsPanel({
  activeToolId,
  onSelectTool,
  symbolCharacter,
  onSymbolCharacterChange,
  snapEnabled,
  onSnapEnabledChange,
  gridVisible,
  onGridVisibleChange,
  gridLimited,
  onGridLimitedChange,
  gridLimitForced = false,
  labelDisplay,
  onLabelDisplayChange,
  collapsed = false,
  onToggleCollapsed,
}: ToolsPanelProps) {
  return (
    <aside className={`tools-panel${collapsed ? " is-collapsed" : ""}`}>
      <h2 className="panel__title">
        <button
          type="button"
          className="panel__collapse"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Déplier les outils" : "Replier les outils"}
        >
          <span className="panel__title-icon" aria-hidden="true">
            🛠
          </span>
          <span className="panel__title-text">Outils {collapsed ? "›" : "‹"}</span>
        </button>
      </h2>
      {!collapsed && (
        <>
          {TOOL_GROUPS.map(({ key, heading, tools }) => (
            <div key={key}>
              {heading && <h3 className="tools-panel__group">{heading}</h3>}
              <ul className="tools-panel__list">
                {tools.map((tool) => (
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
            </div>
          ))}
          {/*
            Shown only while the symbol tool is active. A palette that was
            always on screen would take the room the tools themselves
            need, and it is meaningless until you are about to place one.
          */}
          {activeToolId === "symbol" && (
            <fieldset className="tools-panel__symbols">
              <legend>Symbole à poser</legend>
              {symbolsByGroup().map(({ group, symbols }) => (
                <div key={group} className="tools-panel__symbol-group">
                  <span className="tools-panel__symbol-title">{group}</span>
                  <div className="tools-panel__symbol-grid">
                    {symbols.map((symbol) => (
                      <button
                        key={symbol.character}
                        type="button"
                        className={`tools-panel__symbol${
                          symbol.character === symbolCharacter ? " is-active" : ""
                        }`}
                        aria-pressed={symbol.character === symbolCharacter}
                        title={symbol.name}
                        onClick={() => onSymbolCharacterChange(symbol.character)}
                      >
                        <span aria-hidden="true">{symbol.character}</span>
                        <span className="visually-hidden">{symbol.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </fieldset>
          )}
          <label className="tools-panel__toggle">
            <input
              type="checkbox"
              checked={snapEnabled}
              onChange={(e) => onSnapEnabledChange(e.target.checked)}
            />
            <span>Magnétisme</span>
          </label>
          <label className="tools-panel__toggle">
            <input
              type="checkbox"
              checked={gridVisible}
              onChange={(e) => onGridVisibleChange(e.target.checked)}
            />
            <span>Afficher la grille</span>
          </label>
          <label className="tools-panel__toggle">
            <input
              type="checkbox"
              checked={gridLimited}
              disabled={!gridVisible || gridLimitForced}
              onChange={(e) => onGridLimitedChange(e.target.checked)}
            />
            <span>{gridLimitForced ? "Grille bornée au plan" : "Limiter au fond"}</span>
          </label>
          <fieldset className="tools-panel__display">
            <legend>Étiquettes des objets</legend>
            {LABEL_DISPLAY_KEYS.map((key) => (
              <label key={key} className="tools-panel__toggle">
                <input
                  type="checkbox"
                  checked={labelDisplay[key]}
                  onChange={(event) =>
                    onLabelDisplayChange({ ...labelDisplay, [key]: event.target.checked })
                  }
                />
                <span>{LABEL_DISPLAY_LABELS[key]}</span>
              </label>
            ))}
          </fieldset>
          <p className="tools-panel__hint">
            {activeToolId === "measure" &&
              "Cliquez les points à mesurer. Entrée l'ajoute au plan, Échap l'efface."}
            {activeToolId === "polyline" &&
              "Cliquez pour poser des points ; maintenez le bouton et glissez pour dessiner à main levée. Entrée ou double-clic termine, Retour arrière annule le dernier point, Échap efface."}
            {activeToolId === "polygon" &&
              "Cliquez pour ajouter des points, Entrée pour terminer, Échap pour annuler."}
            {activeToolId === "calibrate" &&
              "Cliquez deux points d'une distance connue sur le fond de plan, Échap pour annuler."}
            {activeToolId === "arrow" &&
              "Pressez au départ, glissez jusqu'à la pointe, relâchez. Maintenez Maj pour contraindre l'angle par pas de 15°."}
            {activeToolId === "symbol" &&
              "Choisissez un symbole ci-dessus, puis cliquez sur le plan. Sa taille se règle ensuite dans les propriétés."}
            {activeToolId === "elecCable" &&
              "Tracez le câble d'un équipement à l'autre, comme un tracé : ses extrémités se branchent sur l'équipement où elles tombent. Entrée ou double-clic termine."}
            {(activeToolId === "elecSource" ||
              activeToolId === "elecBoard" ||
              activeToolId === "elecStrip" ||
              activeToolId === "elecLoad") &&
              "Cliquez sur le plan pour poser l'équipement ; ses caractéristiques se règlent dans les propriétés."}
            {activeToolId !== "polygon" &&
              activeToolId !== "polyline" &&
              activeToolId !== "calibrate" &&
              activeToolId !== "measure" &&
              activeToolId !== "arrow" &&
              activeToolId !== "symbol" &&
              !activeToolId.startsWith("elec") &&
              "Échap désélectionne. Suppr efface l'objet sélectionné."}
          </p>
          <p className="tools-panel__hint">
            {snapEnabled
              ? "Les points s'aimantent à la grille et aux objets. Maintenez Alt pour l'ignorer."
              : "Magnétisme désactivé — les points suivent exactement le curseur."}
          </p>
        </>
      )}
    </aside>
  );
}
