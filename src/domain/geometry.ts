import type { CircleObject, PlanObject, PointM, RectangleObject } from "./types";

/**
 * Pure geometric operations on the metric model — the math behind moving,
 * resizing, and rotating a `PlanObject`. Every function here works
 * entirely in world coordinates (meters, degrees) and is independent of
 * any particular pointer/handle-drag implementation in `ui/`: given the
 * same inputs, it always returns the same outputs, which is what keeps
 * interactive editing drift-free — a resize or rotation is recomputed
 * fresh from the object's current anchor each time, never accumulated
 * from a chain of small deltas.
 */

/** A displacement in meters — same shape as `PointM`, named separately so call sites read as "vector", not "position". */
export interface VectorM {
  xM: number;
  yM: number;
}

/** Smallest size (in meters) a resize is allowed to shrink an object to, to keep it visible and grabbable. */
export const MIN_SIZE_M = 0.1;

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

export function radToDeg(rad: number): number {
  return (rad * 180) / Math.PI;
}

/** Normalizes an angle to the [0, 360) range. */
export function normalizeAngleDeg(deg: number): number {
  const normalized = deg % 360;
  return normalized < 0 ? normalized + 360 : normalized;
}

/** Keeps a segment length while snapping its direction to an angular step. */
export function constrainPointAngleM(start: PointM, end: PointM, stepDeg = 15): PointM {
  const vector = subtractPoints(end, start);
  const length = vectorLength(vector);
  if (length === 0 || !(stepDeg > 0)) return end;
  const angle = Math.atan2(vector.yM, vector.xM);
  const step = degToRad(stepDeg);
  const constrained = Math.round(angle / step) * step;
  return { xM: start.xM + Math.cos(constrained) * length, yM: start.yM + Math.sin(constrained) * length };
}

/** Tangency points from an external point to a circle; empty inside/on it. */
export function tangentPointsToCircleM(origin: PointM, center: PointM, radiusM: number): PointM[] {
  const dx = origin.xM - center.xM; const dy = origin.yM - center.yM;
  const distanceSquared = dx * dx + dy * dy;
  if (!(radiusM > 0) || distanceSquared <= radiusM * radiusM) return [];
  const base = radiusM * radiusM / distanceSquared;
  const offset = radiusM * Math.sqrt(distanceSquared - radiusM * radiusM) / distanceSquared;
  return [
    { xM: center.xM + base * dx - offset * dy, yM: center.yM + base * dy + offset * dx },
    { xM: center.xM + base * dx + offset * dy, yM: center.yM + base * dy - offset * dx },
  ];
}

export function subtractPoints(a: PointM, b: PointM): VectorM {
  return { xM: a.xM - b.xM, yM: a.yM - b.yM };
}

export function addVector(point: PointM, vector: VectorM): PointM {
  return { xM: point.xM + vector.xM, yM: point.yM + vector.yM };
}

export function vectorLength(vector: VectorM): number {
  return Math.hypot(vector.xM, vector.yM);
}

/**
 * Rotates a vector by `angleDeg` clockwise — the same convention as
 * `PlanObject.rotationDeg` and Konva's `rotation` prop (clockwise degrees
 * in a Y-down screen space, which this function matches even though it
 * operates on world coordinates, since world Y also increases downward —
 * see `docs/ARCHITECTURE.md`).
 */
export function rotateVector(vector: VectorM, angleDeg: number): VectorM {
  const rad = degToRad(angleDeg);
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  return {
    xM: vector.xM * cos - vector.yM * sin,
    yM: vector.xM * sin + vector.yM * cos,
  };
}

/**
 * Expresses a world point in an object's own unrotated frame, relative to
 * its anchor. The inverse of `objectLocalToWorld`.
 *
 * Every interactive edit that has to reason about "where the pointer is on
 * the shape" goes through this pair rather than doing its own trigonometry,
 * so a rotated object behaves exactly like an unrotated one.
 */
export function worldToObjectLocal(
  object: { xM: number; yM: number; rotationDeg: number },
  world: PointM,
): VectorM {
  return rotateVector(subtractPoints(world, { xM: object.xM, yM: object.yM }), -object.rotationDeg);
}

