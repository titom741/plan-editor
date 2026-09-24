/**
 * The set of interaction modes the canvas can be in. Shared between
 * `ToolsPanel` (which lets the user pick one) and `PlanCanvas` (which
 * changes its pointer behavior and cursor based on it) so the two never
 * drift out of sync.
 */
/**
 * `"calibrate"` is a real tool mode (it changes the canvas's click
 * behavior and cursor, like any other) but isn't in `TOOLS` below — it's
 * only reachable from the "Calibrer" button in the properties panel,
 * since it's meaningless without a background image already in place.
 */
export type ToolId =
  | "select"
  | "rectangle"
  | "circle"
  | "line"
  | "arrow"
  | "polyline"
  | "polygon"
  | "text"
  | "symbol"
  | "measure"
  | "calibrate"
  | "elecSource"
  | "elecBoard"
  | "elecCable"
  | "elecStrip"
  | "elecLoad";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  icon: string;
  /** Which heading the tool sits under in the tools panel. Absent means the drawing tools. */
  group?: "electrical";
}

export const TOOLS: ToolDefinition[] = [
  { id: "select", label: "Sélection", icon: "↖" },
  { id: "rectangle", label: "Rectangle", icon: "▭" },
  { id: "circle", label: "Cercle", icon: "◯" },
  { id: "line", label: "Ligne", icon: "／" },
  // Drawn exactly like a line, and *is* a line — the arrowhead is a line
  // style the model has always had. What was missing was a way to draw
  // one without drawing a line first and then hunting for the checkbox.
  { id: "arrow", label: "Flèche", icon: "➔" },
  { id: "polyline", label: "Tracé", icon: "〰" },
  { id: "polygon", label: "Polygone", icon: "⬠" },
  { id: "text", label: "Texte", icon: "T" },
  { id: "symbol", label: "Symbole", icon: "★" },
  { id: "measure", label: "Mesure", icon: "📐" },
  // KL-045. Each places a shape that already knows what it is
  // electrically; the cable is drawn like a tracé and plugs its ends into
  // whatever device they land on.
  { id: "elecSource", label: "Alimentation", icon: "⏻", group: "electrical" },
  { id: "elecBoard", label: "Coffret", icon: "▣", group: "electrical" },
  { id: "elecCable", label: "Câble", icon: "⌇", group: "electrical" },
  { id: "elecStrip", label: "Multiprise", icon: "⋮", group: "electrical" },
  { id: "elecLoad", label: "Récepteur", icon: "⊗", group: "electrical" },
];

/** The device each click-to-place electrical tool drops. The cable tool is drawn, so it isn't here. */
export const DEVICE_TOOL_ROLES: Partial<Record<ToolId, "source" | "board" | "strip" | "load">> = {
  elecSource: "source",
  elecBoard: "board",
  elecStrip: "strip",
  elecLoad: "load",
};
