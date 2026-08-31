import { boundsCenterM } from "../domain/bounds";
import type { BoundsM } from "../domain/bounds";
import {
  getPaperSizeMm,
  getPrintableAreaMm,
  metersToPaperMm,
  paperMmToMeters,
} from "../domain/sheets";
import type { PointM, Sheet } from "../domain/types";
import type { Viewport } from "../rendering/viewport";
import { MM_PER_INCH, mmToPt, ptToMm } from "./pdf";

/**
 * Where everything sits on the printed sheet, in PDF points.
 *
 * Pure arithmetic — it produces a description of the page, and something
 * else renders it. Keeping it separate is what lets the on-screen preview
 * and the exported PDF be laid out by the same code instead of two
 * implementations that agree until they don't.
 *
 * PDF's origin is the bottom-left corner with Y increasing upwards, the
 * opposite of the screen. Everything returned here is already in that
 * frame, so the writer never has to flip anything.
 */

/** Height reserved at the bottom of the frame for the title block, in millimetres. */
const TITLE_BLOCK_HEIGHT_MM = 16;

/**
 * Ground lengths a scale bar is allowed to represent — round numbers only;
 * a bar labelled "37 m" helps nobody. The sub-metre entries matter at the
 * fine end: on a 1:20 detail sheet even 1 m is 50 mm of ink, too wide for
 * a narrow title block, and a 0.5 m bar is perfectly ordinary there.
 */
const SCALE_BAR_CANDIDATES_M = [
  0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000,
] as const;

/** Upper cap on the drawn length of a scale bar, in millimetres — a bar wider than this looks absurd even on A0. */
const SCALE_BAR_MAX_MM = 50;

/** Gap kept between the end of the scale bar and the right-hand column, in millimetres. */
const SCALE_BAR_GUTTER_MM = 6;

