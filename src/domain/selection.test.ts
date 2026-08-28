import { describe, expect, it } from "vitest";
import {
  boundsAreaM2,
  boundsContain,
  boundsFromCorners,
  boundsIntersect,
  editableObjects,
  getSelectionBoundsM,
  isSelectionLocked,
  objectIdsWithinBounds,
  toggleSelection,
} from "./selection";
import { createCircleObject, createPolygonObject, createRectangleObject } from "./objects";
import type { PlanObject } from "./types";

function makeRect(id: string, xM: number, yM: number, widthM = 2, heightM = 2, rotationDeg = 0): PlanObject {
  return { ...createRectangleObject({ layerId: "l1", name: id, xM, yM, widthM, heightM, rotationDeg }), id };
}

describe("toggleSelection", () => {
  it("adds an id that isn't selected", () => {
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes an id that is", () => {
    expect(toggleSelection(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("leaves the input untouched", () => {
    const before = ["a"];
    toggleSelection(before, "b");
    expect(before).toEqual(["a"]);
  });
});

describe("boundsFromCorners", () => {
  it("normalises a marquee dragged up and to the left", () => {
    expect(boundsFromCorners({ xM: 10, yM: 10 }, { xM: 2, yM: 4 })).toEqual({
      minXM: 2,
      minYM: 4,
      maxXM: 10,
      maxYM: 10,
    });
  });
});

describe("boundsIntersect / boundsContain", () => {
  const outer = { minXM: 0, minYM: 0, maxXM: 10, maxYM: 10 };

  it("counts touching edges as an intersection", () => {
    expect(boundsIntersect(outer, { minXM: 10, minYM: 5, maxXM: 12, maxYM: 6 })).toBe(true);
    expect(boundsIntersect(outer, { minXM: 10.001, minYM: 5, maxXM: 12, maxYM: 6 })).toBe(false);
  });

  it("distinguishes overlapping from contained", () => {
    const straddling = { minXM: 8, minYM: 8, maxXM: 12, maxYM: 12 };
    expect(boundsIntersect(outer, straddling)).toBe(true);
    expect(boundsContain(outer, straddling)).toBe(false);
    expect(boundsContain(outer, { minXM: 1, minYM: 1, maxXM: 2, maxYM: 2 })).toBe(true);
  });

  it("measures area, and never a negative one", () => {
    expect(boundsAreaM2(outer)).toBe(100);
    expect(boundsAreaM2({ minXM: 5, minYM: 5, maxXM: 1, maxYM: 1 })).toBe(0);
  });
});

describe("objectIdsWithinBounds", () => {
  const objects = [makeRect("a", 0, 0), makeRect("b", 5, 5), makeRect("c", 20, 20)];

  it("catches everything the marquee touches", () => {
    const marquee = boundsFromCorners({ xM: 1, yM: 1 }, { xM: 6, yM: 6 });
    expect(objectIdsWithinBounds(objects, marquee)).toEqual(["a", "b"]);
  });

  it("in contained mode, requires the whole object inside", () => {
    const marquee = boundsFromCorners({ xM: 1, yM: 1 }, { xM: 8, yM: 8 });
    expect(objectIdsWithinBounds(objects, marquee, { mode: "contained" })).toEqual(["b"]);
  });

  it("skips objects the caller rules out", () => {
    const marquee = boundsFromCorners({ xM: -1, yM: -1 }, { xM: 30, yM: 30 });
    expect(objectIdsWithinBounds(objects, marquee, { isEligible: (o) => o.name !== "b" })).toEqual(["a", "c"]);
  });

  it("hit-tests a rotated rectangle against its rotated bounding box", () => {
    // A 4 x 0.2 m rectangle rotated 90deg sweeps down, not across: a
    // marquee below the anchor catches it, one to the right does not.
    const thin = makeRect("thin", 0, 0, 4, 0.2, 90);
    const below = boundsFromCorners({ xM: -0.5, yM: 3 }, { xM: 0.5, yM: 5 });
    const right = boundsFromCorners({ xM: 3, yM: -0.5 }, { xM: 5, yM: 0.5 });
    expect(objectIdsWithinBounds([thin], below)).toEqual(["thin"]);
    expect(objectIdsWithinBounds([thin], right)).toEqual([]);
  });
});

describe("getSelectionBoundsM", () => {
  it("returns null for an empty selection", () => {
    expect(getSelectionBoundsM([])).toBeNull();
  });

  it("unions every kind of object, circles and polygons included", () => {
    const circle = createCircleObject({ layerId: "l1", name: "c", xM: 0, yM: 0, radiusM: 3 });
    const polygon = createPolygonObject({
      layerId: "l1",
      name: "p",
      xM: 10,
      yM: 10,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 4, yM: 0 },
        { xM: 4, yM: 2 },
      ],
    });
    expect(getSelectionBoundsM([circle, polygon])).toEqual({ minXM: -3, minYM: -3, maxXM: 14, maxYM: 12 });
  });
});

describe("editableObjects / isSelectionLocked (KL-audit)", () => {
  const onLayer = (id: string, layerId: string) =>
    createRectangleObject({ layerId, name: id, xM: 0, yM: 0, widthM: 1, heightM: 1 });

  it("keeps only the objects whose layer is unlocked", () => {
    const free = onLayer("a", "open");
    const held = onLayer("b", "locked");
    expect(editableObjects([free, held], new Set(["locked"]))).toEqual([free]);
  });

  it("reports a mixed selection as editable and a fully locked one as not", () => {
    const free = onLayer("a", "open");
    const held = onLayer("b", "locked");
    const locked = new Set(["locked"]);
    expect(isSelectionLocked([free, held], locked)).toBe(false);
    expect(isSelectionLocked([held], locked)).toBe(true);
  });

  it("treats an empty selection as unlocked, so nothing reports itself read-only for lack of content", () => {
    expect(isSelectionLocked([], new Set(["locked"]))).toBe(false);
    expect(editableObjects([], new Set(["locked"]))).toEqual([]);
  });
});
