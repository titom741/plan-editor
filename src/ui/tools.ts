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
  | "calibrate";

export interface ToolDefinition {
  id: ToolId;
  label: string;
  icon: string;
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
];
