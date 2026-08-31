import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_DISPLAY } from "./display";
import {
  DEFAULT_STAND_GRID,
  defaultStandLabels,
  gridReference,
  labelledStandCells,
  measureStandGrid,
  MIN_CELL_SIZE_M,
  resizeStandLabels,
  standCells,
  standGridToDraw,
  standLabelAt,
  type StandGrid,
} from "./stands";
import { createCircleObject, createRectangleObject } from "./objects";

const marquee = (widthM = 20, heightM = 10) =>
  createRectangleObject({ layerId: "l1", name: "Chapiteau", xM: 0, yM: 0, widthM, heightM });

const grid = (overrides: Partial<StandGrid> = {}): StandGrid => {
  const columns = overrides.columns ?? 2;
  const rows = overrides.rows ?? 2;
  return {
    columns,
    rows,
    gapM: 0,
    marginM: 0,
    labels: defaultStandLabels(columns, rows),
    ...overrides,
  };
};

describe("measureStandGrid", () => {
  it("divides the surface evenly when there is no aisle and no walkway", () => {
    expect(measureStandGrid(marquee(20, 10), { columns: 4, rows: 2, gapM: 0, marginM: 0 })).toEqual(
      {
        cellWidthM: 5,
        cellHeightM: 5,
        count: 8,
      },
    );
  });

  it("takes the aisles out of the usable width, not out of the cell count", () => {
    // Three columns have two aisles between them, not three.
    const size = measureStandGrid(marquee(20, 10), { columns: 3, rows: 1, gapM: 1, marginM: 0 });
    expect(size?.cellWidthM).toBeCloseTo(6);
    expect(size?.cellHeightM).toBe(10);
  });

  it("takes the perimeter walkway off both edges", () => {
    const size = measureStandGrid(marquee(20, 10), { columns: 1, rows: 1, gapM: 0, marginM: 2 });
    expect(size).toEqual({ cellWidthM: 16, cellHeightM: 6, count: 1 });
  });

  it("refuses a grid that does not fit rather than returning slivers", () => {
    expect(
      measureStandGrid(marquee(2, 2), { columns: 100, rows: 1, gapM: 0, marginM: 0 }),
    ).toBeNull();
    expect(
      measureStandGrid(marquee(10, 10), { columns: 1, rows: 1, gapM: 0, marginM: 6 }),
    ).toBeNull();
    expect(
      measureStandGrid(marquee(10, 10), { columns: 3, rows: 1, gapM: 5, marginM: 0 }),
    ).toBeNull();
  });

  it("refuses a fractional or empty grid", () => {
    expect(measureStandGrid(marquee(), { columns: 2.5, rows: 2, gapM: 0, marginM: 0 })).toBeNull();
    expect(measureStandGrid(marquee(), { columns: 0, rows: 2, gapM: 0, marginM: 0 })).toBeNull();
    expect(measureStandGrid(marquee(), { columns: 2, rows: -1, gapM: 0, marginM: 0 })).toBeNull();
  });

  it("refuses a negative or non-finite aisle or walkway", () => {
    // A negative gap would widen the cells past the marquee's own edges.
    expect(measureStandGrid(marquee(), { columns: 2, rows: 2, gapM: -1, marginM: 0 })).toBeNull();
    expect(measureStandGrid(marquee(), { columns: 2, rows: 2, gapM: 0, marginM: -1 })).toBeNull();
    expect(measureStandGrid(marquee(), { columns: 2, rows: 2, gapM: NaN, marginM: 0 })).toBeNull();
  });

  it("accepts a cell exactly at the minimum and refuses one just under", () => {
    const widthM = MIN_CELL_SIZE_M * 4;
    expect(
      measureStandGrid({ widthM, heightM: 1 }, { columns: 4, rows: 1, gapM: 0, marginM: 0 }),
    ).not.toBeNull();
    expect(
      measureStandGrid({ widthM, heightM: 1 }, { columns: 5, rows: 1, gapM: 0, marginM: 0 }),
    ).toBeNull();
  });
});

describe("gridReference", () => {
  it("names rows with letters and columns with numbers, starting at A1", () => {
    expect(gridReference(0, 0)).toBe("A1");
    expect(gridReference(0, 3)).toBe("A4");
    expect(gridReference(2, 0)).toBe("C1");
  });

  it("doubles the letter past the 26th row instead of running out", () => {
    expect(gridReference(25, 0)).toBe("Z1");
    expect(gridReference(26, 0)).toBe("AA1");
    expect(gridReference(51, 1)).toBe("AZ2");
  });
});

describe("defaultStandLabels", () => {
  it("fills the grid row by row, in storage order", () => {
    expect(defaultStandLabels(3, 2)).toEqual(["A1", "A2", "A3", "B1", "B2", "B3"]);
  });

  it("produces exactly one label per cell", () => {
    expect(defaultStandLabels(5, 4)).toHaveLength(20);
  });
});

