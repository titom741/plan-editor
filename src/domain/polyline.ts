import type { PointM } from "./types";

/**
 * Thinning a freehand stroke.
 *
 * Drawing by hand produces a point every few pixels of pointer movement —
 * hundreds of them for one cable run. Kept as-is they would bloat the
 * project file, slow every redraw and hit-test, and make the vertex
 * handles unusable. Ramer–Douglas–Peucker keeps only the points that
 * carry the shape: it recursively keeps the point furthest from the
 * straight line between the ends, and discards any run that never strays
 * further than `toleranceM` from it.
 *
 * The tolerance is in metres and is derived from a screen distance at the
 * current zoom by the caller, so the simplification is as fine as what the
 * user could actually see while drawing — no more.
 */
export function simplifyPolylineM(points: readonly PointM[], toleranceM: number): PointM[] {
  if (points.length <= 2 || toleranceM <= 0) return [...points];
  const keep = new Array<boolean>(points.length).fill(false);
  keep[0] = true;
  keep[points.length - 1] = true;
  simplifySegment(points, 0, points.length - 1, toleranceM, keep);
  return points.filter((_, index) => keep[index]);
}

function simplifySegment(
  points: readonly PointM[],
  startIndex: number,
  endIndex: number,
  toleranceM: number,
  keep: boolean[],
): void {
  if (endIndex <= startIndex + 1) return;
  const start = points[startIndex]!;
  const end = points[endIndex]!;

  let furthestIndex = -1;
  let furthestDistance = toleranceM;
  for (let index = startIndex + 1; index < endIndex; index += 1) {
    const distance = distanceToSegmentM(points[index]!, start, end);
    if (distance > furthestDistance) {
      furthestDistance = distance;
      furthestIndex = index;
    }
  }

  if (furthestIndex === -1) return;
  keep[furthestIndex] = true;
  simplifySegment(points, startIndex, furthestIndex, toleranceM, keep);
  simplifySegment(points, furthestIndex, endIndex, toleranceM, keep);
}

/** Perpendicular distance from a point to a segment, collapsing to point-distance for a zero-length segment. */
export function distanceToSegmentM(point: PointM, start: PointM, end: PointM): number {
  const dxM = end.xM - start.xM;
  const dyM = end.yM - start.yM;
  const lengthSquared = dxM * dxM + dyM * dyM;
  if (lengthSquared === 0) return Math.hypot(point.xM - start.xM, point.yM - start.yM);
  // Projection parameter, clamped so a point beyond either end measures to
  // that end rather than to the infinite line.
  const t = Math.max(
    0,
    Math.min(1, ((point.xM - start.xM) * dxM + (point.yM - start.yM) * dyM) / lengthSquared),
  );
  return Math.hypot(point.xM - (start.xM + t * dxM), point.yM - (start.yM + t * dyM));
}
