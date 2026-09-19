import { describe, expect, it } from "vitest";
import {
  boundsCenterM,
  boundsSizeM,
  getBackgroundBoundsM,
  getObjectBoundsM,
  getProjectBoundsM,
  unionBounds,
} from "./bounds";
import { createBackgroundImage } from "./background";
import { getDefaultTargetLayer } from "./layers";
import {
  createCircleObject,
  createLineObject,
  createRectangleObject,
  createSymbolObject,
  createTextObject,
} from "./objects";
import { addBackground, addObject, createEmptyProject } from "./project";
import type { Project } from "./types";

describe("getObjectBoundsM — rectangles", () => {
  it("bounds an unrotated rectangle by its anchor and size", () => {
    const rectangle = createRectangleObject({
      layerId: "l",
      name: "R",
      xM: 2,
      yM: 3,
      widthM: 10,
      heightM: 5,
    });
    expect(getObjectBoundsM(rectangle)).toEqual({ minXM: 2, minYM: 3, maxXM: 12, maxYM: 8 });
  });

  it("grows the box when the rectangle is rotated — the corners, not the sides", () => {
    const rectangle = {
      ...createRectangleObject({ layerId: "l", name: "R", xM: 0, yM: 0, widthM: 10, heightM: 4 }),
      rotationDeg: 90,
    };
    const bounds = getObjectBoundsM(rectangle);
    if (!bounds) throw new Error("no bounds");
    // Rotated a quarter turn about its anchor, a 10 × 4 rectangle spans
    // 4 across and 10 down.
    const size = boundsSizeM(bounds);
    expect(size.widthM).toBeCloseTo(4, 9);
    expect(size.heightM).toBeCloseTo(10, 9);
  });

  it("bounds a 45° rectangle by its diagonal reach", () => {
    const rectangle = {
      ...createRectangleObject({ layerId: "l", name: "R", xM: 0, yM: 0, widthM: 10, heightM: 10 }),
      rotationDeg: 45,
    };
    const bounds = getObjectBoundsM(rectangle);
    if (!bounds) throw new Error("no bounds");
    const size = boundsSizeM(bounds);
    // A 10 × 10 square turned 45° needs 10√2 ≈ 14.14 m in both directions.
    expect(size.widthM).toBeCloseTo(Math.SQRT2 * 10, 6);
    expect(size.heightM).toBeCloseTo(Math.SQRT2 * 10, 6);
  });
});

describe("getBackgroundBoundsM", () => {
  it("inclut les quatre coins d'un fond tourné", () => {
    const background = {
      ...createBackgroundImage({
        url: "data:,",
        widthPx: 100,
        heightPx: 50,
        xM: 10,
        yM: 20,
        widthM: 10,
        heightM: 5,
      }),
      rotationDeg: 90,
    };
    const bounds = getBackgroundBoundsM(background);
    expect(bounds.minXM).toBeCloseTo(5, 9);
    expect(bounds.maxXM).toBeCloseTo(10, 9);
    expect(bounds.minYM).toBeCloseTo(20, 9);
    expect(bounds.maxYM).toBeCloseTo(30, 9);
  });
});

describe("getObjectBoundsM — other shapes", () => {
  it("bounds a circle around its centre, ignoring rotation", () => {
    const circle = {
      ...createCircleObject({ layerId: "l", name: "C", xM: 5, yM: 5, radiusM: 2 }),
      rotationDeg: 37,
    };
    expect(getObjectBoundsM(circle)).toEqual({ minXM: 3, minYM: 3, maxXM: 7, maxYM: 7 });
  });

  it("bounds a line by its points, offset from the anchor", () => {
    const line = createLineObject({
      layerId: "l",
      name: "L",
      xM: 10,
      yM: 10,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 5, yM: -3 },
      ],
    });
    expect(getObjectBoundsM(line)).toEqual({ minXM: 10, minYM: 7, maxXM: 15, maxYM: 10 });
  });

  it("estime l'étendue réelle d'un texte au lieu de le réduire à son ancre", () => {
    // The size is pinned rather than left to the factory default: this
    // test is about the extent maths, not about what a new text starts at.
    const text = createTextObject({
      layerId: "l",
      name: "T",
      xM: 4,
      yM: 6,
      text: "Entrée pompiers",
      fontSizeM: 0.3,
    });
    const bounds = getObjectBoundsM(text);
    expect(bounds?.minXM).toBe(4);
    expect(bounds?.minYM).toBe(6);
    expect(bounds?.maxXM).toBeCloseTo(6.7, 9);
    expect(bounds?.maxYM).toBeCloseTo(6.36, 9);
  });
});

