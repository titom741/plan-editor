import { describe, expect, it } from "vitest";
import {
  angleAtPointDeg,
  formatAngleDeg,
  formatAreaM2,
  formatLengthM,
  polygonAreaM2,
  polygonPerimeterM,
  polylineLengthM,
  segmentLengthsM,
} from "./measure";
import {
  collectSnapTargets,
  getObjectSnapTargets,
  snapPointM,
  snapToGridM,
} from "./snapping";
import { createCircleObject, createLineObject, createRectangleObject } from "./objects";
import type { PointM } from "./types";

const square: PointM[] = [
  { xM: 0, yM: 0 },
  { xM: 10, yM: 0 },
  { xM: 10, yM: 10 },
  { xM: 0, yM: 10 },
];

describe("lengths", () => {
  it("measures each segment of a polyline", () => {
    expect(segmentLengthsM([{ xM: 0, yM: 0 }, { xM: 3, yM: 4 }, { xM: 3, yM: 9 }])).toEqual([5, 5]);
  });

  it("has no segments below two points", () => {
    expect(segmentLengthsM([])).toEqual([]);
    expect(polylineLengthM([{ xM: 1, yM: 1 }])).toBe(0);
  });

  it("closes the loop for a perimeter but not for a polyline", () => {
    expect(polylineLengthM(square)).toBe(30);
    expect(polygonPerimeterM(square)).toBe(40);
  });
});

describe("polygonAreaM2", () => {
  it("measures a square", () => {
    expect(polygonAreaM2(square)).toBe(100);
  });

  it("is positive whichever way round the points are listed", () => {
    expect(polygonAreaM2([...square].reverse())).toBe(100);
  });

  it("measures a triangle", () => {
    expect(polygonAreaM2([{ xM: 0, yM: 0 }, { xM: 8, yM: 0 }, { xM: 0, yM: 5 }])).toBe(20);
  });

  it("is zero below three points", () => {
    expect(polygonAreaM2([{ xM: 0, yM: 0 }, { xM: 5, yM: 5 }])).toBe(0);
  });
});

describe("angles", () => {
  it("mesure l'angle intérieur au point central", () => {
    expect(angleAtPointDeg({ xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 1, yM: 1 })).toBeCloseTo(90, 9);
    expect(formatAngleDeg(45.04)).toBe("45°");
  });

  it("retourne zéro pour un segment dégénéré", () => {
    expect(angleAtPointDeg({ xM: 0, yM: 0 }, { xM: 0, yM: 0 }, { xM: 1, yM: 1 })).toBe(0);
  });
});

describe("formatting", () => {
  it("prints lengths in metres, trimmed", () => {
    expect(formatLengthM(12)).toBe("12 m");
    expect(formatLengthM(12.3456)).toBe("12.35 m");
  });

  it("switches to hectares above a hectare", () => {
    expect(formatAreaM2(350)).toBe("350 m²");
    expect(formatAreaM2(9999)).toBe("9999 m²");
    expect(formatAreaM2(12_500)).toBe("1.25 ha");
  });
});

describe("snapToGridM", () => {
  it("rounds onto the nearest intersection", () => {
    expect(snapToGridM({ xM: 4.4, yM: -1.6 }, 1)).toEqual({ xM: 4, yM: -2 });
  });

  it("is a no-op for a non-positive step", () => {
    const point = { xM: 4.4, yM: -1.6 };
    expect(snapToGridM(point, 0)).toBe(point);
  });
});

describe("getObjectSnapTargets", () => {
  it("offers a rectangle's corners, edge midpoints and centre", () => {
    const rectangle = createRectangleObject({ layerId: "l", name: "r", xM: 0, yM: 0, widthM: 10, heightM: 4 });
    const targets = getObjectSnapTargets(rectangle);
    expect(targets).toHaveLength(9);
    expect(targets.filter((t) => t.kind === "vertex")).toHaveLength(4);
    expect(targets.filter((t) => t.kind === "midpoint")).toHaveLength(4);
    expect(targets.find((t) => t.kind === "center")?.pointM).toEqual({ xM: 5, yM: 2 });
  });

  it("rotates a rectangle's targets with it", () => {
    const rotated = createRectangleObject({ layerId: "l", name: "r", xM: 0, yM: 0, widthM: 10, heightM: 4, rotationDeg: 90 });
    const centre = getObjectSnapTargets(rotated).find((t) => t.kind === "center")!.pointM;
    expect(centre.xM).toBeCloseTo(-2, 9);
    expect(centre.yM).toBeCloseTo(5, 9);
  });

  it("offers a circle's centre and four cardinal points", () => {
    const circle = createCircleObject({ layerId: "l", name: "c", xM: 5, yM: 5, radiusM: 2 });
    const targets = getObjectSnapTargets(circle);
    expect(targets).toHaveLength(5);
    expect(targets.find((t) => t.kind === "center")?.pointM).toEqual({ xM: 5, yM: 5 });
  });

  it("offers a line's vertices and its one midpoint, not a closing segment", () => {
    const line = createLineObject({
      layerId: "l",
      name: "l",
      xM: 0,
      yM: 0,
      pointsM: [{ xM: 0, yM: 0 }, { xM: 10, yM: 0 }],
    });
    const targets = getObjectSnapTargets(line);
    expect(targets.filter((t) => t.kind === "midpoint").map((t) => t.pointM)).toEqual([{ xM: 5, yM: 0 }]);
  });
});

