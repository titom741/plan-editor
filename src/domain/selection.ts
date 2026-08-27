import { getObjectBoundsM, unionBounds } from "./bounds";
import type { BoundsM } from "./bounds";
import type { PlanObject, PointM } from "./types";

/**
 * Selection as a value, not as a UI detail.
 *
 * KL-002 kept the selection as a single `string | null` in the editor
 * component. KL-004 makes it a set of ids, and the moment more than one
 * object can be selected, questions like "does this marquee catch that
 * object" and "what is the extent of the selection" become geometry — so
 * they live here, next to `bounds.ts`, testable without a canvas.
 */

/** Adds `id` if absent, removes it if present — the Shift-click rule. */
export function toggleSelection(ids: readonly string[], id: string): string[] {
  return ids.includes(id) ? ids.filter((existing) => existing !== id) : [...ids, id];
}

/** True when the two axis-aligned boxes overlap, touching edges included. */
export function boundsIntersect(a: BoundsM, b: BoundsM): boolean {
  return a.minXM <= b.maxXM && a.maxXM >= b.minXM && a.minYM <= b.maxYM && a.maxYM >= b.minYM;
}

/** True when `inner` lies entirely within `outer`. */
export function boundsContain(outer: BoundsM, inner: BoundsM): boolean {
  return (
    inner.minXM >= outer.minXM &&
    inner.maxXM <= outer.maxXM &&
    inner.minYM >= outer.minYM &&
    inner.maxYM <= outer.maxYM
  );
}

/** Normalises the two corners of a drag into a box, so a marquee dragged up-and-left works like one dragged down-and-right. */
export function boundsFromCorners(a: PointM, b: PointM): BoundsM {
  return {
    minXM: Math.min(a.xM, b.xM),
    minYM: Math.min(a.yM, b.yM),
    maxXM: Math.max(a.xM, b.xM),
    maxYM: Math.max(a.yM, b.yM),
  };
}

export function boundsAreaM2(bounds: BoundsM): number {
  return Math.max(0, bounds.maxXM - bounds.minXM) * Math.max(0, bounds.maxYM - bounds.minYM);
}

/**
 * The ids a marquee catches.
 *
 * Hit-testing is done against each object's axis-aligned bounding box, not
 * its true outline: a marquee that clips the corner of a rotated
 * rectangle's *box* selects it even if it misses the rectangle itself.
 * That is the conventional behaviour and it is forgiving in the right
 * direction — a marquee is a rough gesture, and a near-miss that selects
 * nothing is more annoying than one that selects slightly too much.
 *
 * `touching` (the default) selects anything the marquee overlaps;
 * `contained` requires the object to be entirely inside it.
 */
export function objectIdsWithinBounds(
  objects: readonly PlanObject[],
  marquee: BoundsM,
  options: { mode?: "touching" | "contained"; isEligible?: (object: PlanObject) => boolean } = {},
): string[] {
  const mode = options.mode ?? "touching";
  const ids: string[] = [];
  for (const object of objects) {
    if (options.isEligible && !options.isEligible(object)) continue;
    const bounds = getObjectBoundsM(object);
    if (!bounds) continue;
    if (mode === "contained" ? boundsContain(marquee, bounds) : boundsIntersect(marquee, bounds)) {
      ids.push(object.id);
    }
  }
  return ids;
}

/** The combined extent of several objects — what a multi-selection outline is drawn around. `null` when nothing is selected. */
export function getSelectionBoundsM(objects: readonly PlanObject[]): BoundsM | null {
  let bounds: BoundsM | null = null;
  for (const object of objects) {
    bounds = unionBounds(bounds, getObjectBoundsM(object));
  }
  return bounds;
}
