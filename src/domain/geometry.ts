import type { CircleObject, PointM, RectangleObject } from "./types";

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

/** Translates an anchor point by a world-space delta. */
export function translatePoint(anchor: PointM, deltaM: VectorM): PointM {
  return addVector(anchor, deltaM);
}

/**
 * Resizes a rectangle by dragging its bottom-right corner (in its own
 * rotated frame) to `pointerWorld`. The anchor (top-left) and rotation
 * never change — only `widthM`/`heightM` are derived, fresh, from the
 * pointer's position un-rotated into the rectangle's local frame. Clamped
 * to `MIN_SIZE_M` so a resize can never collapse the object to zero (or
 * negative) size.
 */
export function resizeRectangleFromCorner(
  object: Pick<RectangleObject, "xM" | "yM" | "rotationDeg">,
  pointerWorld: PointM,
): { widthM: number; heightM: number } {
  const worldDelta = subtractPoints(pointerWorld, { xM: object.xM, yM: object.yM });
  const local = rotateVector(worldDelta, -object.rotationDeg);
  return {
    widthM: Math.max(MIN_SIZE_M, local.xM),
    heightM: Math.max(MIN_SIZE_M, local.yM),
  };
}

/** World position of a rectangle's resize handle (its rotated bottom-right corner). */
export function getRectangleResizeHandleWorld(
  object: Pick<RectangleObject, "xM" | "yM" | "widthM" | "heightM" | "rotationDeg">,
): PointM {
  const corner = rotateVector({ xM: object.widthM, yM: object.heightM }, object.rotationDeg);
  return addVector({ xM: object.xM, yM: object.yM }, corner);
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

/** World position of a circle's resize handle (on its circumference, to the right of center). */
export function getCircleResizeHandleWorld(object: Pick<CircleObject, "xM" | "yM" | "radiusM">): PointM {
  return { xM: object.xM + object.radiusM, yM: object.yM };
}

/**
 * Computes a rotation (in degrees, normalized to [0, 360)) so that the ray
 * from `pivotWorld` to `pointerWorld` matches where a rotate handle is
 * drawn when `rotationDeg = 0` — directly "above" the pivot, i.e. at
 * local offset `(0, -gap)`. See `getRotateHandleWorld`.
 */
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
