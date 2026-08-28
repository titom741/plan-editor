import { describe, expect, it } from "vitest";
import {
  addVector,
  computeRotationFromPointer,
  getCircleResizeHandleWorld,
  getRectangleResizeHandleWorld,
  getRotateHandleWorld,
  MIN_SIZE_M,
  normalizeAngleDeg,
  resizeCircleFromHandle,
  resizeRectangleFromCorner,
  rotateVector,
  subtractPoints,
  vectorLength,
  tangentPointsToCircleM,
} from "./geometry";

describe("tangentPointsToCircleM", () => {
  it("retourne deux points sur le cercle et perpendiculaires au rayon", () => {
    const points = tangentPointsToCircleM({ xM: 5, yM: 0 }, { xM: 0, yM: 0 }, 3);
    expect(points).toHaveLength(2);
    for (const point of points) {
      expect(Math.hypot(point.xM, point.yM)).toBeCloseTo(3, 8);
      expect(point.xM * (5 - point.xM) + point.yM * (0 - point.yM)).toBeCloseTo(0, 8);
    }
  });
});

describe("rotateVector", () => {
  it("leaves a vector unchanged at 0deg", () => {
    const v = rotateVector({ xM: 3, yM: 4 }, 0);
    expect(v.xM).toBeCloseTo(3, 9);
    expect(v.yM).toBeCloseTo(4, 9);
  });

  it("rotates (1, 0) to (0, 1) at 90deg clockwise (Y-down convention)", () => {
    const v = rotateVector({ xM: 1, yM: 0 }, 90);
    expect(v.xM).toBeCloseTo(0, 9);
    expect(v.yM).toBeCloseTo(1, 9);
  });

  it("is the inverse of itself when negated", () => {
    const original = { xM: 5.5, yM: -2.3 };
    const roundTripped = rotateVector(rotateVector(original, 37), -37);
    expect(roundTripped.xM).toBeCloseTo(original.xM, 9);
    expect(roundTripped.yM).toBeCloseTo(original.yM, 9);
  });

  it("preserves vector length under rotation", () => {
    const original = { xM: 7, yM: -4 };
    const rotated = rotateVector(original, 123);
    expect(vectorLength(rotated)).toBeCloseTo(vectorLength(original), 9);
  });
});

describe("normalizeAngleDeg", () => {
  it("wraps negative angles into [0, 360)", () => {
    expect(normalizeAngleDeg(-90)).toBeCloseTo(270, 9);
    expect(normalizeAngleDeg(-360)).toBeCloseTo(0, 9);
  });

  it("wraps angles above 360 back down", () => {
    expect(normalizeAngleDeg(450)).toBeCloseTo(90, 9);
  });

  it("leaves in-range angles unchanged", () => {
    expect(normalizeAngleDeg(180)).toBeCloseTo(180, 9);
  });
});

describe("addVector / subtractPoints", () => {
  it("round-trips add then subtract", () => {
    const point = { xM: 10, yM: 20 };
    const vector = { xM: -3, yM: 7 };
    const moved = addVector(point, vector);
    expect(subtractPoints(moved, point)).toEqual(vector);
  });
});

