import { describe, expect, it } from "vitest";
import { calibrationFromKnownDistance, createDefaultCalibration, DEFAULT_PIXELS_PER_METER } from "./calibration";

describe("createDefaultCalibration", () => {
  it("returns the default pixelsPerMeter with a 'default' source", () => {
    const calibration = createDefaultCalibration();
    expect(calibration.pixelsPerMeter).toBe(DEFAULT_PIXELS_PER_METER);
    expect(calibration.source).toEqual({ type: "default" });
  });
});

describe("calibrationFromKnownDistance", () => {
  it("derives pixelsPerMeter from a measured pixel distance and a real-world distance", () => {
    const calibration = calibrationFromKnownDistance(500, 5);
    expect(calibration.pixelsPerMeter).toBe(100);
  });

  it("records the source as knownDistance with the inputs it was derived from", () => {
    const calibration = calibrationFromKnownDistance(240, 12);
    expect(calibration.source).toEqual({ type: "knownDistance", pixelDistance: 240, realDistanceM: 12 });
  });

  it("scales inversely with the real-world distance", () => {
    const near = calibrationFromKnownDistance(300, 3);
    const far = calibrationFromKnownDistance(300, 30);
    expect(near.pixelsPerMeter).toBeCloseTo(far.pixelsPerMeter * 10, 9);
  });
});
