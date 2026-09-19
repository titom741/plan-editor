import { objectLocalToWorld, subtractPoints, vectorLength } from "./geometry";
import type { PlanObject, PointM } from "./types";

/**
 * Snapping: pulling a pointer onto a point that means something.
 *
 * Pure domain arithmetic in metres. The UI decides the *tolerance* — a
 * snap has to feel like a fixed distance on screen, so the caller converts
 * a pixel radius into metres through the current viewport and passes it
 * in. Nothing here knows what a pixel is.
 */

export type SnapKind =
  | "grid"
  | "vertex"
  | "center"
  | "midpoint"
  | "intersection"
  | "tangent"
  | "alignment-x"
  | "alignment-y"
  | "alignment-xy";

export interface SnapTarget {
  pointM: PointM;
  kind: SnapKind;
  /** The object the target belongs to, absent for grid intersections. */
  objectId?: string;
}

/** Rounds a point onto the nearest intersection of a `stepM` grid. */
export function snapToGridM(point: PointM, stepM: number): PointM {
  if (!(stepM > 0)) return point;
  return { xM: Math.round(point.xM / stepM) * stepM, yM: Math.round(point.yM / stepM) * stepM };
}

/**
 * The points on an object worth snapping to: its corners/vertices, its
 * centre, and the midpoint of each edge.
 *
 * Edge midpoints are included because "line this up with the middle of
 * that wall" is a thing people actually do on an event plan, and it is
 * otherwise impossible to hit exactly.
 */
export function getObjectSnapTargets(object: PlanObject): SnapTarget[] {
  const targets: SnapTarget[] = [];
  const push = (pointM: PointM, kind: SnapKind) =>
    targets.push({ pointM, kind, objectId: object.id });

  switch (object.type) {
    case "rectangle":
    case "image": {
      const corners: PointM[] = [
        { xM: 0, yM: 0 },
        { xM: object.widthM, yM: 0 },
        { xM: object.widthM, yM: object.heightM },
        { xM: 0, yM: object.heightM },
      ];
      for (const corner of corners) push(objectLocalToWorld(object, corner), "vertex");
      for (let i = 0; i < corners.length; i += 1) {
        const a = corners[i];
        const b = corners[(i + 1) % corners.length];
        if (a && b)
          push(
            objectLocalToWorld(object, { xM: (a.xM + b.xM) / 2, yM: (a.yM + b.yM) / 2 }),
            "midpoint",
          );
      }
      push(objectLocalToWorld(object, { xM: object.widthM / 2, yM: object.heightM / 2 }), "center");
      break;
    }
    case "circle": {
      push({ xM: object.xM, yM: object.yM }, "center");
      push({ xM: object.xM, yM: object.yM - object.radiusM }, "vertex");
      push({ xM: object.xM + object.radiusM, yM: object.yM }, "vertex");
      push({ xM: object.xM, yM: object.yM + object.radiusM }, "vertex");
      push({ xM: object.xM - object.radiusM, yM: object.yM }, "vertex");
      break;
    }
    case "line":
    case "polygon": {
      const points = object.pointsM;
      for (const point of points) push(objectLocalToWorld(object, point), "vertex");
      const segmentCount = object.type === "polygon" ? points.length : points.length - 1;
      for (let i = 0; i < segmentCount; i += 1) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        if (a && b)
          push(
            objectLocalToWorld(object, { xM: (a.xM + b.xM) / 2, yM: (a.yM + b.yM) / 2 }),
            "midpoint",
          );
      }
      break;
    }
    case "text":
      push({ xM: object.xM, yM: object.yM }, "vertex");
      break;
    case "symbol":
      // Its anchor is its centre, so that is what it offers — a symbol
      // lines up with the middle of a gate, not with a corner of itself.
      push({ xM: object.xM, yM: object.yM }, "center");
      break;
  }
  return targets;
}

/**
 * Snap targets for a whole plan. `excludeIds` keeps an object from
 * snapping to itself, which would otherwise pin it in place the moment a
 * drag began.
 */