describe("resizeStandLabels", () => {
  it("keeps each label at its own row and column when a column is added", () => {
    // The bug this exists for: padding the flat array would leave
    // ["A1","A2","B1"] and shift B1 into the first row's new third cell.
    const before = ["A1", "A2", "B1", "B2"];
    expect(resizeStandLabels(before, { columns: 2, rows: 2 }, { columns: 3, rows: 2 })).toEqual([
      "A1",
      "A2",
      "",
      "B1",
      "B2",
      "",
    ]);
  });

  it("keeps each label in place when a column is removed", () => {
    const before = ["A1", "A2", "A3", "B1", "B2", "B3"];
    expect(resizeStandLabels(before, { columns: 3, rows: 2 }, { columns: 2, rows: 2 })).toEqual([
      "A1",
      "A2",
      "B1",
      "B2",
    ]);
  });

  it("adds empty cells for a new row and drops a removed one", () => {
    expect(
      resizeStandLabels(["A1", "A2"], { columns: 2, rows: 1 }, { columns: 2, rows: 2 }),
    ).toEqual(["A1", "A2", "", ""]);
    expect(
      resizeStandLabels(["A1", "A2", "B1", "B2"], { columns: 2, rows: 2 }, { columns: 2, rows: 1 }),
    ).toEqual(["A1", "A2"]);
  });

  it("preserves the user's own text, not just grid references", () => {
    const before = ["Boulanger", "Poterie", "Fromager", "Bijoux"];
    expect(resizeStandLabels(before, { columns: 2, rows: 2 }, { columns: 3, rows: 2 })).toEqual([
      "Boulanger",
      "Poterie",
      "",
      "Fromager",
      "Bijoux",
      "",
    ]);
  });

  it("always returns exactly one entry per cell of the new grid", () => {
    expect(resizeStandLabels([], { columns: 1, rows: 1 }, { columns: 4, rows: 3 })).toHaveLength(
      12,
    );
  });
});

describe("standLabelAt", () => {
  it("reads a label by row and column, not by flat index", () => {
    const g = grid({ columns: 3, rows: 2 });
    expect(standLabelAt(g, 0, 2)).toBe("A3");
    expect(standLabelAt(g, 1, 0)).toBe("B1");
  });

  it("answers empty for a cell the labels do not cover", () => {
    expect(standLabelAt({ ...grid(), labels: [] }, 1, 1)).toBe("");
  });
});

describe("standCells", () => {
  it("places each cell in the marquee's own frame, before any rotation", () => {
    const cells = standCells(marquee(20, 10), grid({ columns: 2, rows: 2 }));
    expect(cells.map((cell) => [cell.xM, cell.yM])).toEqual([
      [0, 0],
      [10, 0],
      [0, 5],
      [10, 5],
    ]);
    expect(cells.every((cell) => cell.widthM === 10 && cell.heightM === 5)).toBe(true);
  });

  it("steps over the aisle and starts after the walkway", () => {
    const cells = standCells(marquee(21, 10), grid({ columns: 2, rows: 1, gapM: 1, marginM: 2 }));
    // 21 − 2×2 walkway − 1 aisle = 16, so two cells of 8.
    expect(cells[0]).toMatchObject({ xM: 2, yM: 2, widthM: 8 });
    expect(cells[1]).toMatchObject({ xM: 11, yM: 2, widthM: 8 });
  });

  it("carries the label and the grid reference of each cell", () => {
    const cells = standCells(
      marquee(),
      grid({ columns: 2, rows: 1, labels: ["Boulanger", "Poterie"] }),
    );
    expect(cells.map((cell) => cell.text)).toEqual(["Boulanger", "Poterie"]);
    expect(cells.map((cell) => cell.reference)).toEqual(["A1", "A2"]);
  });

  it("stops labelling rather than writing on itself when the marquee is shrunk under its grid", () => {
    expect(standCells(marquee(0.1, 0.1), grid({ columns: 10, rows: 10 }))).toEqual([]);
  });
});

describe("labelledStandCells", () => {
  it("skips the cells left empty, so a technical corner writes nothing", () => {
    const cells = labelledStandCells(
      marquee(),
      grid({ columns: 2, rows: 2, labels: ["Boulanger", "", "", "Bar"] }),
    );
    expect(cells.map((cell) => cell.text)).toEqual(["Boulanger", "Bar"]);
    // And the ones that remain keep their real position in the grid.
    expect(cells.map((cell) => cell.reference)).toEqual(["A1", "B2"]);
  });
});

describe("standGridToDraw", () => {
  const withGrid = { ...marquee(), stands: grid() };

  it("hands back the grid when the switch is on", () => {
    expect(standGridToDraw(withGrid, DEFAULT_LABEL_DISPLAY)).toBe(withGrid.stands);
  });

  it("draws nothing once the stands switch is off", () => {
    expect(standGridToDraw(withGrid, { ...DEFAULT_LABEL_DISPLAY, stands: false })).toBeNull();
  });

  it("draws nothing for a rectangle without a grid, which is nearly all of them", () => {
    expect(standGridToDraw(marquee(), DEFAULT_LABEL_DISPLAY)).toBeNull();
  });

  it("draws nothing for a shape that cannot carry one", () => {
    const circle = createCircleObject({ layerId: "l1", name: "Rond", xM: 0, yM: 0, radiusM: 3 });
    expect(standGridToDraw(circle, DEFAULT_LABEL_DISPLAY)).toBeNull();
  });

  it("ignores a grid that somehow ended up on a shape with no width to divide", () => {
    // Only a rectangle has the width and height a grid is measured
    // against. A hand-edited file can still carry the field anywhere, and
    // honouring it there would divide dimensions that do not exist.
    const circle = {
      ...createCircleObject({ layerId: "l1", name: "Rond", xM: 0, yM: 0, radiusM: 3 }),
      stands: grid(),
    };
    expect(standGridToDraw(circle, DEFAULT_LABEL_DISPLAY)).toBeNull();
  });
});

describe("DEFAULT_STAND_GRID", () => {
  it("fits inside an ordinary marquee, so the dialog opens on something valid", () => {
    expect(measureStandGrid(marquee(20, 10), DEFAULT_STAND_GRID)).not.toBeNull();
  });
});
