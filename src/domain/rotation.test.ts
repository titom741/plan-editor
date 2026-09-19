import { describe, expect, it } from "vitest";
import { getLocalCenter, objectLocalToWorld, rotateObjectToDeg } from "./geometry";
import { boundsCenterM, getObjectBoundsM } from "./bounds";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createSymbolObject,
} from "./objects";
import type { PlanObject } from "./types";

/** The world position of the point a rotate gesture pivots around. */
function pivotWorld(object: PlanObject) {
  return objectLocalToWorld(object, getLocalCenter(object));
}

describe("rotateObjectToDeg (KL-027)", () => {
  const rectangle = createRectangleObject({
    layerId: "l1",
    name: "Chapiteau",
    xM: 10,
    yM: 4,
    widthM: 20,
    heightM: 10,
  });

  it("keeps the centre exactly where it was, at every angle", () => {
    const before = pivotWorld(rectangle);
    for (const angle of [0, 15, 45, 90, 137.5, 180, 270, 359]) {
      const rotated = { ...rectangle, ...rotateObjectToDeg(rectangle, angle) };
      const after = pivotWorld(rotated);
      expect(after.xM).toBeCloseTo(before.xM, 9);
      expect(after.yM).toBeCloseTo(before.yM, 9);
    }
  });

  it("moves the anchor, which is the whole point — the corner is not the pivot", () => {
    const rotated = rotateObjectToDeg(rectangle, 90);
    expect(rotated.rotationDeg).toBe(90);
    // A 20 × 10 rectangle turned a quarter turn about its centre lands its
    // top-left corner at centre + (+h/2, -w/2) = (20 + 5, 9 - 10).
    expect(rotated.xM).toBeCloseTo(25, 9);
    expect(rotated.yM).toBeCloseTo(-1, 9);
  });

  it("is reversible: rotating back to the original angle restores the original anchor", () => {
    const there = { ...rectangle, ...rotateObjectToDeg(rectangle, 63) };
    const back = rotateObjectToDeg(there, 0);
    expect(back.xM).toBeCloseTo(rectangle.xM, 9);
    expect(back.yM).toBeCloseTo(rectangle.yM, 9);
  });

  it("leaves a circle's anchor alone — its anchor already is its centre", () => {
    const circle = createCircleObject({ layerId: "l1", name: "Rond", xM: 3, yM: 7, radiusM: 2 });
    const rotated = rotateObjectToDeg(circle, 40);
    expect(rotated.xM).toBeCloseTo(3, 9);
    expect(rotated.yM).toBeCloseTo(7, 9);
  });

  it("pivots a lopsided polyline around the middle of its extent, not its crowded end", () => {
    // Nine points bunched along the first metre, one far away: the average
    // of the points would sit near the crowd, the extent's midpoint doesn't.
    const line = createLineObject({
      layerId: "l1",
      name: "Barrière",
      xM: 0,
      yM: 0,
      pointsM: [
        ...Array.from({ length: 9 }, (_, index) => ({ xM: index / 8, yM: 0 })),
        { xM: 10, yM: 0 },
      ],
    });
    expect(getLocalCenter(line)).toEqual({ xM: 5, yM: 0 });
  });

  it("keeps a rotated polygon's bounding box centred on the same point", () => {
    const polygon = createPolygonObject({
      layerId: "l1",
      name: "Zone",
      xM: 2,
      yM: 2,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 6, yM: 0 },
        { xM: 6, yM: 3 },
        { xM: 0, yM: 3 },
      ],
    });
    const before = boundsCenterM(getObjectBoundsM(polygon)!);
    const rotated = { ...polygon, ...rotateObjectToDeg(polygon, 90) };
    const after = boundsCenterM(getObjectBoundsM(rotated)!);
    expect(after.xM).toBeCloseTo(before.xM, 9);
    expect(after.yM).toBeCloseTo(before.yM, 9);
  });
});

describe("a symbol turns on the point it marks (KL-044)", () => {
  const symbol = createSymbolObject({
    layerId: "l1",
    name: "Secours",
    xM: 12,
    yM: -3,
    character: "✚",
    sizeM: 2,
  });

  it("pivots on its anchor, which is already its centre", () => {
    expect(getLocalCenter(symbol)).toEqual({ xM: 0, yM: 0 });
  });

  it("leaves the marked point exactly where it was, at every angle", () => {
    // A symbol marks a point, so turning it must not slide that point:
    // an offset pivot would walk the mark off the thing it marks. Any
    // other local centre solves for a different anchor and this catches
    // it — which is what the first mutation pass found nothing doing.
    for (const angle of [15, 45, 90, 180, 274]) {
      const rotated = { ...symbol, ...rotateObjectToDeg(symbol, angle) };
      expect(rotated.xM).toBeCloseTo(12, 9);
      expect(rotated.yM).toBeCloseTo(-3, 9);
      expect(pivotWorld(rotated).xM).toBeCloseTo(12, 9);
      expect(pivotWorld(rotated).yM).toBeCloseTo(-3, 9);
    }
  });

  it("keeps its bounding box centred on that point too", () => {
    const rotated = { ...symbol, ...rotateObjectToDeg(symbol, 45) };
    const after = boundsCenterM(getObjectBoundsM(rotated)!);
    expect(after.xM).toBeCloseTo(12, 9);
    expect(after.yM).toBeCloseTo(-3, 9);
  });
});