describe("unionBounds", () => {
  it("treats a missing side as the identity", () => {
    const box = { minXM: 0, minYM: 0, maxXM: 1, maxYM: 1 };
    expect(unionBounds(null, box)).toEqual(box);
    expect(unionBounds(box, null)).toEqual(box);
    expect(unionBounds(null, null)).toBeNull();
  });

  it("covers both boxes", () => {
    const union = unionBounds(
      { minXM: 0, minYM: 0, maxXM: 2, maxYM: 2 },
      { minXM: -1, minYM: 5, maxXM: 1, maxYM: 6 },
    );
    expect(union).toEqual({ minXM: -1, minYM: 0, maxXM: 2, maxYM: 6 });
  });

  it("reports size and centre", () => {
    const bounds = { minXM: -10, minYM: 0, maxXM: 10, maxYM: 4 };
    expect(boundsSizeM(bounds)).toEqual({ widthM: 20, heightM: 4 });
    expect(boundsCenterM(bounds)).toEqual({ xM: 0, yM: 2 });
  });
});

describe("getProjectBoundsM", () => {
  function projectWithLayer(): { project: Project; layerId: string } {
    const project = createEmptyProject({ name: "Test" });
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    return { project, layerId: layer.id };
  }

  it("returns null for an empty plan rather than a fabricated zero box", () => {
    expect(getProjectBoundsM(createEmptyProject({ name: "Vide" }))).toBeNull();
  });

  it("covers every visible object", () => {
    const { project, layerId } = projectWithLayer();
    const withObjects = addObject(
      addObject(
        project,
        createRectangleObject({ layerId, name: "R", xM: 0, yM: 0, widthM: 10, heightM: 5 }),
      ),
      createCircleObject({ layerId, name: "C", xM: 30, yM: 20, radiusM: 5 }),
    );
    expect(getProjectBoundsM(withObjects)).toEqual({ minXM: 0, minYM: 0, maxXM: 35, maxYM: 25 });
  });

  it("includes the background", () => {
    const { project, layerId } = projectWithLayer();
    const withObject = addObject(
      project,
      createRectangleObject({ layerId, name: "R", xM: 0, yM: 0, widthM: 5, heightM: 5 }),
    );
    const withBackground = addBackground(
      withObject,
      createBackgroundImage({
        url: "data:,",
        widthPx: 100,
        heightPx: 50,
        xM: -20,
        yM: -10,
        widthM: 40,
        heightM: 20,
      }),
    );
    expect(getProjectBoundsM(withBackground)).toEqual({
      minXM: -20,
      minYM: -10,
      maxXM: 20,
      maxYM: 10,
    });
  });

  it("ignores objects on a hidden layer — what you export is what you see", () => {
    const { project, layerId } = projectWithLayer();
    const withObjects = addObject(
      addObject(
        project,
        createRectangleObject({ layerId, name: "R", xM: 0, yM: 0, widthM: 10, heightM: 5 }),
      ),
      createCircleObject({ layerId, name: "Loin", xM: 500, yM: 500, radiusM: 5 }),
    );
    const hidden: Project = {
      ...withObjects,
      layers: withObjects.layers.map((layer) => ({ ...layer, visible: false })),
    };
    expect(getProjectBoundsM(hidden)).toBeNull();
  });

  it("ignores a hidden background", () => {
    const { project } = projectWithLayer();
    const withBackground = addBackground(
      project,
      createBackgroundImage({
        url: "data:,",
        widthPx: 10,
        heightPx: 10,
        xM: 0,
        yM: 0,
        widthM: 100,
        heightM: 100,
      }),
    );
    const hidden: Project = {
      ...withBackground,
      backgrounds: withBackground.backgrounds.map((background) => ({
        ...background,
        visible: false,
      })),
    };
    expect(getProjectBoundsM(hidden)).toBeNull();
  });
});

describe("getObjectBoundsM — symbols", () => {
  it("centres the box on the anchor, unlike a text's top-left", () => {
    const symbol = createSymbolObject({ layerId: "l", name: "S", xM: 10, yM: 20, sizeM: 2 });
    expect(getObjectBoundsM(symbol)).toEqual({ minXM: 9, minYM: 19, maxXM: 11, maxYM: 21 });
  });

  it("keeps the symbol's own point still when it is turned", () => {
    const symbol = {
      ...createSymbolObject({ layerId: "l", name: "S", xM: 10, yM: 20, sizeM: 2 }),
      rotationDeg: 45,
    };
    const bounds = getObjectBoundsM(symbol);
    if (!bounds) throw new Error("no bounds");
    // The anchor is the centre, so rotation moves the corners around it
    // and never moves it: a square turned 45° bounds √2 wider, centred on
    // the same point.
    expect(boundsCenterM(bounds).xM).toBeCloseTo(10, 9);
    expect(boundsCenterM(bounds).yM).toBeCloseTo(20, 9);
    expect(boundsSizeM(bounds).widthM).toBeCloseTo(2 * Math.SQRT2, 6);
  });
});