/** Expresses a point of an object's own unrotated frame in world coordinates. The inverse of `worldToObjectLocal`. */
export function objectLocalToWorld(
  object: { xM: number; yM: number; rotationDeg: number },
  local: VectorM,
): PointM {
  return addVector({ xM: object.xM, yM: object.yM }, rotateVector(local, object.rotationDeg));
}

// ---------------------------------------------------------------------------
// Rectangle resize handles (KL-004)
// ---------------------------------------------------------------------------

/** The eight points a rectangle can be resized from: four corners and four edge midpoints, named by compass direction in the object's own frame. */
export type ResizeHandleId = "nw" | "n" | "ne" | "e" | "se" | "s" | "sw" | "w";

/** All eight handles, clockwise from the top-left. */
export const RESIZE_HANDLE_IDS: readonly ResizeHandleId[] = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];

/**
 * Where each handle sits in the rectangle's own frame, as a fraction of
 * its width and height: 0 = the near edge, 1 = the far edge, 0.5 = the
 * middle of an edge (which is what makes a handle an *edge* handle — it
 * doesn't drive that axis at all).
 */
const HANDLE_UNIT: Record<ResizeHandleId, { u: number; v: number }> = {
  nw: { u: 0, v: 0 },
  n: { u: 0.5, v: 0 },
  ne: { u: 1, v: 0 },
  e: { u: 1, v: 0.5 },
  se: { u: 1, v: 1 },
  s: { u: 0.5, v: 1 },
  sw: { u: 0, v: 1 },
  w: { u: 0, v: 0.5 },
};

/** True for the four corner handles, which drive both axes (and so can preserve an aspect ratio). */
export function isCornerHandle(handle: ResizeHandleId): boolean {
  const unit = HANDLE_UNIT[handle];
  return unit.u !== 0.5 && unit.v !== 0.5;
}

/** World position of one of a rectangle's eight resize handles. */
export function getRectangleHandleWorld(
  object: Pick<RectangleObject, "xM" | "yM" | "widthM" | "heightM" | "rotationDeg">,
  handle: ResizeHandleId,
): PointM {
  const unit = HANDLE_UNIT[handle];
  return objectLocalToWorld(object, { xM: unit.u * object.widthM, yM: unit.v * object.heightM });
}

/**
 * Resizes a rectangle by dragging any one of its eight handles to
 * `pointerWorld`.
 *
 * The rule the whole thing rests on: **the diagonally opposite handle
 * stays exactly where it is in world space**. That is what makes dragging
 * the north-west corner grow the rectangle up and to the left instead of
 * dragging the whole object around, and it holds at any rotation because
 * the pointer is un-rotated into the rectangle's own frame first. The
 * anchor (`xM`/`yM`) therefore *does* move for six of the eight handles —
 * which is why this returns a full placement, unlike the bottom-right-only
 * `resizeRectangleFromCorner` it replaces, where the anchor is the fixed
 * point and never moves.
 *
 * `keepAspectRatio` (the Shift modifier in the UI) scales both axes
 * together from the object's current proportions. On an edge handle that
 * means the axis you are *not* dragging follows along; on a corner it
 * means the larger of the two requested scales wins, so the shape keeps up
 * with the pointer instead of lagging behind it.
 *
 * Nothing accumulates: every call recomputes from the object's current
 * geometry and the pointer's current world position, so a resize is
 * drift-free across zoom changes and dropped frames alike.
 */
