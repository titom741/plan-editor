import { describe, expect, it } from "vitest";
import { gridReference, measureSubdivision, subdivideRectangle } from "./subdivision";
import { createRectangleObject } from "./objects";
import { getObjectBoundsM } from "./bounds";

const tent = createRectangleObject({
  layerId: "structures",
  name: "Chapiteau",
  xM: 0,
  yM: 0,
  widthM: 20,
  heightM: 10,
});

const base = { columns: 4, rows: 2, gapM: 0.8, marginM: 0, namePrefix: "Stand" };

describe("gridReference", () => {
  it("numbers columns and letters rows, like every exhibition floor plan", () => {
    expect(gridReference(0, 0)).toBe("A1");
    expect(gridReference(0, 3)).toBe("A4");
    expect(gridReference(1, 0)).toBe("B1");
  });

  it("doubles the letter past the 26th row instead of running out", () => {
    expect(gridReference(25, 0)).toBe("Z1");
    expect(gridReference(26, 0)).toBe("AA1");
    expect(gridReference(27, 1)).toBe("AB2");
  });
});

describe("measureSubdivision", () => {
  it("gives the cell size the user actually needs to see", () => {
    // 20 m − 3 gaps of 0.8 = 17.6, over 4 columns.
    expect(measureSubdivision(tent, base)).toEqual({ cellWidthM: 4.4, cellHeightM: 4.6, count: 8 });
  });

  it("takes the perimeter margin off both sides", () => {
    const size = measureSubdivision(tent, { ...base, marginM: 1 });
    expect(size?.cellWidthM).toBeCloseTo((20 - 2 - 2.4) / 4, 9);
    expect(size?.cellHeightM).toBeCloseTo((10 - 2 - 0.8) / 2, 9);
  });

  it("refuses a request that doesn't fit rather than producing slivers", () => {
    expect(measureSubdivision(tent, { ...base, columns: 500 })).toBeNull();
    expect(measureSubdivision(tent, { ...base, marginM: 11 })).toBeNull();
    expect(measureSubdivision(tent, { ...base, gapM: 8 })).toBeNull();
  });

  it("refuses nonsense counts", () => {
    expect(measureSubdivision(tent, { ...base, columns: 0 })).toBeNull();
    expect(measureSubdivision(tent, { ...base, rows: 2.5 })).toBeNull();
    expect(measureSubdivision(tent, { ...base, gapM: -1 })).toBeNull();
  });
});

describe("subdivideRectangle", () => {
  it("creates one real object per cell, named by grid reference", () => {
    const cells = subdivideRectangle(tent, base);
    expect(cells).toHaveLength(8);
    expect(cells.map((cell) => cell.name)).toEqual([
      "Stand A1", "Stand A2", "Stand A3", "Stand A4",
      "Stand B1", "Stand B2", "Stand B3", "Stand B4",
    ]);
    // Each carries its reference, so the schedule can group by it.
    expect(cells[5]?.reference).toBe("B2");
  });

  it("gives every cell a fresh id and the parent's layer", () => {
    const cells = subdivideRectangle(tent, base);
    expect(new Set(cells.map((cell) => cell.id)).size).toBe(cells.length);
    expect(cells.every((cell) => cell.layerId === "structures")).toBe(true);
  });

  it("lays the cells out inside the parent, without overlapping", () => {
    const cells = subdivideRectangle(tent, { ...base, marginM: 0.5 });
    const parentBounds = getObjectBoundsM(tent)!;
    for (const cell of cells) {
      const bounds = getObjectBoundsM(cell)!;
      expect(bounds.minXM).toBeGreaterThanOrEqual(parentBounds.minXM - 1e-9);
      expect(bounds.minYM).toBeGreaterThanOrEqual(parentBounds.minYM - 1e-9);
      expect(bounds.maxXM).toBeLessThanOrEqual(parentBounds.maxXM + 1e-9);
      expect(bounds.maxYM).toBeLessThanOrEqual(parentBounds.maxYM + 1e-9);
    }
    // Neighbours on the same row are exactly one gap apart.
    const [first, second] = cells;
    expect(second!.xM - first!.xM).toBeCloseTo(first!.widthM + 0.8, 9);
  });

  it("rotates the grid with the parent — stands under a tilted roof are tilted too", () => {
    const rotated = { ...tent, rotationDeg: 90 };
    const cells = subdivideRectangle(rotated, base);
    expect(cells.every((cell) => cell.rotationDeg === 90)).toBe(true);
    // The whole grid still sits within the rotated parent's extent.
    const parentBounds = getObjectBoundsM(rotated)!;
    for (const cell of cells) {
      const bounds = getObjectBoundsM(cell)!;
      expect(bounds.minXM).toBeGreaterThanOrEqual(parentBounds.minXM - 1e-9);
      expect(bounds.maxYM).toBeLessThanOrEqual(parentBounds.maxYM + 1e-9);
    }
  });

  it("returns nothing when the request doesn't fit, rather than throwing", () => {
    expect(subdivideRectangle(tent, { ...base, columns: 500 })).toEqual([]);
  });

  it("falls back to the bare reference when no prefix is given", () => {
    const cells = subdivideRectangle(tent, { ...base, namePrefix: "  " });
    expect(cells[0]?.name).toBe("A1");
  });
});
