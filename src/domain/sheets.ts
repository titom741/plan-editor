import { createId } from "./ids";
import type { Orientation, PaperSize, Sheet } from "./types";

/**
 * Paper, scale, and the arithmetic that connects the two.
 *
 * Pure domain: millimetres and metres, no pixels, no PDF, no DOM. The
 * printing layer turns these millimetres into PDF points; nothing here
 * knows that PDFs exist.
 */

/** ISO 216 sizes in millimetres, portrait (width × height). */
export const PAPER_SIZES_MM: Record<PaperSize, { widthMm: number; heightMm: number }> = {
  A4: { widthMm: 210, heightMm: 297 },
  A3: { widthMm: 297, heightMm: 420 },
  A2: { widthMm: 420, heightMm: 594 },
  A1: { widthMm: 594, heightMm: 841 },
  A0: { widthMm: 841, heightMm: 1189 },
};

export const PAPER_SIZE_ORDER: PaperSize[] = ["A4", "A3", "A2", "A1", "A0"];

/**
 * The scales offered to the user, smallest denominator (most detail)
 * first. A ladder of conventional values rather than a free number: a plan
 * marked 1:137 is one nobody can check with a ruler, and rounding to a
 * standard scale is what makes a printed plan usable on site.
 */
export const STANDARD_SCALE_DENOMINATORS = [
  20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000,
] as const;

export const DEFAULT_MARGIN_MM = 10;

export function createSheet(input?: Partial<Omit<Sheet, "id">>): Sheet {
  return {
    id: createId("sheet"),
    name: input?.name ?? "Planche 1",
    paperSize: input?.paperSize ?? "A3",
    orientation: input?.orientation ?? "landscape",
    scaleDenominator: input?.scaleDenominator ?? 200,
    marginMm: input?.marginMm ?? DEFAULT_MARGIN_MM,
    titleBlock: input?.titleBlock,
  };
}

/** The sheet's outer dimensions in millimetres, with orientation applied. */
export function getPaperSizeMm(sheet: Pick<Sheet, "paperSize" | "orientation">): {
  widthMm: number;
  heightMm: number;
} {
  const { widthMm, heightMm } = PAPER_SIZES_MM[sheet.paperSize];
  return sheet.orientation === "landscape"
    ? { widthMm: heightMm, heightMm: widthMm }
    : { widthMm, heightMm };
}

/**
 * The area the drawing may occupy: the paper minus the margin on all four
 * sides. Clamped at zero so an absurd margin yields an empty area rather
 * than a negative one that would silently mirror the plan downstream.
 */
export function getPrintableAreaMm(sheet: Pick<Sheet, "paperSize" | "orientation" | "marginMm">): {
  widthMm: number;
  heightMm: number;
} {
  const paper = getPaperSizeMm(sheet);
  return {
    widthMm: Math.max(0, paper.widthMm - 2 * sheet.marginMm),
    heightMm: Math.max(0, paper.heightMm - 2 * sheet.marginMm),
  };
}

/** Millimetres on paper for a real-world distance, at the sheet's scale. The definition of 1:S. */
export function metersToPaperMm(meters: number, scaleDenominator: number): number {
  return (meters * 1000) / scaleDenominator;
}

/** The inverse: what a distance measured on the printed page means on the ground. */
export function paperMmToMeters(mm: number, scaleDenominator: number): number {
  return (mm * scaleDenominator) / 1000;
}

/** How much ground the printable area covers at the sheet's scale — the number that tells a user whether their plan will fit. */
export function getCoveredAreaM(
  sheet: Pick<Sheet, "paperSize" | "orientation" | "marginMm" | "scaleDenominator">,
): {
  widthM: number;
  heightM: number;
} {
  const printable = getPrintableAreaMm(sheet);
  return {
    widthM: paperMmToMeters(printable.widthMm, sheet.scaleDenominator),
    heightM: paperMmToMeters(printable.heightMm, sheet.scaleDenominator),
  };
}

/**
 * The smallest standard scale that fits `contentM` inside the sheet's
 * printable area — "smallest" meaning the least zoomed-out, i.e. the most
 * detail that still fits.
 *
 * Rounding *up* the ladder is deliberate: picking the exact required
 * denominator would fit the content to the millimetre, leaving a plan that
 * touches the margin and a scale nobody can read off a ruler. Returns the
 * largest available scale when even that is too small, since refusing to
 * choose would leave the caller with nothing to offer.
 */
export function fitScaleDenominator(
  contentM: { widthM: number; heightM: number },
  sheet: Pick<Sheet, "paperSize" | "orientation" | "marginMm">,
): number {
  const printable = getPrintableAreaMm(sheet);
  const finest: number = STANDARD_SCALE_DENOMINATORS[0];
  const largest: number =
    STANDARD_SCALE_DENOMINATORS[STANDARD_SCALE_DENOMINATORS.length - 1] ?? finest;
  if (printable.widthMm <= 0 || printable.heightMm <= 0) return largest;

  // Empty content: nothing to fit, so keep the most detailed scale.
  if (contentM.widthM <= 0 && contentM.heightM <= 0) return finest;

  const required = Math.max(
    (contentM.widthM * 1000) / printable.widthMm,
    (contentM.heightM * 1000) / printable.heightMm,
  );
  return STANDARD_SCALE_DENOMINATORS.find((denominator) => denominator >= required) ?? largest;
}

/** Formats a scale for display — the form that goes on the sheet and in the UI. */
export function formatScale(scaleDenominator: number): string {
  return `1:${scaleDenominator}`;
}

export function formatPaper(sheet: Pick<Sheet, "paperSize" | "orientation">): string {
  return `${sheet.paperSize} ${sheet.orientation === "landscape" ? "paysage" : "portrait"}`;
}

export const ORIENTATIONS: Orientation[] = ["landscape", "portrait"];

/** The range a hand-typed scale is held to. 1:1 is a floor plan at life size; past 1:20000 a site is a dot. */
export const MIN_SCALE_DENOMINATOR = 1;
export const MAX_SCALE_DENOMINATOR = 20000;

/** Holds a typed denominator inside the usable range, and to whole numbers — 1:137.4 is not a scale anyone writes. */
export function clampScaleDenominator(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < MIN_SCALE_DENOMINATOR) return MIN_SCALE_DENOMINATOR;
  if (rounded > MAX_SCALE_DENOMINATOR) return MAX_SCALE_DENOMINATOR;
  return rounded;
}

/**
 * The scale at which the plan fills the sheet — the largest it can be
 * printed without running off the paper.
 *
 * `fitScaleDenominator` rounds *up* the standard ladder, which is right
 * when the number has to be readable off a ruler and wrong when the point
 * is to use the whole page: at 1:200 instead of the 1:137 the content
 * actually needs, a third of the paper stays white. Both exist, and the
 * dialog offers both, because they answer different questions.
 *
 * Rounded up to a whole number so the content still clears the margin —
 * rounding down would push it just past the edge.
 */
export function exactFitScaleDenominator(
  contentM: { widthM: number; heightM: number },
  sheet: Pick<Sheet, "paperSize" | "orientation" | "marginMm">,
): number | null {
  const printable = getPrintableAreaMm(sheet);
  if (printable.widthMm <= 0 || printable.heightMm <= 0) return null;
  if (contentM.widthM <= 0 && contentM.heightM <= 0) return null;

  const required = Math.max(
    (contentM.widthM * 1000) / printable.widthMm,
    (contentM.heightM * 1000) / printable.heightMm,
  );
  return clampScaleDenominator(Math.ceil(required));
}