export function resizeRectangleFromHandle(
  object: Pick<RectangleObject, "xM" | "yM" | "widthM" | "heightM" | "rotationDeg">,
  handle: ResizeHandleId,
  pointerWorld: PointM,
  options: { keepAspectRatio?: boolean } = {},
): { xM: number; yM: number; widthM: number; heightM: number } {
  const unit = HANDLE_UNIT[handle];
  const opposite = { u: 1 - unit.u, v: 1 - unit.v };
  const fixedWorld = objectLocalToWorld(object, {
    xM: opposite.u * object.widthM,
    yM: opposite.v * object.heightM,
  });

  // The pointer in the rectangle's own unrotated frame, measured from the
  // handle that must not move.
  const local = rotateVector(subtractPoints(pointerWorld, fixedWorld), -object.rotationDeg);

  let widthM = object.widthM;
  let heightM = object.heightM;
  if (unit.u === 1) widthM = local.xM;
  else if (unit.u === 0) widthM = -local.xM;
  if (unit.v === 1) heightM = local.yM;
  else if (unit.v === 0) heightM = -local.yM;

  if (options.keepAspectRatio && object.widthM > 0 && object.heightM > 0) {
    const drivesWidth = unit.u !== 0.5;
    const drivesHeight = unit.v !== 0.5;
    const widthScale = widthM / object.widthM;
    const heightScale = heightM / object.heightM;
    let scale = drivesWidth && drivesHeight ? Math.max(widthScale, heightScale) : drivesWidth ? widthScale : heightScale;
    // Clamping the *scale* rather than each side keeps the ratio exact at
    // the minimum size — clamping the sides independently would quietly
    // distort the shape the modifier exists to protect.
    scale = Math.max(scale, MIN_SIZE_M / object.widthM, MIN_SIZE_M / object.heightM);
    widthM = object.widthM * scale;
    heightM = object.heightM * scale;
  } else {
    widthM = Math.max(MIN_SIZE_M, widthM);
    heightM = Math.max(MIN_SIZE_M, heightM);
  }

  // Place the anchor so the fixed handle lands back on the same world point.
  const nextAnchor = addVector(
    fixedWorld,
    rotateVector({ xM: -opposite.u * widthM, yM: -opposite.v * heightM }, object.rotationDeg),
  );
  return { xM: nextAnchor.xM, yM: nextAnchor.yM, widthM, heightM };
}

// ---------------------------------------------------------------------------
// Circle resize handles (KL-004)
// ---------------------------------------------------------------------------

/** The four points a circle can be resized from. Deliberately axis-aligned in world space: a circle looks the same at every rotation, so rotating its handles would only make them harder to hit. */
export type CircleHandleId = "n" | "e" | "s" | "w";

export const CIRCLE_HANDLE_IDS: readonly CircleHandleId[] = ["n", "e", "s", "w"];

const CIRCLE_HANDLE_DIRECTION: Record<CircleHandleId, VectorM> = {
  n: { xM: 0, yM: -1 },
  e: { xM: 1, yM: 0 },
  s: { xM: 0, yM: 1 },
  w: { xM: -1, yM: 0 },
};

/** World position of one of a circle's four resize handles, on its circumference. */
export function getCircleHandleWorld(
  object: Pick<CircleObject, "xM" | "yM" | "radiusM">,
  handle: CircleHandleId,
): PointM {
  const direction = CIRCLE_HANDLE_DIRECTION[handle];
  return { xM: object.xM + direction.xM * object.radiusM, yM: object.yM + direction.yM * object.radiusM };
}

// ---------------------------------------------------------------------------
// Line / polygon vertices (KL-004)
// ---------------------------------------------------------------------------

/** The shape of a line or polygon, as far as vertex editing is concerned. */
export interface VertexGeometry {
  xM: number;
  yM: number;
  rotationDeg: number;
  pointsM: PointM[];
}

/** Fewest vertices each multi-point type may be reduced to — below this the object stops being one. */
export const MIN_LINE_POINTS = 2;
export const MIN_POLYGON_POINTS = 3;

/** World position of vertex `index`, or `null` if there is no such vertex. */
export function getVertexWorld(object: VertexGeometry, index: number): PointM | null {
  const point = object.pointsM[index];
  if (!point) return null;
  return objectLocalToWorld(object, point);
}

/**
 * Moves vertex `index` so it lands exactly on `pointerWorld`, returning
 * the new `pointsM`. Returns `null` for an index that doesn't exist.
 *
 * The object's anchor deliberately stays put, even when vertex 0 (which
 * normally sits at the anchor) is the one being dragged. Re-normalising
 * the anchor mid-drag would move the rotation pivot under the user's hand
 * and make the shape swim; the anchor is just the local origin, and the
 * model has never required a vertex to sit on it.
 */
export function moveVertexTo(object: VertexGeometry, index: number, pointerWorld: PointM): { pointsM: PointM[] } | null {
  if (!object.pointsM[index]) return null;
  const local = worldToObjectLocal(object, pointerWorld);
  const pointsM = object.pointsM.map((point, i) => (i === index ? { xM: local.xM, yM: local.yM } : point));
  return { pointsM };
}