describe("resizeRectangleFromCorner", () => {
  const rect = { xM: 10, yM: 10, rotationDeg: 0 };

  it("derives width/height from the pointer position relative to the anchor, unrotated", () => {
    const result = resizeRectangleFromCorner(rect, { xM: 22.4, yM: 16.1 });
    expect(result.widthM).toBeCloseTo(12.4, 9);
    expect(result.heightM).toBeCloseTo(6.1, 9);
  });

  it("matches the mission's example: 10x5 resized to 12.4x6.1", () => {
    const result = resizeRectangleFromCorner(
      { xM: 10, yM: 10, rotationDeg: 0 },
      { xM: 22.4, yM: 16.1 },
    );
    expect(result.widthM).toBeCloseTo(12.4, 6);
    expect(result.heightM).toBeCloseTo(6.1, 6);
  });

  it("clamps to a minimum size instead of going to zero or negative", () => {
    const result = resizeRectangleFromCorner(rect, { xM: 10, yM: 10 });
    expect(result.widthM).toBeGreaterThan(0);
    expect(result.heightM).toBeGreaterThan(0);
    const shrunk = resizeRectangleFromCorner(rect, { xM: 5, yM: 5 });
    expect(shrunk.widthM).toBeGreaterThan(0);
    expect(shrunk.heightM).toBeGreaterThan(0);
  });

  it("accounts for rotation — the pointer is un-rotated into the rectangle's local frame", () => {
    const rotated = { xM: 0, yM: 0, rotationDeg: 90 };
    // A rectangle rotated 90deg clockwise with local width axis pointing
    // straight down in world space: dragging the pointer to world (0, 10)
    // should read as 10m along the (rotated) width axis.
    const result = resizeRectangleFromCorner(rotated, { xM: 0, yM: 10 });
    expect(result.widthM).toBeCloseTo(10, 6);
    expect(result.heightM).toBeCloseTo(MIN_SIZE_M, 6);
  });

  it("round-trips with getRectangleResizeHandleWorld: resizing to match the current handle position is a no-op", () => {
    const object = { xM: 3, yM: -2, widthM: 8, heightM: 4.5, rotationDeg: 35 };
    const handle = getRectangleResizeHandleWorld(object);
    const result = resizeRectangleFromCorner(object, handle);
    expect(result.widthM).toBeCloseTo(object.widthM, 6);
    expect(result.heightM).toBeCloseTo(object.heightM, 6);
  });
});

describe("resizeCircleFromHandle", () => {
  it("computes the radius as the distance from center to pointer", () => {
    const circle = { xM: 5, yM: 5 };
    const result = resizeCircleFromHandle(circle, { xM: 8, yM: 9 });
    expect(result.radiusM).toBeCloseTo(5, 9); // 3-4-5 triangle
  });

  it("round-trips with getCircleResizeHandleWorld", () => {
    const circle = { xM: 1, yM: 1, radiusM: 3.7 };
    const handle = getCircleResizeHandleWorld(circle);
    const result = resizeCircleFromHandle(circle, handle);
    expect(result.radiusM).toBeCloseTo(circle.radiusM, 9);
  });

  it("never returns zero, even when the pointer lands exactly on center", () => {
    const result = resizeCircleFromHandle({ xM: 0, yM: 0 }, { xM: 0, yM: 0 });
    expect(result.radiusM).toBeGreaterThan(0);
  });
});

describe("computeRotationFromPointer", () => {
  const pivot = { xM: 0, yM: 0 };

  it("returns 0deg when the pointer is directly above the pivot", () => {
    expect(computeRotationFromPointer(pivot, { xM: 0, yM: -10 })).toBeCloseTo(0, 6);
  });

  it("returns 90deg when the pointer is directly to the right", () => {
    expect(computeRotationFromPointer(pivot, { xM: 10, yM: 0 })).toBeCloseTo(90, 6);
  });

  it("returns 180deg when the pointer is directly below", () => {
    expect(computeRotationFromPointer(pivot, { xM: 0, yM: 10 })).toBeCloseTo(180, 6);
  });

  it("returns 270deg when the pointer is directly to the left", () => {
    expect(computeRotationFromPointer(pivot, { xM: -10, yM: 0 })).toBeCloseTo(270, 6);
  });

  it("round-trips with getRotateHandleWorld", () => {
    const gapM = 0.8;
    for (const rotationDeg of [0, 45, 90, 137, 270, 359]) {
      const handle = getRotateHandleWorld(pivot, rotationDeg, gapM);
      const result = computeRotationFromPointer(pivot, handle);
      expect(result).toBeCloseTo(rotationDeg, 5);
    }
  });
});
