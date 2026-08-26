import type { Calibration } from "./types";

/**
 * Sensible default used until a project's background is calibrated against
 * a known real-world distance or scale. Arbitrary but reasonable for
 * on-screen editing before any calibration has happened.
 */
export const DEFAULT_PIXELS_PER_METER = 20;

export function createDefaultCalibration(): Calibration {
  return {
    pixelsPerMeter: DEFAULT_PIXELS_PER_METER,
    source: { type: "default" },
  };
}