/** How many segments the shape has: a polygon's last vertex joins back to its first, a line's doesn't. */
export function getSegmentCount(object: VertexGeometry, closed: boolean): number {
  const count = object.pointsM.length;
  if (count < 2) return 0;
  return closed ? count : count - 1;
}

/** World midpoint of segment `index` (the segment leaving vertex `index`), or `null` if there is no such segment. */
export function getSegmentMidpointWorld(object: VertexGeometry, index: number, closed: boolean): PointM | null {
  if (index < 0 || index >= getSegmentCount(object, closed)) return null;
  const start = object.pointsM[index];
  const end = object.pointsM[(index + 1) % object.pointsM.length];
  if (!start || !end) return null;
  return objectLocalToWorld(object, { xM: (start.xM + end.xM) / 2, yM: (start.yM + end.yM) / 2 });
}

/** Inserts a new vertex just after `index` — i.e. splits the segment leaving it — at `pointerWorld`. */
export function insertVertexAfter(object: VertexGeometry, index: number, pointerWorld: PointM): { pointsM: PointM[] } {
  const local = worldToObjectLocal(object, pointerWorld);
  const pointsM = [...object.pointsM];
  pointsM.splice(index + 1, 0, { xM: local.xM, yM: local.yM });
  return { pointsM };
}

/** Removes vertex `index`, or returns `null` when doing so would leave fewer than `minimumPoints` — the caller then simply refuses, rather than producing a degenerate object. */
export function removeVertexAt(object: VertexGeometry, index: number, minimumPoints: number): { pointsM: PointM[] } | null {
  if (!object.pointsM[index]) return null;
  if (object.pointsM.length <= minimumPoints) return null;
  return { pointsM: object.pointsM.filter((_, i) => i !== index) };
}

/**
 * Resizes a rectangle by dragging its bottom-right corner — the narrow
 * case `SelectionOverlay` used before KL-004 added the other seven
 * handles. Kept because it reads well at the call site and because the
 * bottom-right corner is the one that never moves the anchor; it is now
 * just `resizeRectangleFromHandle(…, "se", …)` so there is a single
 * implementation of the resize math.
 */
export function resizeRectangleFromCorner(
  object: Pick<RectangleObject, "xM" | "yM" | "rotationDeg">,
  pointerWorld: PointM,
): { widthM: number; heightM: number } {
  // Width/height are irrelevant for "se": its fixed opposite handle is the
  // anchor itself, so they never enter the computation.
  const resized = resizeRectangleFromHandle({ ...object, widthM: 0, heightM: 0 }, "se", pointerWorld);
  return { widthM: resized.widthM, heightM: resized.heightM };
}

/** World position of a rectangle's bottom-right resize handle. */
export function getRectangleResizeHandleWorld(
  object: Pick<RectangleObject, "xM" | "yM" | "widthM" | "heightM" | "rotationDeg">,
): PointM {
  return getRectangleHandleWorld(object, "se");
}

/**
 * Resizes a circle by dragging its radius handle to `pointerWorld`:
 * `radiusM` becomes the distance from center to pointer. Clamped to a
 * (small) minimum radius.
 */
export function resizeCircleFromHandle(
  object: Pick<CircleObject, "xM" | "yM">,
  pointerWorld: PointM,
): { radiusM: number } {
  const delta = subtractPoints(pointerWorld, { xM: object.xM, yM: object.yM });
  return { radiusM: Math.max(MIN_SIZE_M / 2, vectorLength(delta)) };
}

/** World position of a circle's eastern resize handle — the one that existed before KL-004 added the other three. */
export function getCircleResizeHandleWorld(object: Pick<CircleObject, "xM" | "yM" | "radiusM">): PointM {
  return getCircleHandleWorld(object, "e");
}

/**
 * Computes a rotation (in degrees, normalized to [0, 360)) so that the ray
 * from `pivotWorld` to `pointerWorld` matches where a rotate handle is
 * drawn when `rotationDeg = 0` — directly "above" the pivot, i.e. at
 * local offset `(0, -gap)`. See `getRotateHandleWorld`.
 */
