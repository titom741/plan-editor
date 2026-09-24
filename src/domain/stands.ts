import type { LabelDisplay } from "./display";
import type { PlanObject, RectangleObject } from "./types";

/**
 * The stands inside a marquee, as text rather than as shapes.
 *
 * KL-030 cut a surface into one real `PlanObject` per cell, on the
 * reasoning that a stand is a *thing*: named, coloured, counted, deleted
 * one by one. In use that turned out to be the wrong trade. A tent of
 * thirty stands became thirty objects that had to be selected around,
 * dragged by accident, and scrolled past in the elements panel — for a
 * grid nobody edits cell by cell once it is drawn. What people actually
 * do with it is read it, and print it with the names on.
 *
 * So the grid is a property of the marquee now, and it draws text only:
 * one free label per cell, shown or hidden by the same switches as every
 * other label (see `domain/display.ts`). Nothing is created, so nothing
 * has to be cleaned up, and changing "4 columns" to "5" is one number
 * instead of deleting twenty rectangles and starting again.
 *
 * The geometry is kept — aisle and perimeter walkway included — because
 * the point of a scale plan is that the text lands where the stand will
 * be. It is used to place labels, never to draw anything.
 */

export interface StandGrid {
  columns: number;
  rows: number;
  /** Gap between neighbouring cells, in metres — the aisles between stands. */
  gapM: number;
  /** Inset from the marquee's own edges, in metres — the perimeter walkway. */
  marginM: number;
  /**
   * One label per cell, row by row: index `row * columns + column`.
   * An empty string draws nothing, which is how a hole in the grid — a
   * technical corner, a bar — is expressed without a second concept.
   */
  labels: string[];
}

export interface StandGridSize {
  cellWidthM: number;
  cellHeightM: number;
  count: number;
}

/** A cell's placement in the marquee's own frame, and what it says. */
export interface StandCell {
  rowIndex: number;
  columnIndex: number;
  /** Grid reference (`A1`), kept even when the label is free text — it is how the dialog names its inputs. */
  reference: string;
  /** The user's text. Empty means this cell draws nothing. */
  text: string;
  /** Offsets from the marquee's anchor, before its rotation is applied. */
  xM: number;
  yM: number;
  widthM: number;
  heightM: number;
}

/** Smallest cell worth labelling, in metres. Below this the result is a row of slivers, not a plan. */
export const MIN_CELL_SIZE_M = 0.05;

/** A grid with no cells at all is not a grid; this is what an empty marquee gets. */
export const DEFAULT_STAND_GRID: Pick<StandGrid, "columns" | "rows" | "gapM" | "marginM"> = {
  columns: 4,
  rows: 2,
  gapM: 0.8,
  marginM: 0,
};

/**
 * The size each cell comes out at, without building anything — what the
 * dialog shows while the user is still choosing numbers, since "4
 * columns" means nothing and "4.30 × 4.10 m each" means everything.
 *
 * It matters more now than it did when cells were drawn: with text only,
 * this number is the sole indication that the stands actually fit.
 *
 * Returns `null` when the request doesn't fit: too many columns for the
 * width, margins wider than the object, a non-integer count.
 */
export function measureStandGrid(
  object: Pick<RectangleObject, "widthM" | "heightM">,
  grid: Pick<StandGrid, "columns" | "rows" | "gapM" | "marginM">,
): StandGridSize | null {
  const { columns, rows, gapM, marginM } = grid;
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

/** Grid references for every cell, in storage order — what a new grid is filled with. */
export function defaultStandLabels(columns: number, rows: number): string[] {
  const labels: string[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) labels.push(gridReference(row, column));
  }
  return labels;
}

/**
 * Re-lays the labels when the grid is resized, keeping each one at its
 * own (row, column).
 *
 * Padding and truncating a flat array would be shorter and wrong: the
 * labels are stored row by row, so adding one column shifts every cell
 * after the first row by one and silently rewrites the user's text into
 * the wrong squares. Cells that fall outside the new grid are dropped;
 * new ones arrive empty.
 */
export function resizeStandLabels(
  labels: readonly string[],
  from: Pick<StandGrid, "columns" | "rows">,
  to: Pick<StandGrid, "columns" | "rows">,
): string[] {
  const next: string[] = [];
  for (let row = 0; row < to.rows; row += 1) {
    for (let column = 0; column < to.columns; column += 1) {
      const withinOld = row < from.rows && column < from.columns;
      next.push((withinOld ? labels[row * from.columns + column] : undefined) ?? "");
    }
  }
  return next;
}

/** The label stored for one cell, or an empty string when the grid has no entry for it. */
export function standLabelAt(grid: StandGrid, rowIndex: number, columnIndex: number): string {
  return grid.labels[rowIndex * grid.columns + columnIndex] ?? "";
}

/**
 * Every cell of the grid, placed in the marquee's **local frame** — the
 * caller applies the marquee's rotation, exactly as it already does for
 * the shape itself. On screen that is the enclosing Konva group; on paper
 * it is `objectLocalToWorld`.
 *
 * Returns an empty array when the grid does not fit, so a marquee shrunk
 * below its own stands quietly stops labelling rather than printing text
 * on top of itself.
 */
export function standCells(
  object: Pick<RectangleObject, "widthM" | "heightM">,
  grid: StandGrid,
): StandCell[] {
  const size = measureStandGrid(object, grid);
  if (!size) return [];

  const { columns, rows, gapM, marginM } = grid;
  const { cellWidthM, cellHeightM } = size;
  const cells: StandCell[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      cells.push({
        rowIndex: row,
        columnIndex: column,
        reference: gridReference(row, column),
        text: standLabelAt(grid, row, column),
        xM: marginM + column * (cellWidthM + gapM),
        yM: marginM + row * (cellHeightM + gapM),
        widthM: cellWidthM,
        heightM: cellHeightM,
      });
    }
  }
  return cells;
}

/** The cells that actually write something. Callers draw these and skip the rest. */
export function labelledStandCells(
  object: Pick<RectangleObject, "widthM" | "heightM">,
  grid: StandGrid,
): StandCell[] {
  return standCells(object, grid).filter((cell) => cell.text.length > 0);
}

/**
 * The grid an object should write on the plan right now, or `null`.
 *
 * Shared by the screen and the PDF so the two cannot drift: "what prints
 * is what was on screen" is only true while both ask the same question.
 * It also answers a layout one — a marquee that writes stand names has to
 * move its *own* name out of the middle, or the two land on top of each
 * other in the centre cell.
 */
export function standGridToDraw(object: PlanObject, display: LabelDisplay): StandGrid | null {
  if (!display.stands) return null;
  if (object.type !== "rectangle") return null;
  // A coffret is not a marquee (KL-047): a grid left over from before the
  // shape was made electrical is kept in the file but never drawn.
  if (object.electrical) return null;
  return object.stands ?? null;
}
