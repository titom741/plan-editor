import { DEFAULT_LABEL_DISPLAY, type LabelDisplay } from "./display";
import type { PlanObject, Project } from "./types";
import { cableLengthM, electricalSummary, isCable, type ElectricalRole } from "./electrical";
import {
  angleAtPointDeg,
  formatAngleDeg,
  polygonAreaM2,
  polygonPerimeterM,
  polylineLengthM,
  formatAreaM2,
  formatLengthM,
} from "./measure";

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
    case "line":
      // A cable states the length that will be laid, which is the one
      // typed in when it differs from the drawing (KL-045).
      return formatLengthM(
        isCable(object) ? cableLengthM(object) : polylineLengthM(object.pointsM),
      );
    case "polygon":
      return `${formatLengthM(polygonPerimeterM(object.pointsM))} · ${formatAreaM2(polygonAreaM2(object.pointsM))}`;
    case "text":
      return null;
    case "symbol":
      // Its height on the ground — the one dimension a symbol has, and
      // the one that decides whether it still reads at the print scale.
      return `${formatMeters(object.sizeM)} m`;
    case "image":
      return `${formatMeters(object.widthM)} × ${formatMeters(object.heightM)} m`;
  }
}

/**
 * The text an object writes on the plan, composed on demand from the
 * display settings that apply to it (see `domain/display.ts`) so it
 * always reflects the current geometry — nothing stale is ever stored on
 * the object.
 *
 * Each switched-on part contributes one line. A measurement object states
 * what it measures in place of a plain dimension summary: that *is* its
 * dimension, and it is the reason the object exists.
 *
 * `label`, the free-text override from before KL-027, still wins when a
 * file carries one — dropping it would silently rewrite existing plans.
 */
export function getObjectDisplayLabel(
  object: PlanObject,
  display: LabelDisplay = DEFAULT_LABEL_DISPLAY,
): string {
  if (object.label) return object.label;

  const lines: string[] = [];
  if (display.name) lines.push(object.name);
  if (display.dimensions) {
    const measured = getMeasurementSummary(object);
    const dimensions = measured ?? getObjectDimensionSummary(object);
    if (dimensions) lines.push(dimensions);
  }
  if (display.electrical) {
    const electrical = electricalSummary(object);
    if (electrical) lines.push(electrical);
  }
  if (display.reference && object.reference) lines.push(object.reference);
  if (display.quantity && object.quantity !== undefined && object.quantity !== 1) {
    lines.push(`× ${formatMeters(object.quantity)}`);
  }
  return lines.join("\n");
}

/** What a persisted measurement states, or `null` for an ordinary object. */
function getMeasurementSummary(object: PlanObject): string | null {
  if (
    object.measurement?.kind === "angle" &&
    object.type === "line" &&
    object.pointsM.length >= 3
  ) {
    const [a, b, c] = object.pointsM;
    if (a && b && c) return formatAngleDeg(angleAtPointDeg(a, b, c));
  }
  if (object.measurement?.kind === "area" && object.type === "polygon") {
    return `${formatAreaM2(polygonAreaM2(object.pointsM))}\nPérimètre ${formatLengthM(polygonPerimeterM(object.pointsM))}`;
  }
  return null;
}

/**
 * What a new object is named after.
 *
 * Almost always its type — but an arrow is a `line` carrying an
 * arrowhead, and a plan full of "Ligne 7" when the user drew arrows would
 * be naming them after their implementation rather than after what they
 * asked for.
 */
export type ObjectNameKind = PlanObject["type"] | "arrow" | ElectricalRole;

const TYPE_NAME_PREFIXES: Record<ObjectNameKind, string> = {
  source: "Alimentation",
  board: "Coffret",
  cable: "Câble",
  strip: "Multiprise",
  load: "Récepteur",
  arrow: "Flèche",
  rectangle: "Rectangle",
  circle: "Cercle",
  line: "Ligne",
  polygon: "Polygone",
  text: "Texte",
  image: "Image",
  symbol: "Symbole",
};

/**
 * A default name for a newly-created object, e.g. `"Rectangle 3"` if the
 * project already has two rectangles. Purely a naming convenience — users
 * can always rename an object afterwards via the properties panel.
 */
export function nextObjectName(project: Project, kind: ObjectNameKind): string {
  // Arrows and plain lines are the same type, so each counts only its own
  // kind: drawing a line then an arrow gives "Ligne 1" and "Flèche 1",
  // not "Ligne 1" and "Flèche 2".
  const isArrow = (object: PlanObject) =>
    object.type === "line" &&
    (object.style?.arrowStart === true || object.style?.arrowEnd === true);
  // Likewise a coffret is a rectangle: "Coffret 2" counts coffrets, and
  // drawing one doesn't advance "Rectangle N".
  const kindOf = (object: PlanObject): ObjectNameKind =>
    object.electrical?.role ?? (isArrow(object) ? "arrow" : object.type);
  const countOfKind = project.objects.filter((object) => kindOf(object) === kind).length;
  return `${TYPE_NAME_PREFIXES[kind]} ${countOfKind + 1}`;
}
