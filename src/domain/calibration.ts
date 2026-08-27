import type { Calibration } from "./types";

/**
 * Assumed image-pixels-per-meter until a background is actually calibrated
 * — a placeholder that makes a freshly-imported plan land at a plausible
 * size (see `computeDefaultBackgroundPlacement`), nothing more. Not a
 * screen scale: that's `DEFAULT_SCREEN_PIXELS_PER_METER` in
 * `rendering/viewport.ts`, and the two are independent even though both
 * happen to be 20.
 */
export const DEFAULT_PIXELS_PER_METER = 20;

export function createDefaultCalibration(): Calibration {
  return {
    pixelsPerMeter: DEFAULT_PIXELS_PER_METER,
    source: { type: "default" },
  };
}

/**
 * Derives a calibration from a segment measured on the background image
 * (`pixelDistance`, expressed in the image's own native pixel resolution —
 * stable regardless of zoom, unlike a screen-pixel measurement) and the
 * real-world distance the user says that segment spans. This is what
 * `pixelsPerMeter` means from this point on: how many of the background's
 * own image pixels make up one meter — see `resizeBackgroundToCalibration`
 * in `domain/background.ts`, which uses it to recompute the background's
 * true `widthM`/`heightM` from its native `widthPx`/`heightPx`.
 */
export function calibrationFromKnownDistance(pixelDistance: number, realDistanceM: number): Calibration {
  return {
    pixelsPerMeter: pixelDistance / realDistanceM,
    source: { type: "knownDistance", pixelDistance, realDistanceM },
  };
}