/**
 * Where an object's anchor has to move so that rotating it to
 * `rotationDeg` turns it **around its own centre** instead of around its
 * anchor.
 *
 * The model stores rotation about the anchor — for a rectangle, its
 * top-left corner — because that is what keeps rendering, bounds and PDF
 * export in step with one shared convention. But rotating a chapiteau
 * about its corner swings it across the plan, which is never what anyone
 * means by "rotate this". So the *gesture* rotates about the centre and
 * solves for the anchor that produces it, leaving the stored convention
 * (and every file already written) untouched.
 *
 * `centerLocal` is the object's centre in its own unrotated frame
 * relative to the anchor — `(w/2, h/2)` for a rectangle, the centroid of
 * the points for a polyline, `(0,0)` for a circle, whose centre already
 * *is* its anchor.
 */
/**
 * An object's centre in its own unrotated frame, relative to its anchor —
 * the pivot a rotate gesture should turn it around.
 *
 * A circle's anchor already *is* its centre, so the offset is zero. A
 * polyline's is the midpoint of its extent rather than the average of its
 * points: an L-shaped run of barrier with ten points along one arm and
 * two along the other would otherwise pivot around the crowded arm.
 */
export function getLocalCenter(object: PlanObject): VectorM {
  switch (object.type) {
    case "rectangle":
    case "image":
      return { xM: object.widthM / 2, yM: object.heightM / 2 };
    case "circle":
      return { xM: 0, yM: 0 };
    case "line":
    case "polygon": {
      const first = object.pointsM[0];
      if (!first) return { xM: 0, yM: 0 };
      let minX = first.xM, maxX = first.xM, minY = first.yM, maxY = first.yM;
      for (const point of object.pointsM) {
        if (point.xM < minX) minX = point.xM;
        if (point.xM > maxX) maxX = point.xM;
        if (point.yM < minY) minY = point.yM;
        if (point.yM > maxY) maxY = point.yM;
      }
      return { xM: (minX + maxX) / 2, yM: (minY + maxY) / 2 };
    }
    case "text":
      // A text anchor is its top-left; its width depends on font metrics
      // the domain doesn't have, so the height alone centres it vertically
      // and the estimate in `bounds.ts` is not repeated here.
      return { xM: 0, yM: object.fontSizeM * 0.6 };
  }
}

/**
 * The patch that rotates an object to `rotationDeg` about its own centre:
 * the new angle plus the anchor that keeps that centre where it was.
 * Everything the UI needs from a rotate gesture, in one call.
 */
export function rotateObjectToDeg(
  object: PlanObject,
  rotationDeg: number,
): { xM: number; yM: number; rotationDeg: number } {
  return rotateAroundLocalCenter(object, getLocalCenter(object), rotationDeg);
}

export function rotateAroundLocalCenter(
  object: { xM: number; yM: number; rotationDeg: number },
  centerLocal: VectorM,
  rotationDeg: number,
): { xM: number; yM: number; rotationDeg: number } {
  // The centre's world position must not move, so solve the anchor from
  // it: anchor = centre - R(newAngle) · centerLocal.
  const centerWorld = objectLocalToWorld(object, centerLocal);
  const rotated = rotateVector(centerLocal, rotationDeg);
  return {
    xM: centerWorld.xM - rotated.xM,
    yM: centerWorld.yM - rotated.yM,
    rotationDeg: normalizeAngleDeg(rotationDeg),
  };
}

export function computeRotationFromPointer(pivotWorld: PointM, pointerWorld: PointM): number {
  const delta = subtractPoints(pointerWorld, pivotWorld);
  const deg = radToDeg(Math.atan2(delta.yM, delta.xM)) + 90;
  return normalizeAngleDeg(deg);
}

/**
 * World position of a rotate handle: offset `gapM` meters "above" (in the
 * object's local, unrotated frame) a `localOffset` point relative to the
 * pivot, then rotated by the object's current `rotationDeg`. `localOffset`
 * lets each shape type place the handle sensibly (e.g. above a
 * rectangle's top edge, centered) while the pivot itself — the point
 * rotation happens around — stays the object's own anchor, matching how
 * `PlanObjectShape` renders rotation (see `docs/ARCHITECTURE.md`).
 */
export function getRotateHandleWorld(
  pivotWorld: PointM,
  rotationDeg: number,
  gapM: number,
  localOffset: VectorM = { xM: 0, yM: 0 },
): PointM {
  const local: VectorM = { xM: localOffset.xM, yM: localOffset.yM - gapM };
  return addVector(pivotWorld, rotateVector(local, rotationDeg));
}
