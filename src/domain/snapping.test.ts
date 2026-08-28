import { describe, expect, it } from "vitest";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createTextObject,
} from "./objects";
import {
  collectSnapTargets,
  getObjectSnapTargets,
  snapPointM,
  snapToGridM,
  type SnapTarget,
} from "./snapping";

const LAYER = "layer-1";

/** Compares targets by kind and rounded position — ordering is an implementation detail. */
function describeTargets(targets: readonly SnapTarget[]): string[] {
  return targets
    .map(
      (target) => `${target.kind} ${+target.pointM.xM.toFixed(6)},${+target.pointM.yM.toFixed(6)}`,
    )
    .sort();
}

describe("snapToGridM", () => {
  it("rounds onto the nearest intersection", () => {
    expect(snapToGridM({ xM: 1.2, yM: 2.7 }, 1)).toEqual({ xM: 1, yM: 3 });
    expect(snapToGridM({ xM: -1.2, yM: -2.7 }, 1)).toEqual({ xM: -1, yM: -3 });
  });

  it("handles a sub-metre step", () => {
    expect(snapToGridM({ xM: 1.26, yM: 0 }, 0.25)).toEqual({ xM: 1.25, yM: 0 });
  });

  it("leaves the point alone when there is no grid to speak of", () => {
    const point = { xM: 1.2, yM: 2.7 };
    expect(snapToGridM(point, 0)).toBe(point);
    expect(snapToGridM(point, -1)).toBe(point);
    expect(snapToGridM(point, Number.NaN)).toBe(point);
  });
});

describe("getObjectSnapTargets", () => {
  it("offers a rectangle's corners, edge midpoints and centre", () => {
    const rectangle = createRectangleObject({
      layerId: LAYER,
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 10,
      heightM: 6,
    });
    expect(describeTargets(getObjectSnapTargets(rectangle))).toEqual(
      describeTargets([
        { pointM: { xM: 0, yM: 0 }, kind: "vertex" },
        { pointM: { xM: 10, yM: 0 }, kind: "vertex" },
        { pointM: { xM: 10, yM: 6 }, kind: "vertex" },
        { pointM: { xM: 0, yM: 6 }, kind: "vertex" },
        { pointM: { xM: 5, yM: 0 }, kind: "midpoint" },
        { pointM: { xM: 10, yM: 3 }, kind: "midpoint" },
        { pointM: { xM: 5, yM: 6 }, kind: "midpoint" },
        { pointM: { xM: 0, yM: 3 }, kind: "midpoint" },
        { pointM: { xM: 5, yM: 3 }, kind: "center" },
      ]),
    );
  });

  it("rotates the targets with the object", () => {
    // A rotated rectangle whose snap points stayed axis-aligned would pull
    // the pointer onto corners the object no longer has.
    const rotated = createRectangleObject({
      layerId: LAYER,
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 10,
      heightM: 6,
      rotationDeg: 90,
    });
    const centre = getObjectSnapTargets(rotated).find((target) => target.kind === "center");
    expect(centre?.pointM.xM).toBeCloseTo(-3, 9);
    expect(centre?.pointM.yM).toBeCloseTo(5, 9);
  });

  it("tags every target with the object it came from", () => {
    const rectangle = createRectangleObject({
      layerId: LAYER,
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 2,
      heightM: 2,
    });
    expect(
      getObjectSnapTargets(rectangle).every((target) => target.objectId === rectangle.id),
    ).toBe(true);
  });

  it("offers a circle its centre and four cardinal points", () => {
    const circle = createCircleObject({ layerId: LAYER, name: "Rond", xM: 4, yM: 4, radiusM: 2 });
    expect(describeTargets(getObjectSnapTargets(circle))).toEqual(
      describeTargets([
        { pointM: { xM: 4, yM: 4 }, kind: "center" },
        { pointM: { xM: 4, yM: 2 }, kind: "vertex" },
        { pointM: { xM: 6, yM: 4 }, kind: "vertex" },
        { pointM: { xM: 4, yM: 6 }, kind: "vertex" },
        { pointM: { xM: 2, yM: 4 }, kind: "vertex" },
      ]),
    );
  });

  it("gives an open line one midpoint per segment, with no closing segment", () => {
    const line = createLineObject({
      layerId: LAYER,
      name: "Câble",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 4, yM: 0 },
        { xM: 4, yM: 4 },
      ],
    });
    expect(describeTargets(getObjectSnapTargets(line))).toEqual(
      describeTargets([
        { pointM: { xM: 0, yM: 0 }, kind: "vertex" },
        { pointM: { xM: 4, yM: 0 }, kind: "vertex" },
        { pointM: { xM: 4, yM: 4 }, kind: "vertex" },
        { pointM: { xM: 2, yM: 0 }, kind: "midpoint" },
        { pointM: { xM: 4, yM: 2 }, kind: "midpoint" },
      ]),
    );
  });

  it("closes a polygon, so its last edge has a midpoint too", () => {
    const polygon = createPolygonObject({
      layerId: LAYER,
      name: "Zone",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 4, yM: 0 },
        { xM: 4, yM: 4 },
      ],
    });
    const midpoints = getObjectSnapTargets(polygon).filter((t) => t.kind === "midpoint");
    expect(describeTargets(midpoints)).toEqual(
      describeTargets([
        { pointM: { xM: 2, yM: 0 }, kind: "midpoint" },
        { pointM: { xM: 4, yM: 2 }, kind: "midpoint" },
        { pointM: { xM: 2, yM: 2 }, kind: "midpoint" },
      ]),
    );
  });

  it("gives a text object its anchor and nothing else", () => {
    const text = createTextObject({ layerId: LAYER, name: "Titre", xM: 3, yM: 7, text: "Entrée" });
    expect(getObjectSnapTargets(text)).toEqual([
      { pointM: { xM: 3, yM: 7 }, kind: "vertex", objectId: text.id },
    ]);
  });
});