export function collectSnapTargets(
  objects: readonly PlanObject[],
  options: { excludeIds?: ReadonlySet<string>; isEligible?: (object: PlanObject) => boolean } = {},
): SnapTarget[] {
  const targets: SnapTarget[] = [];
  for (const object of objects) {
    if (options.excludeIds?.has(object.id)) continue;
    if (options.isEligible && !options.isEligible(object)) continue;
    targets.push(...getObjectSnapTargets(object));
  }
  const segments: { a: PointM; b: PointM; objectId: string }[] = [];
  for (const object of objects) {
    if (options.excludeIds?.has(object.id) || (options.isEligible && !options.isEligible(object)))
      continue;
    const local =
      object.type === "rectangle" || object.type === "image"
        ? [
            { xM: 0, yM: 0 },
            { xM: object.widthM, yM: 0 },
            { xM: object.widthM, yM: object.heightM },
            { xM: 0, yM: object.heightM },
          ]
        : object.type === "line" || object.type === "polygon"
          ? object.pointsM
          : [];
    const closed =
      object.type === "rectangle" || object.type === "image" || object.type === "polygon";
    const count = closed ? local.length : local.length - 1;
    for (let index = 0; index < count; index += 1) {
      const a = local[index];
      const b = local[(index + 1) % local.length];
      if (a && b)
        segments.push({
          a: objectLocalToWorld(object, a),
          b: objectLocalToWorld(object, b),
          objectId: object.id,
        });
    }
  }
  // Prevent a malicious/huge project from turning snapping into quadratic work.
  if (segments.length <= 2_000) {
    for (let first = 0; first < segments.length; first += 1)
      for (let second = first + 1; second < segments.length; second += 1) {
        const a = segments[first]!;
        const b = segments[second]!;
        if (a.objectId === b.objectId) continue;
        const denominator =
          (a.a.xM - a.b.xM) * (b.a.yM - b.b.yM) - (a.a.yM - a.b.yM) * (b.a.xM - b.b.xM);
        if (Math.abs(denominator) < 1e-9) continue;
        const t =
          ((a.a.xM - b.a.xM) * (b.a.yM - b.b.yM) - (a.a.yM - b.a.yM) * (b.a.xM - b.b.xM)) /
          denominator;
        const u =
          -((a.a.xM - a.b.xM) * (a.a.yM - b.a.yM) - (a.a.yM - a.b.yM) * (a.a.xM - b.a.xM)) /
          denominator;
        if (t > -1 && t < 2 && u > -1 && u < 2)
          targets.push({
            pointM: { xM: a.a.xM + t * (a.b.xM - a.a.xM), yM: a.a.yM + t * (a.b.yM - a.a.yM) },
            kind: "intersection",
          });
      }
  }
  return targets;
}

export interface SnapResult {
  pointM: PointM;
  /** What the point was pulled onto, or `null` if it wasn't pulled at all. */
  target: SnapTarget | null;
}

export interface SnapOptions {
  targets?: readonly SnapTarget[];
  /** Grid spacing in metres; 0 or absent disables grid snapping. */
  gridStepM?: number;
  /** How far, in metres, a point may be pulled. */
  toleranceM: number;
}

/**
 * Pulls `point` onto the nearest snap target within `toleranceM`, or onto
 * the grid, or leaves it alone.
 *
 * Object targets beat the grid even when the grid intersection is closer.
 * A corner of a real object is a deliberate place; a grid crossing is an
 * arbitrary one, and losing the corner because a grid line happened to run
 * nearer is precisely the failure that makes people switch snapping off.
 */
export function snapPointM(point: PointM, options: SnapOptions): SnapResult {
  let best: SnapTarget | null = null;
  let bestDistance = options.toleranceM;
  for (const target of options.targets ?? []) {
    const distance = vectorLength(subtractPoints(target.pointM, point));
    if (distance <= bestDistance) {
      best = target;
      bestDistance = distance;
    }
  }
  if (best) return { pointM: best.pointM, target: best };

  // Projected alignment guides can constrain just one axis while leaving
  // the other coordinate exactly under the pointer.
  let nearestX: SnapTarget | null = null;
  let nearestY: SnapTarget | null = null;
  let dx = options.toleranceM;
  let dy = options.toleranceM;
  for (const target of options.targets ?? []) {
    const candidateDx = Math.abs(target.pointM.xM - point.xM);
    const candidateDy = Math.abs(target.pointM.yM - point.yM);
    if (candidateDx <= dx) {
      dx = candidateDx;
      nearestX = target;
    }
    if (candidateDy <= dy) {
      dy = candidateDy;
      nearestY = target;
    }
  }
  if (nearestX || nearestY) {
    const aligned = { xM: nearestX?.pointM.xM ?? point.xM, yM: nearestY?.pointM.yM ?? point.yM };
    const kind: SnapKind =
      nearestX && nearestY ? "alignment-xy" : nearestX ? "alignment-x" : "alignment-y";
    return {
      pointM: aligned,
      target: { pointM: aligned, kind, objectId: nearestX?.objectId ?? nearestY?.objectId },
    };
  }

  const gridStepM = options.gridStepM ?? 0;
  if (gridStepM > 0) {
    const snapped = snapToGridM(point, gridStepM);
    if (vectorLength(subtractPoints(snapped, point)) <= options.toleranceM) {
      return { pointM: snapped, target: { pointM: snapped, kind: "grid" } };
    }
  }
  return { pointM: point, target: null };
}
