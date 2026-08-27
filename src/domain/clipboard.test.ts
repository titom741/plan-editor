import { describe, expect, it } from "vitest";
import { duplicateObjects } from "./clipboard";
import { createLineObject, createRectangleObject } from "./objects";
import { getObjectBoundsM } from "./bounds";

const layerIds = new Set(["keep"]);

function context(overrides: Partial<Parameters<typeof duplicateObjects>[1]> = {}) {
  return { offsetM: { xM: 1, yM: 1 }, existingLayerIds: layerIds, fallbackLayerId: "keep", ...overrides };
}

describe("duplicateObjects", () => {
  const original = createRectangleObject({ layerId: "keep", name: "Chapiteau", xM: 5, yM: 5, widthM: 10, heightM: 4, rotationDeg: 30 });

  it("gives every copy a fresh id", () => {
    const [copy] = duplicateObjects([original], context());
    expect(copy!.id).not.toBe(original.id);
  });

  it("shifts the copy by the offset and changes nothing else about its geometry", () => {
    const [copy] = duplicateObjects([original], context({ offsetM: { xM: 2, yM: -3 } }));
    expect(copy).toMatchObject({
      type: "rectangle",
      name: "Chapiteau",
      xM: 7,
      yM: 2,
      widthM: 10,
      heightM: 4,
      rotationDeg: 30,
    });
  });

  it("keeps a line's shape, since its points are relative to the anchor", () => {
    const line = createLineObject({
      layerId: "keep",
      name: "Barrière",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 6, yM: 8 },
      ],
    });
    const [copy] = duplicateObjects([line], context({ offsetM: { xM: 100, yM: 0 } }));
    const before = getObjectBoundsM(line)!;
    const after = getObjectBoundsM(copy!)!;
    expect(after.maxXM - after.minXM).toBeCloseTo(before.maxXM - before.minXM, 9);
    expect(after.maxYM - after.minYM).toBeCloseTo(before.maxYM - before.minYM, 9);
    expect(after.minXM).toBeCloseTo(before.minXM + 100, 9);
  });

  it("rehomes a copy whose layer no longer exists, and leaves the others alone", () => {
    const orphan = createRectangleObject({ layerId: "deleted", name: "x", xM: 0, yM: 0, widthM: 1, heightM: 1 });
    const copies = duplicateObjects([original, orphan], context());
    expect(copies[0]!.layerId).toBe("keep");
    expect(copies[1]!.layerId).toBe("keep");
  });

  it("preserves the relative arrangement of a whole selection", () => {
    const a = createRectangleObject({ layerId: "keep", name: "a", xM: 0, yM: 0, widthM: 1, heightM: 1 });
    const b = createRectangleObject({ layerId: "keep", name: "b", xM: 7, yM: 3, widthM: 1, heightM: 1 });
    const [copyA, copyB] = duplicateObjects([a, b], context({ offsetM: { xM: 0.5, yM: 0.5 } }));
    expect(copyB!.xM - copyA!.xM).toBeCloseTo(b.xM - a.xM, 9);
    expect(copyB!.yM - copyA!.yM).toBeCloseTo(b.yM - a.yM, 9);
  });

  it("returns nothing for an empty clipboard", () => {
    expect(duplicateObjects([], context())).toEqual([]);
  });
});