describe("collectSnapTargets", () => {
  it("ajoute l'intersection réelle de deux segments", () => {
    const a = createLineObject({ layerId: "l", name: "a", xM: 0, yM: 0, pointsM: [{ xM: 0, yM: 0 }, { xM: 10, yM: 10 }] });
    const b = createLineObject({ layerId: "l", name: "b", xM: 0, yM: 0, pointsM: [{ xM: 0, yM: 10 }, { xM: 10, yM: 0 }] });
    expect(collectSnapTargets([a, b])).toContainEqual({ pointM: { xM: 5, yM: 5 }, kind: "intersection" });
  });
  const a = createRectangleObject({ layerId: "l", name: "a", xM: 0, yM: 0, widthM: 2, heightM: 2 });
  const b = createRectangleObject({ layerId: "hidden", name: "b", xM: 50, yM: 50, widthM: 2, heightM: 2 });

  it("excludes the objects being dragged, so they can't pin themselves", () => {
    expect(collectSnapTargets([a, b], { excludeIds: new Set([a.id]) }).every((t) => t.objectId === b.id)).toBe(true);
  });

  it("skips objects the caller rules out", () => {
    expect(collectSnapTargets([a, b], { isEligible: (o) => o.layerId === "l" }).every((t) => t.objectId === a.id)).toBe(true);
  });
});

describe("snapPointM", () => {
  const corner = { pointM: { xM: 10.2, yM: 10.2 }, kind: "vertex" as const, objectId: "o" };

  it("leaves a point alone when nothing is near", () => {
    const result = snapPointM({ xM: 3.5, yM: 3.5 }, { targets: [corner], toleranceM: 0.25 });
    expect(result.target).toBeNull();
    expect(result.pointM).toEqual({ xM: 3.5, yM: 3.5 });
  });

  it("pulls onto the nearest object target within tolerance", () => {
    const far = { pointM: { xM: 10.4, yM: 10.4 }, kind: "vertex" as const, objectId: "o" };
    const result = snapPointM({ xM: 10.25, yM: 10.25 }, { targets: [far, corner], toleranceM: 0.5 });
    expect(result.pointM).toEqual(corner.pointM);
  });

  it("prefers an object target over a closer grid intersection", () => {
    // (10, 10) is an exact grid crossing and nearer than the corner at 10.2.
    const result = snapPointM({ xM: 10.05, yM: 10.05 }, { targets: [corner], gridStepM: 1, toleranceM: 0.5 });
    expect(result.target?.kind).toBe("vertex");
    expect(result.pointM).toEqual(corner.pointM);
  });

  it("falls back to the grid when no object target is in range", () => {
    const result = snapPointM({ xM: 10.05, yM: 9.95 }, { gridStepM: 1, toleranceM: 0.25 });
    expect(result.target?.kind).toBe("grid");
    expect(result.pointM).toEqual({ xM: 10, yM: 10 });
  });

  it("projette un guide vertical sans attirer l'autre axe", () => {
    const target = { pointM: { xM: 10, yM: 50 }, kind: "center" as const, objectId: "o" };
    const result = snapPointM({ xM: 10.1, yM: 2 }, { targets: [target], toleranceM: 0.2 });
    expect(result.pointM).toEqual({ xM: 10, yM: 2 });
    expect(result.target?.kind).toBe("alignment-x");
  });

  it("leaves the point alone when even the grid is out of range", () => {
    const result = snapPointM({ xM: 10.5, yM: 10.5 }, { gridStepM: 1, toleranceM: 0.2 });
    expect(result.target).toBeNull();
    expect(result.pointM).toEqual({ xM: 10.5, yM: 10.5 });
  });
});