describe("collectSnapTargets", () => {
  const wide = createRectangleObject({
    layerId: LAYER,
    name: "Barrière",
    xM: 0,
    yM: 0,
    widthM: 10,
    heightM: 2,
  });
  const tall = createRectangleObject({
    layerId: LAYER,
    name: "Allée",
    xM: 4,
    yM: -3,
    widthM: 2,
    heightM: 10,
  });

  it("finds where two objects' edges cross", () => {
    const intersections = collectSnapTargets([wide, tall]).filter((t) => t.kind === "intersection");
    expect(describeTargets(intersections)).toEqual(
      describeTargets([
        { pointM: { xM: 4, yM: 0 }, kind: "intersection" },
        { pointM: { xM: 6, yM: 0 }, kind: "intersection" },
        { pointM: { xM: 4, yM: 2 }, kind: "intersection" },
        { pointM: { xM: 6, yM: 2 }, kind: "intersection" },
      ]),
    );
  });

  it("never crosses an object with itself", () => {
    // A rectangle's own edges meet at its corners, which are already
    // vertex targets; reporting them again as intersections would just
    // weight the corners twice.
    expect(collectSnapTargets([wide]).some((t) => t.kind === "intersection")).toBe(false);
  });

  it("drops an excluded object entirely, targets and crossings alike", () => {
    // Without this a dragged object snaps to itself and pins in place.
    const targets = collectSnapTargets([wide, tall], { excludeIds: new Set([tall.id]) });
    expect(targets.some((target) => target.objectId === tall.id)).toBe(false);
    expect(targets.some((target) => target.kind === "intersection")).toBe(false);
  });

  it("honours the eligibility filter, crossings included", () => {
    const targets = collectSnapTargets([wide, tall], {
      isEligible: (object) => object.id !== tall.id,
    });
    expect(targets.some((target) => target.objectId === tall.id)).toBe(false);
    expect(targets.some((target) => target.kind === "intersection")).toBe(false);
  });

  it("returns nothing for an empty plan", () => {
    expect(collectSnapTargets([])).toEqual([]);
  });
});

describe("snapPointM", () => {
  const vertex = (xM: number, yM: number): SnapTarget => ({
    pointM: { xM, yM },
    kind: "vertex",
    objectId: "obj-1",
  });

  it("pulls the point onto the nearest target in range", () => {
    const result = snapPointM(
      { xM: 1.1, yM: 0.05 },
      { targets: [vertex(1, 0), vertex(4, 0)], toleranceM: 0.5 },
    );
    expect(result.pointM).toEqual({ xM: 1, yM: 0 });
    expect(result.target?.kind).toBe("vertex");
    expect(result.target?.objectId).toBe("obj-1");
  });

  it("prefers a real object point over a closer grid crossing", () => {
    // The documented rule: a corner is a deliberate place, a grid crossing
    // is an arbitrary one. Losing the corner because a grid line ran
    // nearer is what makes people switch snapping off altogether.
    const result = snapPointM(
      { xM: 1.05, yM: 0 },
      { targets: [vertex(0.9, 0)], gridStepM: 1, toleranceM: 0.5 },
    );
    expect(result.pointM).toEqual({ xM: 0.9, yM: 0 });
    expect(result.target?.kind).toBe("vertex");
  });

  it("constrains one axis and leaves the other exactly under the pointer", () => {
    // An alignment guide is how you line something up with an object far
    // away up the plan; forcing the second coordinate too would drag the
    // object to that object instead of aligning with it.
    const result = snapPointM({ xM: 5.1, yM: 0 }, { targets: [vertex(5, 100)], toleranceM: 0.5 });
    expect(result.pointM).toEqual({ xM: 5, yM: 0 });
    expect(result.target?.kind).toBe("alignment-x");
  });

  it("reports both axes when two guides cross", () => {
    const result = snapPointM(
      { xM: 5.1, yM: 20.1 },
      { targets: [vertex(5, 100), vertex(-100, 20)], toleranceM: 0.5 },
    );
    expect(result.pointM).toEqual({ xM: 5, yM: 20 });
    expect(result.target?.kind).toBe("alignment-xy");
  });

  it("falls back to the grid when no object is near", () => {
    const result = snapPointM({ xM: 1.2, yM: 2.1 }, { gridStepM: 1, toleranceM: 0.5 });
    expect(result.pointM).toEqual({ xM: 1, yM: 2 });
    expect(result.target?.kind).toBe("grid");
  });

  it("leaves the point untouched when even the grid is out of reach", () => {
    const point = { xM: 1.5, yM: 1.5 };
    const result = snapPointM(point, { gridStepM: 1, toleranceM: 0.3 });
    expect(result.pointM).toEqual(point);
    expect(result.target).toBeNull();
  });

  it("does nothing at all with no targets and no grid", () => {
    const point = { xM: 1.234, yM: 5.678 };
    const result = snapPointM(point, { toleranceM: 0.5 });
    expect(result.pointM).toBe(point);
    expect(result.target).toBeNull();
  });

  it("never moves the point when the tolerance is zero", () => {
    // A zero tolerance can still *report* an alignment when a target
    // shares a coordinate exactly — but the reported point is the one
    // that came in, so nothing is displaced.
    const point = { xM: 1.01, yM: 0 };
    expect(
      snapPointM(point, { targets: [vertex(1, 0)], gridStepM: 1, toleranceM: 0 }).pointM,
    ).toEqual(point);
    expect(
      snapPointM({ xM: 1, yM: 0 }, { targets: [vertex(1, 0)], toleranceM: 0 }).target?.kind,
    ).toBe("vertex");
  });
});
