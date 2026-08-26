import { describe, expect, it } from "vitest";
import {
  createViewport,
  metersToPixels,
  panViewport,
  pixelsToMeters,
  screenToWorld,
  worldToScreen,
  zoomViewportAt,
} from "./viewport";

const EPSILON = 1e-9;

describe("metersToPixels / pixelsToMeters", () => {
  it("converts meters to pixels using the effective scale", () => {
    const viewport = createViewport(20); // 20 px/m, zoom = 1
    expect(metersToPixels(10, viewport)).toBe(200);
  });

  it("is the inverse of pixelsToMeters within tolerance", () => {
    const viewport = createViewport(37.5);
    for (const meters of [0, 1, 10.5, 250, -12.3]) {
      const pixels = metersToPixels(meters, viewport);
      expect(pixelsToMeters(pixels, viewport)).toBeCloseTo(meters, 9);
    }
  });

  it("scales with zoom", () => {
    const viewport = { ...createViewport(20), zoom: 2 };
    expect(metersToPixels(10, viewport)).toBe(400);
  });
});

describe("worldToScreen / screenToWorld", () => {
  it("round-trips through both directions with a pan and zoom applied", () => {
    let viewport = createViewport(20);
    viewport = zoomViewportAt(viewport, { x: 100, y: 100 }, 2.3);
    viewport = panViewport(viewport, -37, 84);

    const worldPoints = [
      { xM: 0, yM: 0 },
      { xM: 12.34, yM: -5.6 },
      { xM: -100, yM: 250.25 },
    ];

    for (const world of worldPoints) {
      const screen = worldToScreen(world, viewport);
      const roundTripped = screenToWorld(screen, viewport);
      expect(roundTripped.xM).toBeCloseTo(world.xM, 6);
      expect(roundTripped.yM).toBeCloseTo(world.yM, 6);
    }
  });

  it("places the world origin at the viewport offset", () => {
    const viewport = { ...createViewport(20), offsetXPx: 50, offsetYPx: 75 };
    const screen = worldToScreen({ xM: 0, yM: 0 }, viewport);
    expect(screen).toEqual({ x: 50, y: 75 });
  });
});

describe("zoomViewportAt", () => {
  it("keeps the world point under the cursor fixed on screen", () => {
    const viewport = createViewport(20);
    const cursor = { x: 300, y: 200 };
    const worldUnderCursorBefore = screenToWorld(cursor, viewport);

    const zoomed = zoomViewportAt(viewport, cursor, 3);
    const worldUnderCursorAfter = screenToWorld(cursor, zoomed);

    expect(worldUnderCursorAfter.xM).toBeCloseTo(worldUnderCursorBefore.xM, 9);
    expect(worldUnderCursorAfter.yM).toBeCloseTo(worldUnderCursorBefore.yM, 9);
  });

  it("clamps zoom to the configured min/max", () => {
    const viewport = createViewport(20);
    const zoomedOut = zoomViewportAt(viewport, { x: 0, y: 0 }, 0.0001, { minZoom: 0.1, maxZoom: 10 });
    expect(zoomedOut.zoom).toBeGreaterThanOrEqual(0.1 - EPSILON);

    const zoomedIn = zoomViewportAt(viewport, { x: 0, y: 0 }, 10000, { minZoom: 0.1, maxZoom: 10 });
    expect(zoomedIn.zoom).toBeLessThanOrEqual(10 + EPSILON);
  });
});
