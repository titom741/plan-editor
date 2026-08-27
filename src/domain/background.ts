import { resizeRectangleFromCorner } from "./geometry";
import { createId } from "./ids";
import type { BackgroundImage, Calibration, PointM } from "./types";

export interface CreateBackgroundImageInput {
  url: string;
  widthPx: number;
  heightPx: number;
  xM: number;
  yM: number;
  widthM: number;
  heightM: number;
  opacity?: number;
}

export function createBackgroundImage(input: CreateBackgroundImageInput): BackgroundImage {
  return {
    id: createId("background"),
    kind: "image",
    url: input.url,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    xM: input.xM,
    yM: input.yM,
    widthM: input.widthM,
    heightM: input.heightM,
    opacity: input.opacity ?? 1,
    visible: true,
    locked: false,
  };
}

/**
 * A first-guess placement/size for a freshly-imported background image:
 * anchored so it's centered on `centerWorld` (typically the viewport's
 * current center, so the image lands somewhere visible right away) and
 * sized using `pixelsPerMeter` as a naive scale. This is deliberately not
 * "calibration" — it just needs to look reasonable on import; getting the
 * real-world size *right* is what interactive calibration (KL-005) is
 * for. Until then, the size is a manual, drag-to-adjust approximation
 * (see `resizeBackgroundFromCorner`).
 */
export function computeDefaultBackgroundPlacement(
  widthPx: number,
  heightPx: number,
  pixelsPerMeter: number,
  centerWorld: PointM,
): { xM: number; yM: number; widthM: number; heightM: number } {
  const widthM = widthPx / pixelsPerMeter;
  const heightM = heightPx / pixelsPerMeter;
  return {
    xM: centerWorld.xM - widthM / 2,
    yM: centerWorld.yM - heightM / 2,
    widthM,
    heightM,
  };
}

/**
 * Resizes a background by dragging its bottom-right corner, like
 * `resizeRectangleFromCorner` — except a background's `heightM` is always
 * derived from the new `widthM` via the source image's native aspect
 * ratio (`heightPx / widthPx`), never set independently. Unlike a
 * rectangle object, a background is a photograph or scan of something
 * real: stretching it non-uniformly would distort it and make any later
 * calibration meaningless, so only uniform scaling is offered.
 */
export function resizeBackgroundFromCorner(
  background: Pick<BackgroundImage, "xM" | "yM" | "widthPx" | "heightPx">,
  pointerWorld: PointM,
): { widthM: number; heightM: number } {
  const { widthM } = resizeRectangleFromCorner({ xM: background.xM, yM: background.yM, rotationDeg: 0 }, pointerWorld);
  return resizeBackgroundFromWidth(background, widthM);
}

/** Recomputes `heightM` from a new `widthM`, preserving aspect ratio — the properties-panel counterpart to dragging the corner handle. */
export function resizeBackgroundFromWidth(
  background: Pick<BackgroundImage, "widthPx" | "heightPx">,
  widthM: number,
): { widthM: number; heightM: number } {
  const aspectRatio = background.heightPx / background.widthPx;
  return { widthM, heightM: widthM * aspectRatio };
}

/** Recomputes `widthM` from a new `heightM`, preserving aspect ratio — the properties-panel counterpart to dragging the corner handle. */
export function resizeBackgroundFromHeight(
  background: Pick<BackgroundImage, "widthPx" | "heightPx">,
  heightM: number,
): { widthM: number; heightM: number } {
  const aspectRatio = background.heightPx / background.widthPx;
  return { widthM: heightM / aspectRatio, heightM };
}

/**
 * Recomputes a background's true `widthM`/`heightM` from its native pixel
 * resolution and a calibration's `pixelsPerMeter` — the interactive-
 * calibration counterpart to `computeDefaultBackgroundPlacement`'s initial
 * guess (KL-005), now driven by an actual measured distance instead of
 * the project's default scale. The anchor (`xM`/`yM`, top-left) never
 * moves — only the size changes, exactly like every other background
 * resize in this app — and the aspect ratio is preserved by construction,
 * since both dimensions are derived from the same `pixelsPerMeter`.
 */
export function resizeBackgroundToCalibration(
  background: Pick<BackgroundImage, "widthPx" | "heightPx">,
  calibration: Pick<Calibration, "pixelsPerMeter">,
): { widthM: number; heightM: number } {
  return {
    widthM: background.widthPx / calibration.pixelsPerMeter,
    heightM: background.heightPx / calibration.pixelsPerMeter,
  };
}

/**
 * Converts a distance measured in world meters — using the background's
 * *current*, possibly still-approximate placement — into a distance in
 * the source image's own native pixels, the unit `Calibration.pixelsPerMeter`
 * is expressed in (see `domain/calibration.ts`). Used by the calibration
 * flow: the user picks two points on the rendered background and we
 * measure how far apart they are at the current (possibly wrong) scale,
 * then translate that into "how many image pixels is this" so the
 * measurement stays meaningful even though the on-screen size it was
 * taken from is about to be corrected. Assumes uniform scaling, which
 * always holds here since a background's aspect ratio is never
 * independently stretched (see `resizeBackgroundFromCorner`).
 */
export function worldDistanceToImagePixels(
  background: Pick<BackgroundImage, "widthPx" | "widthM">,
  worldDistanceM: number,
): number {
  return worldDistanceM * (background.widthPx / background.widthM);
}
