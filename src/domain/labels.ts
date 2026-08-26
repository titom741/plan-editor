import type { PlanObject, Project } from "./types";

/**
 * Formats a meter value for display: whole numbers with no decimals,
 * otherwise trimmed to two decimals (e.g. `10` -> `"10"`, `2.5` -> `"2.5"`).
 */
export function formatMeters(valueM: number): string {
  if (Number.isInteger(valueM)) return String(valueM);
  return valueM.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

/**
 * A short human-readable summary of an object's real-world dimensions,
 * derived purely from its geometry (e.g. `"10 × 5 m"`). Returns `null` for
 * object types with no single natural "size" to summarize.
 */
export function getObjectDimensionSummary(object: PlanObject): string | null {
  switch (object.type) {
    case "rectangle":
      return `${formatMeters(object.widthM)} × ${formatMeters(object.heightM)} m`;
    case "circle":
      return `⌀ ${formatMeters(object.radiusM * 2)} m`;
    case "text":
    case "line":
    case "polygon":
      return null;
  }
}

/**
 * The label to render on the canvas for an object: the user's explicit
 * `label` override if set, otherwise the object's name plus its dimension
 * summary. Computed on demand so it always reflects the current geometry —
 * nothing stale is ever stored on the object itself.
 */
export function getObjectDisplayLabel(object: PlanObject): string {
  if (object.label) return object.label;
  const dimensions = getObjectDimensionSummary(object);
  return dimensions ? `${object.name}\n${dimensions}` : object.name;
}

const TYPE_NAME_PREFIXES: Record<PlanObject["type"], string> = {
  rectangle: "Rectangle",
  circle: "Cercle",
  line: "Ligne",
  polygon: "Polygone",
  text: "Texte",
};

/**
 * A default name for a newly-created object, e.g. `"Rectangle 3"` if the
 * project already has two rectangles. Purely a naming convenience — users
 * can always rename an object afterwards via the properties panel.
 */
export function nextObjectName(project: Project, type: PlanObject["type"]): string {
  const countOfType = project.objects.filter((object) => object.type === type).length;
  return `${TYPE_NAME_PREFIXES[type]} ${countOfType + 1}`;
}