export interface Rect {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

export interface ScaleBar {
  /** The round ground distance the bar represents. */
  lengthM: number;
  lengthPt: number;
  xPt: number;
  yPt: number;
  heightPt: number;
}

/**
 * The title block is three columns and two baselines, laid out here rather
 * than by the caller so the pieces provably can't collide — which they did
 * on the first attempt, printing the project name straight through the
 * location. Baselines are absolute Y in PDF points.
 */
export interface TitleBlockLayout extends Rect {
  /** Project name and, on the right, the scale — the upper line. */
  upperBaselinePt: number;
  /** Location and date — the lower line. */
  lowerBaselinePt: number;
  leftColumnXPt: number;
  middleColumnXPt: number;
  rightColumnXPt: number;
}

export interface SheetLayout {
  pageWidthPt: number;
  pageHeightPt: number;
  /** The border drawn just inside the margin. */
  frame: Rect;
  /** Where the rendered plan is placed. */
  drawing: Rect;
  /** How much ground the drawing area shows, at the sheet's scale — what the raster must be rendered to cover. */
  drawingAreaM: { widthM: number; heightM: number };
  /** World point that lands at the centre of the drawing area. */
  drawingCenterM: PointM;
  titleBlock: TitleBlockLayout;
  scaleBar: ScaleBar;
}

/**
 * Picks the round ground distance for the scale bar: the largest candidate
 * that still fits within `maxMm` on paper. Falls back to the smallest
 * candidate at very coarse scales, where even 1 m is wider than the
 * allowance — a bar slightly too long is more useful than none.
 */
export function chooseScaleBarLengthM(
  scaleDenominator: number,
  maxMm: number = SCALE_BAR_MAX_MM,
): number {
  let chosen: number = SCALE_BAR_CANDIDATES_M[0];
  for (const candidate of SCALE_BAR_CANDIDATES_M) {
    if (metersToPaperMm(candidate, scaleDenominator) <= maxMm) chosen = candidate;
  }
  return chosen;
}

/**
 * Lays out a sheet for a plan whose extent is `contentBounds` (null for an
 * empty plan, which is then centred on the world origin).
 *
 * The drawing is *centred on the content*, not anchored to the world
 * origin: a plan drawn far from (0, 0) — which is normal, since a
 * background lands wherever it lands — would otherwise print as an empty
 * page. Note that centring is all this does; it never rescales to fit,
 * because the scale is the user's decision and quietly changing it would
 * make the printed 1:200 label a lie.
 */
export function computeSheetLayout(sheet: Sheet, contentBounds: BoundsM | null): SheetLayout {
  const paper = getPaperSizeMm(sheet);
  const printable = getPrintableAreaMm(sheet);

  const pageWidthPt = mmToPt(paper.widthMm);
  const pageHeightPt = mmToPt(paper.heightMm);
  const marginPt = mmToPt(sheet.marginMm);

  const frame: Rect = {
    xPt: marginPt,
    yPt: marginPt,
    widthPt: mmToPt(printable.widthMm),
    heightPt: mmToPt(printable.heightMm),
  };

  const titleBlockHeightPt = Math.min(mmToPt(TITLE_BLOCK_HEIGHT_MM), frame.heightPt);
  const titleBlock: TitleBlockLayout = {
    xPt: frame.xPt,
    yPt: frame.yPt,
    widthPt: frame.widthPt,
    heightPt: titleBlockHeightPt,
    // Two baselines in the upper and lower halves of the block; clamped to
    // the block so a squeezed sheet can't push text outside the frame.
    upperBaselinePt: frame.yPt + Math.min(mmToPt(10), titleBlockHeightPt * 0.62),
    lowerBaselinePt: frame.yPt + Math.min(mmToPt(4), titleBlockHeightPt * 0.25),
    leftColumnXPt: frame.xPt + mmToPt(4),
    middleColumnXPt: frame.xPt + frame.widthPt * 0.5,
    rightColumnXPt: frame.xPt + frame.widthPt * 0.75,
  };

  const drawing: Rect = {
    xPt: frame.xPt,
    yPt: frame.yPt + titleBlockHeightPt,
    widthPt: frame.widthPt,
    heightPt: Math.max(0, frame.heightPt - titleBlockHeightPt),
  };

  const drawingAreaM = {
    widthM: paperMmToMeters(printable.widthMm, sheet.scaleDenominator),
    heightM: paperMmToMeters(
      printable.heightMm - Math.min(TITLE_BLOCK_HEIGHT_MM, printable.heightMm),
      sheet.scaleDenominator,
    ),
  };

  // The bar lives in the middle column, clear of the left column's text —
  // both used to start at the same x and print on top of each other. Its
  // allowance comes from the width actually available between the middle
  // and right columns rather than a fixed number, or a narrow sheet (A4
  // portrait) leaves it running into the date.
  const columnWidthMm =
    ptToMm(titleBlock.rightColumnXPt - titleBlock.middleColumnXPt) - SCALE_BAR_GUTTER_MM;
  const scaleBarLengthM = chooseScaleBarLengthM(
    sheet.scaleDenominator,
    Math.min(SCALE_BAR_MAX_MM, Math.max(0, columnWidthMm)),
  );
  const scaleBar: ScaleBar = {
    lengthM: scaleBarLengthM,
    lengthPt: mmToPt(metersToPaperMm(scaleBarLengthM, sheet.scaleDenominator)),
    xPt: titleBlock.middleColumnXPt,
    yPt: titleBlock.lowerBaselinePt,
    heightPt: mmToPt(1.6),
  };

  return {
    pageWidthPt,
    pageHeightPt,
    frame,
    drawing,
    drawingAreaM,
    drawingCenterM: contentBounds ? boundsCenterM(contentBounds) : { xM: 0, yM: 0 },
    titleBlock,
    scaleBar,
  };
}

/**
 * Splits a large extent into assembly tiles at the sheet's exact scale.
 * The overlap is expressed on paper, then converted to ground metres.
 */
export function computeTiledSheetLayouts(
  sheet: Sheet,
  contentBounds: BoundsM | null,
  overlapMm = 10,
): SheetLayout[] {
  const base = computeSheetLayout(sheet, contentBounds);
  if (!contentBounds) return [base];
  const overlapM = paperMmToMeters(Math.max(0, overlapMm), sheet.scaleDenominator);
  const stepX = Math.max(base.drawingAreaM.widthM * 0.1, base.drawingAreaM.widthM - overlapM);
  const stepY = Math.max(base.drawingAreaM.heightM * 0.1, base.drawingAreaM.heightM - overlapM);
  const width = Math.max(0, contentBounds.maxXM - contentBounds.minXM);
  const height = Math.max(0, contentBounds.maxYM - contentBounds.minYM);
  const columns = Math.max(1, Math.ceil(Math.max(0, width - overlapM) / stepX));
  const rows = Math.max(1, Math.ceil(Math.max(0, height - overlapM) / stepY));
  const layouts: SheetLayout[] = [];
  for (let row = 0; row < rows; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      layouts.push({
        ...base,
        drawingCenterM: {
          xM: contentBounds.minXM + base.drawingAreaM.widthM / 2 + column * stepX,
          yM: contentBounds.minYM + base.drawingAreaM.heightM / 2 + row * stepY,
        },
      });
    }
  }
  return layouts;
}

