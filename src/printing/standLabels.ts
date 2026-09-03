import { labelledStandCells, standGridToDraw } from "../domain/stands";
import type { LabelDisplay } from "../domain/display";
import type { PlanObject, RectangleObject, StandGrid } from "../domain/types";
import { fitLabelsToBox, type FittedLabels } from "../rendering/labelFit";
import { MM_PER_INCH, POINTS_PER_INCH } from "./pdf";

/**
 * How big a stand name comes out **on paper**, and whether the sheet's
 * scale can carry it at all.
 *
 * The PDF draws its captions as real text at point sizes, not as part of
 * the raster, so the size question has to be answered again in points —
 * and answered *once*, here, or the export and the dialogue that warns
 * about it would disagree. Both call `fitStandLabelsPt`.
 *
 * The arithmetic nobody can argue with: at 1:S, a cell of C metres is
 * C/S metres of paper. A stand of 4.4 m on a 1:500 sheet is 8.8 mm wide,
 * and a name in it cannot be more than a millimetre or two tall. Past
 * that point no software can help — the remedy is a larger scale, a
 * bigger sheet, or a numbered grid with the names in a schedule.
 */

/** A CSS pixel is 1/96 inch and a point is 1/72: the one conversion between a caption's size on screen and on paper. */
export const PT_PER_CSS_PX = POINTS_PER_INCH / 96;

/**
 * The smallest lettering worth printing, in points.
 *
 * 1.8 mm is the smallest character height ISO 3098 allows on a technical
 * drawing, and it is about right: below it a name is not read, it is
 * guessed at. When a cell cannot hold a name at this size the cell prints
 * empty and the export dialogue says why — a row of illegible specks
 * spilling into its neighbours would be worse than a blank.
 */
export const MIN_STAND_LABEL_PT = (1.8 / MM_PER_INCH) * POINTS_PER_INCH;

/** How large a stand name may grow when its cell has room to spare, unless the marquee carries a size of its own. */
export const MAX_STAND_LABEL_PT = 15;

/** Breathing room kept between a stand name and its cell's edges, in points. A name touching the aisle reads as belonging to both. */
export const STAND_LABEL_PADDING_PT = 2;

/** What a caption may come out at on paper. The floor keeps a mis-typed size printable; the ceiling stops it printing a banner. */
export const MIN_LABEL_PT = 3.5;
export const MAX_LABEL_PT = 72;

export function clampLabelPt(sizePt: number): number {
  return Math.min(MAX_LABEL_PT, Math.max(MIN_LABEL_PT, sizePt));
}

/** Points of paper per metre of ground at 1:S — 1 m becomes 1000/S mm, and a point is 1/72 inch. */
export function pointsPerMeterAtScale(scaleDenominator: number): number {
  if (!Number.isFinite(scaleDenominator) || scaleDenominator <= 0) return 0;
  return (1000 / scaleDenominator / MM_PER_INCH) * POINTS_PER_INCH;
}

/** The ceiling a marquee's own label setting puts on its stand names, or the default when it carries none. */
function ceilingPt(ownFontSizePx: number | undefined): number {
  return ownFontSizePx === undefined
    ? MAX_STAND_LABEL_PT
    : clampLabelPt(ownFontSizePx * PT_PER_CSS_PX);
}

/**
 * The size and line breaks for one marquee's stand names on paper.
 *
 * `null` when nothing fits at a readable size — the caller prints no
 * stand names at all for that marquee, which is what the screen does at
 * low zoom for the same reason.
 */
