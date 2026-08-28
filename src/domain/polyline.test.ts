import { describe, expect, it } from "vitest";
import { distanceToSegmentM, simplifyPolylineM } from "./polyline";

describe("distanceToSegmentM", () => {
  it("measures perpendicular distance to the segment", () => {
    expect(distanceToSegmentM({ xM: 1, yM: 2 }, { xM: 0, yM: 0 }, { xM: 4, yM: 0 })).toBeCloseTo(2, 9);
  });

  it("measures to the nearer end for a point beyond the segment, not to the infinite line", () => {
    expect(distanceToSegmentM({ xM: 8, yM: 0 }, { xM: 0, yM: 0 }, { xM: 4, yM: 0 })).toBeCloseTo(4, 9);
  });

  it("collapses to point distance when the segment has no length", () => {
    expect(distanceToSegmentM({ xM: 3, yM: 4 }, { xM: 0, yM: 0 }, { xM: 0, yM: 0 })).toBeCloseTo(5, 9);
  });
});

describe("simplifyPolylineM", () => {
  it("leaves a two-point line alone", () => {
    const line = [{ xM: 0, yM: 0 }, { xM: 5, yM: 5 }];
    expect(simplifyPolylineM(line, 0.1)).toEqual(line);
  });

  it("drops the points that only restate a straight run", () => {
    const straight = Array.from({ length: 20 }, (_, index) => ({ xM: index / 2, yM: 0 }));
    expect(simplifyPolylineM(straight, 0.05)).toEqual([{ xM: 0, yM: 0 }, { xM: 9.5, yM: 0 }]);
  });

  it("keeps a corner that strays further than the tolerance", () => {
    const corner = [
      { xM: 0, yM: 0 },
      { xM: 5, yM: 3 },
      { xM: 10, yM: 0 },
    ];
    expect(simplifyPolylineM(corner, 0.5)).toEqual(corner);
  });

  it("flattens the same corner when the tolerance is wider than the deviation", () => {
    const corner = [
      { xM: 0, yM: 0 },
      { xM: 5, yM: 0.1 },
      { xM: 10, yM: 0 },
    ];
    expect(simplifyPolylineM(corner, 0.5)).toEqual([{ xM: 0, yM: 0 }, { xM: 10, yM: 0 }]);
  });

  it("always keeps both ends, so a stroke never moves where it started or finished", () => {
    const wobble = Array.from({ length: 50 }, (_, index) => ({
      xM: index * 0.1,
      yM: Math.sin(index) * 0.01,
    }));
    const simplified = simplifyPolylineM(wobble, 1);
    expect(simplified[0]).toEqual(wobble[0]);
    expect(simplified.at(-1)).toEqual(wobble.at(-1));
    expect(simplified.length).toBeLessThan(wobble.length);
  });

  it("returns the input untouched when the tolerance is zero — no silent thinning", () => {
    const points = [{ xM: 0, yM: 0 }, { xM: 1, yM: 0.001 }, { xM: 2, yM: 0 }];
    expect(simplifyPolylineM(points, 0)).toEqual(points);
  });
});
