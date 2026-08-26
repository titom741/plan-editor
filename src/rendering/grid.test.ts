import { describe, expect, it } from "vitest";
import { computeGridLines, pickGridSpacingM } from "./grid";
import { createViewport } from "./viewport";

describe("pickGridSpacingM", () => {
  it("picks a coarser spacing when zoomed out", () => {
    const zoomedIn = createViewport(200); // 200 px/m
    const zoomedOut = createViewport(2); // 2 px/m
    expect(pickGridSpacingM(zoomedOut)).toBeGreaterThan(pickGridSpacingM(zoomedIn));
  });
});

describe("computeGridLines", () => {
  it("derives line positions from the metric spacing via worldToScreen", () => {
    const viewport = createViewport(20); // 20 px/m
    const { spacingM, vertical, horizontal } = computeGridLines(viewport, 800, 600);

    expect(spacingM).toBeGreaterThan(0);
    expect(vertical.length).toBeGreaterThan(0);
    expect(horizontal.length).toBeGreaterThan(0);

    // Consecutive vertical lines should be `spacingM * pixelsPerMeter` apart.
    const xs = vertical.map((l) => l.points[0]).sort((a, b) => a - b);
    for (let i = 1; i < xs.length; i++) {
      const current = xs[i];
      const previous = xs[i - 1];
      if (current === undefined || previous === undefined) continue;
      expect(current - previous).toBeCloseTo(spacingM * 20, 6);
    }
  });

  it("marks exactly one vertical and one horizontal line as the axis", () => {
    const viewport = createViewport(20);
    const { vertical, horizontal } = computeGridLines(viewport, 800, 600);
    expect(vertical.filter((l) => l.isAxis)).toHaveLength(1);
    expect(horizontal.filter((l) => l.isAxis)).toHaveLength(1);
  });
});
