import { formatMeters } from "./labels";
import { subtractPoints, vectorLength } from "./geometry";
import type { PointM } from "./types";

/**
 * Lengths and areas, in real-world units.
 *
 * The live measurement draft is transient, while confirmed dimensions are
 * stored as ordinary editable line/polygon objects carrying measurement
 * metadata. These pure functions serve both paths.
 */

/** Length of each segment of a polyline, in metres. Empty for fewer than two points. */
export function segmentLengthsM(points: readonly PointM[]): number[] {
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (!from || !to) continue;
    lengths.push(vectorLength(subtractPoints(to, from)));
  }
  return lengths;
}

/** Total length of an open polyline, in metres. */
export function polylineLengthM(points: readonly PointM[]): number {
  return segmentLengthsM(points).reduce((total, length) => total + length, 0);
}

/** Perimeter of the closed shape through `points`, in metres — the polyline plus the segment back to the start. */
export function polygonPerimeterM(points: readonly PointM[]): number {
  const first = points[0];
  const last = points[points.length - 1];
  if (points.length < 3 || !first || !last) return polylineLengthM(points);
  return polylineLengthM(points) + vectorLength(subtractPoints(first, last));
}

/**
 * Area enclosed by `points`, in square metres, via the shoelace formula.
 *
 * Always positive: the sign of the shoelace sum only tells you which way
 * round the points were listed, which is not something the user asked
 * about. Self-intersecting outlines give the signed sum of their lobes —
 * mathematically correct and not worth guarding against, since the tool
 * draws the outline as you go and a bow-tie is visible on sight.
 */
export function polygonAreaM2(points: readonly PointM[]): number {
  if (points.length < 3) return 0;
  let twiceArea = 0;
  for (let i = 0; i < points.length; i += 1) {
    const current = points[i];
    const next = points[(i + 1) % points.length];
    if (!current || !next) continue;
    twiceArea += current.xM * next.yM - next.xM * current.yM;
  }
  return Math.abs(twiceArea) / 2;
}

/** Interior angle ABC, in degrees, normalized to 0..180. */
export function angleAtPointDeg(a: PointM, b: PointM, c: PointM): number {
  const ba = subtractPoints(a, b);
  const bc = subtractPoints(c, b);
  const denominator = vectorLength(ba) * vectorLength(bc);
  if (denominator === 0) return 0;
  const cosine = Math.max(-1, Math.min(1, (ba.xM * bc.xM + ba.yM * bc.yM) / denominator));
  return (Math.acos(cosine) * 180) / Math.PI;
}

export function formatAngleDeg(angleDeg: number): string {
  return `${formatMeters(Math.round(angleDeg * 10) / 10)}°`;
}

/** A length for display, e.g. `"12.5 m"`. */
export function formatLengthM(lengthM: number): string {
  return `${formatMeters(Math.round(lengthM * 100) / 100)} m`;
}

/** Square metres above this are shown in hectares — an event field is measured in hectares, not in five-digit square metres. */
const HECTARE_M2 = 10_000;

/** An area for display, e.g. `"350 m²"` or `"1.25 ha"`. */
export function formatAreaM2(areaM2: number): string {
  if (areaM2 >= HECTARE_M2) {
    return `${formatMeters(Math.round((areaM2 / HECTARE_M2) * 100) / 100)} ha`;
  }
  return `${formatMeters(Math.round(areaM2 * 100) / 100)} m²`;
}
