import { resizeRectangleFromCorner } from "./geometry";
import { createId } from "./ids";
import type { BackgroundImage, Calibration, PointM } from "./types";

export interface CreateBackgroundImageInput {
  /** Usually the imported file's name — what the layers bar will call it. */
  name?: string;
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
    name: input.name?.trim() || "Fond de plan",
    url: input.url,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    xM: input.xM,
    yM: input.yM,
    widthM: input.widthM,
    heightM: input.heightM,
    rotationDeg: 0,
    opacity: input.opacity ?? 1,
    brightness: 0,
    contrast: 0,
    grayscale: false,
    whiteRemoval: false,
    whiteThreshold: 245,
    visible: true,
    // A reference plan should stay put once imported. Users can explicitly
    // unlock it from the layers bar when it really needs repositioning.
    locked: true,
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
  background: Pick<BackgroundImage, "xM" | "yM" | "widthPx" | "heightPx"> &
    Partial<Pick<BackgroundImage, "rotationDeg" | "crop">>,
  pointerWorld: PointM,
): { widthM: number; heightM: number } {
  const rotationDeg =
    "rotationDeg" in background && typeof background.rotationDeg === "number"
      ? background.rotationDeg
      : 0;
  const { widthM } = resizeRectangleFromCorner(
    { xM: background.xM, yM: background.yM, rotationDeg },
    pointerWorld,
  );
  return resizeBackgroundFromWidth(background, widthM);
}

/** Recomputes `heightM` from a new `widthM`, preserving aspect ratio — the properties-panel counterpart to dragging the corner handle. */
export function resizeBackgroundFromWidth(
  background: Pick<BackgroundImage, "widthPx" | "heightPx"> &
    Partial<Pick<BackgroundImage, "crop">>,
  widthM: number,
): { widthM: number; heightM: number } {
  const crop = getBackgroundCrop(background);
  const aspectRatio = crop.heightPx / crop.widthPx;
  return { widthM, heightM: widthM * aspectRatio };
}

/** Recomputes `widthM` from a new `heightM`, preserving aspect ratio — the properties-panel counterpart to dragging the corner handle. */
export function resizeBackgroundFromHeight(
  background: Pick<BackgroundImage, "widthPx" | "heightPx"> &
    Partial<Pick<BackgroundImage, "crop">>,
  heightM: number,
): { widthM: number; heightM: number } {
  const crop = getBackgroundCrop(background);
  const aspectRatio = crop.heightPx / crop.widthPx;
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
  background: Pick<BackgroundImage, "widthPx" | "heightPx" | "crop">,
  calibration: Pick<Calibration, "pixelsPerMeter">,
): { widthM: number; heightM: number } {
  return {
    widthM: (background.crop?.widthPx ?? background.widthPx) / calibration.pixelsPerMeter,
    heightM: (background.crop?.heightPx ?? background.heightPx) / calibration.pixelsPerMeter,
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
  background: Pick<BackgroundImage, "widthPx" | "widthM" | "crop">,
  worldDistanceM: number,
): number {
  const visibleWidthPx = background.crop?.widthPx ?? background.widthPx;
  return worldDistanceM * (visibleWidthPx / background.widthM);
}

export interface CropMarginsPercent {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

export function cropRectFromMargins(
  widthPx: number,
  heightPx: number,
  requested: CropMarginsPercent,
) {
  const clampMargin = (value: number) => Math.max(0, Math.min(95, value));
  const left = clampMargin(requested.left);
  let right = clampMargin(requested.right);
  const top = clampMargin(requested.top);
  let bottom = clampMargin(requested.bottom);
  if (left + right > 99) right = 99 - left;
  if (top + bottom > 99) bottom = 99 - top;
  return {
    xPx: (left / 100) * widthPx,
    yPx: (top / 100) * heightPx,
    widthPx: ((100 - left - right) / 100) * widthPx,
    heightPx: ((100 - top - bottom) / 100) * heightPx,
  };
}

export function getBackgroundCrop(
  background: Pick<BackgroundImage, "widthPx" | "heightPx" | "crop">,
) {
  return (
    background.crop ?? {
      xPx: 0,
      yPx: 0,
      widthPx: background.widthPx,
      heightPx: background.heightPx,
    }
  );
}

export function getBackgroundCropMargins(
  background: Pick<BackgroundImage, "widthPx" | "heightPx" | "crop">,
): CropMarginsPercent {
  const crop = getBackgroundCrop(background);
  return {
    left: (crop.xPx / background.widthPx) * 100,
    top: (crop.yPx / background.heightPx) * 100,
    right: ((background.widthPx - crop.xPx - crop.widthPx) / background.widthPx) * 100,
    bottom: ((background.heightPx - crop.yPx - crop.heightPx) / background.heightPx) * 100,
  };
}

/** Recrops while keeping the remaining source pixels at the exact same world scale and location. */
export function cropBackgroundByMargins(
  background: BackgroundImage,
  requested: CropMarginsPercent,
): Partial<BackgroundImage> {
  const oldCrop = getBackgroundCrop(background);
  const crop = cropRectFromMargins(background.widthPx, background.heightPx, requested);
  const metersPerPixel = background.widthM / oldCrop.widthPx;
  const localShift = {
    xM: (crop.xPx - oldCrop.xPx) * metersPerPixel,
    yM: (crop.yPx - oldCrop.yPx) * metersPerPixel,
  };
  const angle = (background.rotationDeg * Math.PI) / 180;
  const worldShift = {
    xM: localShift.xM * Math.cos(angle) - localShift.yM * Math.sin(angle),
    yM: localShift.xM * Math.sin(angle) + localShift.yM * Math.cos(angle),
  };
  return {
    crop,
    xM: background.xM + worldShift.xM,
    yM: background.yM + worldShift.yM,
    widthM: crop.widthPx * metersPerPixel,
    heightM: crop.heightPx * metersPerPixel,
  };
}
