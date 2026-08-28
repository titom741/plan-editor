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
export type ToolId = "select" | "rectangle" | "circle" | "line" | "polygon" | "text" | "measure" | "calibrate";

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
  { id: "polygon", label: "Polygone", icon: "⬠" },
  { id: "text", label: "Texte", icon: "T" },
  { id: "measure", label: "Mesure", icon: "📐" },
];
