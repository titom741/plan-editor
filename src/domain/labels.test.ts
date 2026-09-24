import { describe, expect, it } from "vitest";
import { DEFAULT_LABEL_DISPLAY } from "./display";
import {
  formatMeters,
  getObjectDimensionSummary,
  getObjectDisplayLabel,
  nextObjectName,
} from "./labels";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createSymbolObject,
  createTextObject,
} from "./objects";
import { createEmptyProject } from "./project";
import type { PlanObject } from "./types";

const LAYER = "layer-1";

const rectangle = (widthM: number, heightM: number, name = "Chapiteau") =>
  createRectangleObject({ layerId: LAYER, name, xM: 0, yM: 0, widthM, heightM });

describe("formatMeters", () => {
  it("keeps whole numbers whole", () => {
    expect(formatMeters(12)).toBe("12");
    expect(formatMeters(0)).toBe("0");
  });

  it("trims to two decimals and drops the trailing zeros", () => {
    expect(formatMeters(2.5)).toBe("2.5");
    expect(formatMeters(6.1)).toBe("6.1");
    expect(formatMeters(12.216)).toBe("12.22");
    // 10.10 must not come back as "10.1" with a stray dot, nor as "10.".
    expect(formatMeters(10.1)).toBe("10.1");
  });

  it("keeps a decimal that happens to end in zero inside the number", () => {
    expect(formatMeters(10.05)).toBe("10.05");
  });

  it("handles negatives, which a plan produces as soon as the origin is inside it", () => {
    expect(formatMeters(-2.5)).toBe("-2.5");
    expect(formatMeters(-3)).toBe("-3");
  });
});

describe("getObjectDimensionSummary", () => {
  it("gives a rectangle its two sides", () => {
    expect(getObjectDimensionSummary(rectangle(12.22, 6.1))).toBe("12.22 × 6.1 m");
  });

  it("gives a circle its diameter, not its radius", () => {
    // What a tent is ordered by is its diameter; the model stores a radius.
    const circle = createCircleObject({
      layerId: LAYER,
      name: "Rond",
      xM: 0,
      yM: 0,
      radiusM: 0.75,
    });
    expect(getObjectDimensionSummary(circle)).toBe("⌀ 1.5 m");
  });

  it("gives a line its length", () => {
    const line = createLineObject({
      layerId: LAYER,
      name: "Câble",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 3, yM: 4 },
      ],
    });
    expect(getObjectDimensionSummary(line)).toBe("5 m");
  });

  it("gives a polygon both its perimeter and its area", () => {
    const polygon = createPolygonObject({
      layerId: LAYER,
      name: "Zone",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 10, yM: 0 },
        { xM: 10, yM: 10 },
        { xM: 0, yM: 10 },
      ],
    });
    expect(getObjectDimensionSummary(polygon)).toBe("40 m · 100 m²");
  });

  it("has nothing to say about a text object", () => {
    // Its size is a font size, which is not a real-world dimension anyone
    // measures on the ground.
    const text = createTextObject({ layerId: LAYER, name: "Titre", xM: 0, yM: 0, text: "Entrée" });
    expect(getObjectDimensionSummary(text)).toBeNull();
  });
});

