import { describe, expect, it } from "vitest";
import {
  createViewport,
  constrainViewportToBounds,
  fitViewportToBounds,
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

describe("navigation bornée", () => {
  const bounds = { minXM: 10, minYM: 20, maxXM: 110, maxYM: 70 };
  const size = { widthPx: 800, heightPx: 600 };

  it("empêche un plan plus grand que l'écran de disparaître", () => {
    const viewport = { ...createViewport(20), offsetXPx: 5000, offsetYPx: -5000 };
    const constrained = constrainViewportToBounds(viewport, bounds, size);
    expect(worldToScreen({ xM: bounds.minXM, yM: bounds.minYM }, constrained).x).toBe(24);
    expect(worldToScreen({ xM: bounds.maxXM, yM: bounds.maxYM }, constrained).y).toBe(600 - 24);
  });

  it("centre un plan plus petit que l'écran au lieu de laisser dériver le viewport", () => {
    const viewport = { ...createViewport(2), offsetXPx: -9999, offsetYPx: 9999 };
    const constrained = constrainViewportToBounds(viewport, bounds, size);
    const topLeft = worldToScreen({ xM: bounds.minXM, yM: bounds.minYM }, constrained);
    const bottomRight = worldToScreen({ xM: bounds.maxXM, yM: bounds.maxYM }, constrained);
    expect((topLeft.x + bottomRight.x) / 2).toBeCloseTo(size.widthPx / 2);
    expect((topLeft.y + bottomRight.y) / 2).toBeCloseTo(size.heightPx / 2);
  });

  it("cadre tout le fond avec une marge", () => {
    const fitted = fitViewportToBounds(createViewport(20), bounds, size, 32);
    const topLeft = worldToScreen({ xM: bounds.minXM, yM: bounds.minYM }, fitted);
    const bottomRight = worldToScreen({ xM: bounds.maxXM, yM: bounds.maxYM }, fitted);
    expect(topLeft.x).toBeGreaterThanOrEqual(32 - EPSILON);
    expect(topLeft.y).toBeGreaterThanOrEqual(32 - EPSILON);
    expect(bottomRight.x).toBeLessThanOrEqual(size.widthPx - 32 + EPSILON);
    expect(bottomRight.y).toBeLessThanOrEqual(size.heightPx - 32 + EPSILON);
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
    const zoomedOut = zoomViewportAt(viewport, { x: 0, y: 0 }, 0.0001, {
      minZoom: 0.1,
      maxZoom: 10,
    });
    expect(zoomedOut.zoom).toBeGreaterThanOrEqual(0.1 - EPSILON);

    const zoomedIn = zoomViewportAt(viewport, { x: 0, y: 0 }, 10000, { minZoom: 0.1, maxZoom: 10 });
    expect(zoomedIn.zoom).toBeLessThanOrEqual(10 + EPSILON);
  });
});
