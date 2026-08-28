import { describe, expect, it } from "vitest";
import {
  computeDefaultBackgroundPlacement,
  createBackgroundImage,
  resizeBackgroundFromCorner,
  resizeBackgroundFromHeight,
  resizeBackgroundToCalibration,
  worldDistanceToImagePixels,
  cropBackgroundByMargins,
  getBackgroundCropMargins,
} from "./background";

describe("createBackgroundImage", () => {
  it("creates a visible, locked reference background with a stable id", () => {
    const bg = createBackgroundImage({
      url: "data:image/png;base64,xyz",
      widthPx: 2000,
      heightPx: 1000,
      xM: 0,
      yM: 0,
      widthM: 40,
      heightM: 20,
    });
    expect(bg.id).toBeTruthy();
    expect(bg.kind).toBe("image");
    expect(bg.visible).toBe(true);
    expect(bg.locked).toBe(true);
    expect(bg.opacity).toBe(1);
    expect(bg.rotationDeg).toBe(0);
    expect(bg.brightness).toBe(0);
    expect(bg.contrast).toBe(0);
    expect(bg.grayscale).toBe(false);
    expect(bg.widthM).toBe(40);
    expect(bg.heightM).toBe(20);
  });

  it("accepts an explicit opacity", () => {
    const bg = createBackgroundImage({
      url: "data:image/png;base64,xyz",
      widthPx: 100,
      heightPx: 100,
      xM: 0,
      yM: 0,
      widthM: 1,
      heightM: 1,
      opacity: 0.5,
    });
    expect(bg.opacity).toBe(0.5);
  });
});

describe("recadrage", () => {
  it("conserve l'échelle des pixels restants et déplace l'ancre", () => {
    const background = createBackgroundImage({
      url: "data:,",
      widthPx: 1000,
      heightPx: 500,
      xM: 10,
      yM: 20,
      widthM: 100,
      heightM: 50,
    });
    const patch = cropBackgroundByMargins(background, { left: 10, top: 20, right: 10, bottom: 20 });
    expect(patch.xM).toBeCloseTo(20, 9);
    expect(patch.yM).toBeCloseTo(30, 9);
    expect(patch.widthM).toBeCloseTo(80, 9);
    expect(patch.heightM).toBeCloseTo(30, 9);
    expect(getBackgroundCropMargins({ ...background, ...patch })).toEqual({
      left: 10,
      top: 20,
      right: 10,
      bottom: 20,
    });
  });
});

describe("computeDefaultBackgroundPlacement", () => {
  it("centers the image on centerWorld and sizes it from pixelsPerMeter", () => {
    const placement = computeDefaultBackgroundPlacement(2000, 1000, 20, { xM: 100, yM: 50 });
    expect(placement.widthM).toBe(100); // 2000px / 20px per m
    expect(placement.heightM).toBe(50); // 1000px / 20px per m
    expect(placement.xM).toBe(100 - 50); // centered: centerX - width/2
    expect(placement.yM).toBe(50 - 25); // centered: centerY - height/2
  });
});

describe("resizeBackgroundFromCorner", () => {
  const background = { xM: 10, yM: 10, widthPx: 2000, heightPx: 1000 }; // 2:1 aspect ratio

  it("preserves the source image's aspect ratio", () => {
    const result = resizeBackgroundFromCorner(background, {
      xM: 60,
      yM: 999 /* ignored: only horizontal distance drives scale */,
    });
    expect(result.widthM).toBeCloseTo(50, 9);
    expect(result.heightM).toBeCloseTo(25, 9); // half of width, matching the 2:1 source aspect ratio
  });

  it("never distorts the image regardless of vertical drag distance", () => {
    const a = resizeBackgroundFromCorner(background, { xM: 30, yM: 15 });
    const b = resizeBackgroundFromCorner(background, { xM: 30, yM: 500 });
    expect(a).toEqual(b);
  });
});

describe("resizeBackgroundFromHeight", () => {
  it("derives width from height using the source aspect ratio", () => {
    const background = { widthPx: 2000, heightPx: 1000 }; // 2:1
    const result = resizeBackgroundFromHeight(background, 30);
    expect(result.heightM).toBe(30);
    expect(result.widthM).toBeCloseTo(60, 9);
  });

  it("round-trips with resizeBackgroundFromCorner's aspect ratio", () => {
    const background = { xM: 0, yM: 0, widthPx: 1500, heightPx: 900 };
    const fromCorner = resizeBackgroundFromCorner(background, { xM: 45, yM: 0 });
    const fromHeight = resizeBackgroundFromHeight(background, fromCorner.heightM);
    expect(fromHeight.widthM).toBeCloseTo(fromCorner.widthM, 9);
  });
});

describe("resizeBackgroundToCalibration", () => {
  it("derives widthM/heightM from native pixel resolution and pixelsPerMeter", () => {
    const background = { widthPx: 2000, heightPx: 1000 };
    const result = resizeBackgroundToCalibration(background, { pixelsPerMeter: 100 });
    expect(result.widthM).toBeCloseTo(20, 9);
    expect(result.heightM).toBeCloseTo(10, 9);
  });

  it("preserves aspect ratio for any pixelsPerMeter", () => {
    const background = { widthPx: 1500, heightPx: 900 }; // 5:3
    const result = resizeBackgroundToCalibration(background, { pixelsPerMeter: 37 });
    expect(result.widthM / result.heightM).toBeCloseTo(1500 / 900, 9);
  });
});

describe("worldDistanceToImagePixels", () => {
  it("converts using the background's current px-per-world-unit ratio", () => {
    // 2000px-wide image currently placed at 40m wide → 50 image px per world meter.
    const background = { widthPx: 2000, widthM: 40 };
    expect(worldDistanceToImagePixels(background, 10)).toBeCloseTo(500, 9);
  });

  it("scales linearly with the measured world distance", () => {
    const background = { widthPx: 1000, widthM: 20 }; // 50 px/m
    expect(worldDistanceToImagePixels(background, 1)).toBeCloseTo(50, 9);
    expect(worldDistanceToImagePixels(background, 4)).toBeCloseTo(200, 9);
  });
});