describe("getObjectDisplayLabel", () => {
  it("composes one line per switched-on part", () => {
    expect(getObjectDisplayLabel(rectangle(5, 5, "Chapiteau"), DEFAULT_LABEL_DISPLAY)).toBe(
      "Chapiteau\n5 × 5 m",
    );
  });

  it("writes nothing when every part is off", () => {
    const display = {
      name: false,
      dimensions: false,
      reference: false,
      quantity: false,
      stands: false,
      electrical: false,
    };
    expect(getObjectDisplayLabel(rectangle(5, 5), display)).toBe("");
  });

  it("recomputes from the current geometry rather than storing a label", () => {
    // The whole point of composing on demand: a resized object must not
    // keep advertising the size it used to be.
    const before = rectangle(5, 5);
    const after: PlanObject = { ...before, widthM: 8 };
    expect(getObjectDisplayLabel(after, DEFAULT_LABEL_DISPLAY)).toBe("Chapiteau\n8 × 5 m");
  });

  it("adds the reference only when one is set", () => {
    const display = {
      name: true,
      dimensions: false,
      reference: true,
      quantity: false,
      stands: false,
      electrical: false,
    };
    expect(getObjectDisplayLabel(rectangle(5, 5), display)).toBe("Chapiteau");
    expect(getObjectDisplayLabel({ ...rectangle(5, 5), reference: "CHP-5X5" }, display)).toBe(
      "Chapiteau\nCHP-5X5",
    );
  });

  it("stays quiet about a quantity of one", () => {
    // Every object is one of itself; printing "× 1" on each of them says
    // nothing and clutters the plan.
    const display = {
      name: false,
      dimensions: false,
      reference: false,
      quantity: true,
      stands: true,
      electrical: true,
    };
    expect(getObjectDisplayLabel({ ...rectangle(5, 5), quantity: 1 }, display)).toBe("");
    expect(getObjectDisplayLabel(rectangle(5, 5), display)).toBe("");
    expect(getObjectDisplayLabel({ ...rectangle(5, 5), quantity: 12 }, display)).toBe("× 12");
  });

  it("lets a pre-KL-027 free-text label win", () => {
    // Dropping it would silently rewrite the labels of existing plans.
    const legacy = { ...rectangle(5, 5), label: "Chapiteau VIP — accès réservé" };
    expect(getObjectDisplayLabel(legacy, DEFAULT_LABEL_DISPLAY)).toBe(
      "Chapiteau VIP — accès réservé",
    );
  });

  it("defaults to the standard display when none is given", () => {
    expect(getObjectDisplayLabel(rectangle(5, 5))).toBe("Chapiteau\n5 × 5 m");
  });

  describe("measurement objects", () => {
    const line = (pointsM: { xM: number; yM: number }[]) =>
      createLineObject({ layerId: LAYER, name: "Mesure 1", xM: 0, yM: 0, pointsM });

    it("states the angle a persisted angle measurement measures", () => {
      const angle = {
        ...line([
          { xM: 0, yM: 5 },
          { xM: 0, yM: 0 },
          { xM: 5, yM: 0 },
        ]),
        measurement: { kind: "angle" as const },
      };
      expect(getObjectDisplayLabel(angle, DEFAULT_LABEL_DISPLAY)).toBe("Mesure 1\n90°");
    });

    it("falls back to the plain length when an angle has too few points", () => {
      const degenerate = {
        ...line([
          { xM: 0, yM: 0 },
          { xM: 3, yM: 4 },
        ]),
        measurement: { kind: "angle" as const },
      };
      expect(getObjectDisplayLabel(degenerate, DEFAULT_LABEL_DISPLAY)).toBe("Mesure 1\n5 m");
    });

    it("states area and perimeter for an area measurement", () => {
      const area = {
        ...createPolygonObject({
          layerId: LAYER,
          name: "Surface",
          xM: 0,
          yM: 0,
          pointsM: [
            { xM: 0, yM: 0 },
            { xM: 10, yM: 0 },
            { xM: 10, yM: 10 },
            { xM: 0, yM: 10 },
          ],
        }),
        measurement: { kind: "area" as const },
      };
      expect(getObjectDisplayLabel(area, DEFAULT_LABEL_DISPLAY)).toBe(
        "Surface\n100 m²\nPérimètre 40 m",
      );
    });

    it("says nothing extra when dimensions are switched off", () => {
      const display = {
        name: true,
        dimensions: false,
        reference: false,
        quantity: false,
        stands: false,
        electrical: false,
      };
      const area = { ...rectangle(5, 5), measurement: { kind: "area" as const } };
      expect(getObjectDisplayLabel(area, display)).toBe("Chapiteau");
    });
  });
});

describe("nextObjectName", () => {
  it("numbers per type, not across the plan", () => {
    const project = createEmptyProject({ name: "Test" });
    const layerId = project.layers[0]!.id;
    const withObjects = {
      ...project,
      objects: [
        createRectangleObject({
          layerId,
          name: "Rectangle 1",
          xM: 0,
          yM: 0,
          widthM: 1,
          heightM: 1,
        }),
        createCircleObject({ layerId, name: "Cercle 1", xM: 0, yM: 0, radiusM: 1 }),
        createRectangleObject({
          layerId,
          name: "Rectangle 2",
          xM: 0,
          yM: 0,
          widthM: 1,
          heightM: 1,
        }),
      ],
    };
    expect(nextObjectName(withObjects, "rectangle")).toBe("Rectangle 3");
    expect(nextObjectName(withObjects, "circle")).toBe("Cercle 2");
    expect(nextObjectName(withObjects, "polygon")).toBe("Polygone 1");
  });

  it("counts arrows apart from the plain lines they share a type with", () => {
    const project = createEmptyProject({ name: "Test" });
    const layerId = project.layers[0]!.id;
    const segment = [
      { xM: 0, yM: 0 },
      { xM: 1, yM: 0 },
    ];
    const withObjects = {
      ...project,
      objects: [
        createLineObject({ layerId, name: "Ligne 1", xM: 0, yM: 0, pointsM: segment }),
        createLineObject({
          layerId,
          name: "Flèche 1",
          xM: 0,
          yM: 0,
          pointsM: segment,
          style: { arrowEnd: true },
        }),
        createSymbolObject({ layerId, name: "Symbole 1", xM: 0, yM: 0 }),
      ],
    };
    // An arrow *is* a line, so naming by type alone would call the next
    // line "Ligne 3" and the next arrow "Flèche 3" — each counting the
    // other's objects.
    expect(nextObjectName(withObjects, "line")).toBe("Ligne 2");
    expect(nextObjectName(withObjects, "arrow")).toBe("Flèche 2");
    expect(nextObjectName(withObjects, "symbol")).toBe("Symbole 2");
  });
});

describe("a symbol's dimension summary", () => {
  it("states the height it stands at on the ground", () => {
    const symbol = createSymbolObject({
      layerId: LAYER,
      name: "Secours",
      xM: 0,
      yM: 0,
      sizeM: 1.5,
    });
    expect(getObjectDimensionSummary(symbol)).toBe("1.5 m");
  });
});