export function fitStandLabelsPt(
  object: RectangleObject,
  grid: StandGrid,
  pointsPerMeter: number,
  options?: { minSizePt?: number; maxSizePt?: number },
): FittedLabels | null {
  const cells = labelledStandCells(object, grid);
  const first = cells[0];
  if (!first) return null;
  return fitLabelsToBox(
    cells.map((cell) => cell.text),
    {
      widthPx: first.widthM * pointsPerMeter - STAND_LABEL_PADDING_PT * 2,
      heightPx: first.heightM * pointsPerMeter - STAND_LABEL_PADDING_PT * 2,
    },
    {
      maxFontSizePx: options?.maxSizePt ?? ceilingPt(object.style?.labelFontSize),
      minFontSizePx: options?.minSizePt ?? MIN_STAND_LABEL_PT,
    },
  );
}

export interface StandLegibility {
  /** The scale this was measured at, so a stale notice cannot be shown against another. */
  scaleDenominator: number;
  /** The size the names will print at, in points. `null` when none of them fits at a readable size. */
  sizePt: number | null;
  /**
   * The largest scale denominator — that is, the most zoomed-out sheet —
   * at which they would reach the readable floor. `null` when there is
   * nothing to place, or when the current scale is already enough.
   */
  readableScaleDenominator: number | null;
}

/** Every marquee on the plan that writes stand names, with the grid it writes. */
function labelledGrids(
  objects: readonly PlanObject[],
  labelDisplay: LabelDisplay,
): { object: RectangleObject; grid: StandGrid }[] {
  return objects.flatMap((object) => {
    const grid = standGridToDraw(object, labelDisplay);
    if (!grid || object.type !== "rectangle") return [];
    return labelledStandCells(object, grid).length > 0 ? [{ object, grid }] : [];
  });
}

/**
 * The size every marquee's names come out at on this scale, or `null` as
 * soon as one of them cannot be printed: a single tent of narrow stands
 * is enough to make the sheet misleading, and it is the one the user
 * needs to be told about.
 */
function worstSizePt(
  grids: readonly { object: RectangleObject; grid: StandGrid }[],
  scaleDenominator: number,
): number | null {
  const pointsPerMeter = pointsPerMeterAtScale(scaleDenominator);
  let worst: number | null = null;
  for (const { object, grid } of grids) {
    const fitted = fitStandLabelsPt(object, grid, pointsPerMeter);
    if (fitted === null) return null;
    worst = worst === null ? fitted.fontSizePx : Math.min(worst, fitted.fontSizePx);
  }
  return worst;
}

/**
 * Whether this plan's stand names survive being printed at this scale.
 *
 * When they do not, the notice has to name a scale that *would* carry
 * them, and the honest way to find it is to ask the same fitter again.
 * A closed-form answer looks available — halve the denominator and every
 * cell doubles on paper — but it is wrong: the breathing room kept around
 * a name is a fixed two points, so the space actually usable does not
 * scale with the cell. The first version of this said 1:338 where the
 * truth was 1:300, and a suggestion that does not work when pressed is
 * worse than none.
 *
 * So the scale is found by bisection on the denominator, which needs no
 * assumption beyond monotonicity: a larger denominator is a smaller
 * drawing, and a smaller drawing never fits more text.
 */
export function measureStandLegibility(
  objects: readonly PlanObject[],
  labelDisplay: LabelDisplay,
  scaleDenominator: number,
): StandLegibility {
  const grids = labelledGrids(objects, labelDisplay);
  const sizePt = worstSizePt(grids, scaleDenominator);
  if (sizePt !== null) return { scaleDenominator, sizePt, readableScaleDenominator: null };

  const low0 = 1;
  // Two different silences answered the same way: a plan that writes no
  // stand name at all, and one whose names would not fit even at 1:1 —
  // a name longer than its own stand. Neither has a scale to suggest.
  if (worstSizePt(grids, low0) === null) {
    return { scaleDenominator, sizePt: null, readableScaleDenominator: null };
  }
  let low = low0;
  let high = Math.max(1, Math.floor(scaleDenominator));
  while (high - low > 1) {
    const middle = Math.floor((low + high) / 2);
    if (worstSizePt(grids, middle) === null) high = middle;
    else low = middle;
  }
  return { scaleDenominator, sizePt: null, readableScaleDenominator: low };
}