/** Default raster resolution for the drawing placed on the sheet. 150 dpi is the usual floor for a printed plan. */
export const DEFAULT_EXPORT_DPI = 150;

/**
 * Canvas dimensions are capped so an A0 sheet doesn't ask the browser for
 * a surface it will refuse to allocate — a failed `toDataURL` returns a
 * blank image rather than an error, which would silently produce an empty
 * plan. When the cap bites, the resolution drops and the caller is told,
 * instead of the export failing or lying.
 */
export const MAX_EXPORT_PIXELS = 40_000_000;

export interface PrintRaster {
  pixelWidth: number;
  pixelHeight: number;
  /** The resolution actually used, which is below the requested one when the pixel cap applied. */
  effectiveDpi: number;
  viewport: Viewport;
}

/**
 * Works out the pixel raster for a sheet's drawing area, and the
 * `Viewport` that makes the existing renderer draw the plan into it at
 * exactly the sheet's scale.
 *
 * This is the join between the two halves of the app: `rendering/` already
 * knows how to turn metres into pixels given a viewport, so printing
 * doesn't re-implement any drawing — it just hands that renderer a
 * viewport whose scale comes from paper rather than from the user's zoom.
 * One renderer, one source of truth for what a plan looks like.
 */
export function computePrintRaster(
  layout: SheetLayout,
  requestedDpi: number = DEFAULT_EXPORT_DPI,
): PrintRaster {
  const widthMm = ptToMm(layout.drawing.widthPt);
  const heightMm = ptToMm(layout.drawing.heightPt);

  const pixelsAtDpi = (dpi: number) => ({
    width: Math.max(1, Math.round((widthMm / MM_PER_INCH) * dpi)),
    height: Math.max(1, Math.round((heightMm / MM_PER_INCH) * dpi)),
  });

  let dpi = requestedDpi;
  let pixels = pixelsAtDpi(dpi);
  if (pixels.width * pixels.height > MAX_EXPORT_PIXELS) {
    dpi = dpi * Math.sqrt(MAX_EXPORT_PIXELS / (pixels.width * pixels.height));
    pixels = pixelsAtDpi(dpi);
  }

  // The drawing area shows exactly `drawingAreaM` metres across
  // `pixels.width` pixels; that ratio *is* the print scale expressed in
  // pixels. Zoom stays at 1 — zoom is a screen concept and has no meaning
  // on paper.
  const pixelsPerMeter =
    layout.drawingAreaM.widthM > 0 ? pixels.width / layout.drawingAreaM.widthM : 1;

  return {
    pixelWidth: pixels.width,
    pixelHeight: pixels.height,
    effectiveDpi: dpi,
    viewport: {
      basePixelsPerMeter: pixelsPerMeter,
      zoom: 1,
      // Put the plan's centre at the centre of the raster.
      offsetXPx: pixels.width / 2 - layout.drawingCenterM.xM * pixelsPerMeter,
      offsetYPx: pixels.height / 2 - layout.drawingCenterM.yM * pixelsPerMeter,
    },
  };
}

/**
 * The box the export dialog gives the print preview, in CSS pixels.
 *
 * Fixed rather than measured: the preview has to be laid out before it can
 * be measured, and a preview that reflows once on open is worse than one
 * sized from the paper it is showing.
 */
export const PREVIEW_BOX_PX = { widthPx: 620, heightPx: 320 };

/** Used only for a page with no size, which no paper in `PAPER_SIZES_MM` has. */
export const FALLBACK_PREVIEW_DPI = 8;

/**
 * The resolution at which a whole sheet fits inside the preview box.
 *
 * The preview used to render at a fixed 34 DPI and scroll whatever did not
 * fit, which for anything above A4 meant showing a corner of the page. A
 * print preview that crops the page answers the one question it exists to
 * answer — "what will come out of the printer" — with a guess.
 *
 * Derived from the paper, so A0 and A5 both come out whole.
 */
export function previewDpiToFit(
  layout: Pick<SheetLayout, "pageWidthPt" | "pageHeightPt">,
  box: { widthPx: number; heightPx: number } = PREVIEW_BOX_PX,
): number {
  if (layout.pageWidthPt <= 0 || layout.pageHeightPt <= 0) return FALLBACK_PREVIEW_DPI;
  // 72 pt to the inch, so DPI is just points-per-inch times the fit ratio.
  // Deliberately unclamped: a floor here would push the paper back out of
  // the box on the largest sizes, which is the bug this replaces.
  return Math.min(box.widthPx / layout.pageWidthPt, box.heightPx / layout.pageHeightPt) * 72;
}
