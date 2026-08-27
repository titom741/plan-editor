import { addVector, rotateVector } from "./geometry";
import type { BackgroundImage, PlanObject, PointM, Project } from "./types";

/**
 * The extent of a plan, in metres — what has to fit on the page.
 *
 * Pure domain arithmetic, rotation included: a rotated rectangle's extent
 * is its four rotated corners, not its width and height, and getting that
 * wrong would clip the very object the user rotated.
 */

export interface BoundsM {
  minXM: number;
  minYM: number;
  maxXM: number;
  maxYM: number;
}

export function boundsSizeM(bounds: BoundsM): { widthM: number; heightM: number } {
  return { widthM: bounds.maxXM - bounds.minXM, heightM: bounds.maxYM - bounds.minYM };
}

export function boundsCenterM(bounds: BoundsM): PointM {
  return { xM: (bounds.minXM + bounds.maxXM) / 2, yM: (bounds.minYM + bounds.maxYM) / 2 };
}

function boundsOfPoints(points: PointM[]): BoundsM | null {
  const first = points[0];
  if (!first) return null;
  let minXM = first.xM;
  let maxXM = first.xM;
  let minYM = first.yM;
  let maxYM = first.yM;
  for (const point of points) {
    if (point.xM < minXM) minXM = point.xM;
    if (point.xM > maxXM) maxXM = point.xM;
    if (point.yM < minYM) minYM = point.yM;
    if (point.yM > maxYM) maxYM = point.yM;
  }
  return { minXM, minYM, maxXM, maxYM };
}

export function unionBounds(a: BoundsM | null, b: BoundsM | null): BoundsM | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minXM: Math.min(a.minXM, b.minXM),
    minYM: Math.min(a.minYM, b.minYM),
    maxXM: Math.max(a.maxXM, b.maxXM),
    maxYM: Math.max(a.maxYM, b.maxYM),
  };
}

/** Grows the bounds by `marginM` on every side — used to keep a drawing off the sheet's edge. */
export function expandBounds(bounds: BoundsM, marginM: number): BoundsM {
  return {
    minXM: bounds.minXM - marginM,
    minYM: bounds.minYM - marginM,
    maxXM: bounds.maxXM + marginM,
    maxYM: bounds.maxYM + marginM,
  };
}

export function getObjectBoundsM(object: PlanObject): BoundsM | null {
  const anchor: PointM = { xM: object.xM, yM: object.yM };

  switch (object.type) {
    case "rectangle": {
      // The four corners in the object's own frame, rotated into the
      // world — the axis-aligned box of a rotated rectangle is wider than
      // the rectangle itself.
      const corners: PointM[] = [
        { xM: 0, yM: 0 },
        { xM: object.widthM, yM: 0 },
        { xM: object.widthM, yM: object.heightM },
        { xM: 0, yM: object.heightM },
      ].map((corner) => addVector(anchor, rotateVector(corner, object.rotationDeg)));
      return boundsOfPoints(corners);
    }
    case "circle":
      // A circle's extent is rotation-independent, and its anchor is its centre.
      return {
        minXM: object.xM - object.radiusM,
        minYM: object.yM - object.radiusM,
        maxXM: object.xM + object.radiusM,
        maxYM: object.yM + object.radiusM,
      };
    case "line":
    case "polygon":
      return boundsOfPoints(
        object.pointsM.map((point) => addVector(anchor, rotateVector(point, object.rotationDeg))),
      );
    case "text":
      // Only the anchor. A text's real extent depends on font metrics,
      // which live in the renderer — `domain/` deliberately doesn't know
      // what a glyph is. The sheet's margin absorbs the difference, and
      // guessing a box here would be a wrong number wearing a confident face.
      return { minXM: object.xM, minYM: object.yM, maxXM: object.xM, maxYM: object.yM };
  }
}

export function getBackgroundBoundsM(background: BackgroundImage): BoundsM {
  return {
    minXM: background.xM,
    minYM: background.yM,
    maxXM: background.xM + background.widthM,
    maxYM: background.yM + background.heightM,
  };
}

/**
 * The extent of everything that will be printed. Hidden layers and a
 * hidden background are excluded on purpose: what you export is what you
 * see, so a layer switched off shouldn't silently push the scale out.
 * Returns `null` for an empty plan — the caller decides what to do with
 * nothing, rather than being handed a fabricated zero-sized box.
 */
export function getProjectBoundsM(project: Project): BoundsM | null {
  const visibleLayerIds = new Set(
    project.layers.filter((layer) => layer.visible).map((layer) => layer.id),
  );

  let bounds: BoundsM | null = null;
  for (const object of project.objects) {
    if (!visibleLayerIds.has(object.layerId)) continue;
    bounds = unionBounds(bounds, getObjectBoundsM(object));
  }
  if (project.background?.visible) {
    bounds = unionBounds(bounds, getBackgroundBoundsM(project.background));
  }
  return bounds;
}
