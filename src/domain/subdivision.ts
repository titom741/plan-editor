import { createRectangleObject } from "./objects";
import type { ObjectStyle, RectangleObject } from "./types";

/**
 * Cutting a surface into a grid of real objects.
 *
 * The case this exists for: a chapiteau that has to be divided into
 * numbered stands. Those stands are *things* — each is named, priced,
 * allocated to an exhibitor, counted in the schedule and sometimes
 * removed — so they are ordinary `PlanObject`s, not a decoration drawn
 * inside the parent. That is the whole design decision here: a grid
 * property on the tent would have been a fraction of the work and would
 * have produced cells nobody could name, select or count.
 *
 * The parent is left in place: it is still the tent, and the cells sit
 * inside it. They are added after it, so they draw on top.
 */

export interface SubdivisionOptions {
  columns: number;
  rows: number;
  /** Gap between neighbouring cells, in metres — the aisles between stands. */
  gapM: number;
  /** Inset from the parent's own edges, in metres — the perimeter walkway. */
  marginM: number;
  /** Prefix for each cell's name; the grid reference is appended (e.g. "Stand A1"). */
  namePrefix: string;
  /** Style for the cells. Absent means they inherit nothing and are drawn with the app's defaults. */
  style?: ObjectStyle;
}

export interface SubdivisionSize {
  cellWidthM: number;
  cellHeightM: number;
  count: number;
}

/** Smallest cell worth creating, in metres. Below this the result is a row of slivers, not a plan. */
export const MIN_CELL_SIZE_M = 0.05;

/**
 * The size each cell would come out at, without building anything —
 * what the dialog shows while the user is still choosing numbers, since
 * "4 columns" means nothing and "4.30 × 4.10 m each" means everything.
 *
 * Returns `null` when the request doesn't fit: too many columns for the
 * width, margins wider than the object, a non-integer count.
 */
export function measureSubdivision(
  object: Pick<RectangleObject, "widthM" | "heightM">,
  options: Pick<SubdivisionOptions, "columns" | "rows" | "gapM" | "marginM">,
): SubdivisionSize | null {
  const { columns, rows, gapM, marginM } = options;
  if (!Number.isInteger(columns) || !Number.isInteger(rows) || columns < 1 || rows < 1) return null;
  if (!Number.isFinite(gapM) || gapM < 0 || !Number.isFinite(marginM) || marginM < 0) return null;

  const usableWidthM = object.widthM - 2 * marginM - gapM * (columns - 1);
  const usableHeightM = object.heightM - 2 * marginM - gapM * (rows - 1);
  const cellWidthM = usableWidthM / columns;
  const cellHeightM = usableHeightM / rows;
  if (cellWidthM < MIN_CELL_SIZE_M || cellHeightM < MIN_CELL_SIZE_M) return null;

  return { cellWidthM, cellHeightM, count: columns * rows };
}

/**
 * A cell's grid reference: rows are letters, columns are numbers, so the
 * top-left cell is `A1` — the convention every exhibition floor plan
 * already uses. Past the 26th row it doubles up (`AA1`), the same way a
 * spreadsheet does, rather than running out.
 */
export function gridReference(rowIndex: number, columnIndex: number): string {
  let row = "";
  let n = rowIndex;
  do {
    row = String.fromCharCode(65 + (n % 26)) + row;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `${row}${columnIndex + 1}`;
}

/**
 * Builds the cells. They are laid out in the parent's **local frame** and
 * created with the parent's `rotationDeg`, so a rotated tent produces
 * stands rotated with it rather than a grid lying flat under a tilted
 * roof.
 *
 * Returns an empty array when the request doesn't fit; the caller has
 * already been told by `measureSubdivision`.
 */
export function subdivideRectangle(
  object: Pick<RectangleObject, "xM" | "yM" | "widthM" | "heightM" | "rotationDeg" | "layerId" | "name">,
  options: SubdivisionOptions,
): RectangleObject[] {
  const size = measureSubdivision(object, options);
  if (!size) return [];

  const { columns, rows, gapM, marginM, namePrefix, style } = options;
  const { cellWidthM, cellHeightM } = size;
  const prefix = namePrefix.trim();

  const cells: RectangleObject[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      // Local offsets from the parent's anchor, then handed to the
      // factory along with the parent's rotation — `objectLocalToWorld`
      // is not used here because the anchor itself has to be expressed in
      // world coordinates, which is exactly what rotating the local
      // offset and adding it to the parent's anchor does.
      const localXM = marginM + column * (cellWidthM + gapM);
      const localYM = marginM + row * (cellHeightM + gapM);
      const radians = (object.rotationDeg * Math.PI) / 180;
      const cos = Math.cos(radians);
      const sin = Math.sin(radians);
      const reference = gridReference(row, column);
      cells.push(
        createRectangleObject({
          layerId: object.layerId,
          name: prefix ? `${prefix} ${reference}` : reference,
          reference,
          xM: object.xM + localXM * cos - localYM * sin,
          yM: object.yM + localXM * sin + localYM * cos,
          rotationDeg: object.rotationDeg,
          widthM: cellWidthM,
          heightM: cellHeightM,
          ...(style ? { style } : {}),
        }),
      );
    }
  }
  return cells;
}
