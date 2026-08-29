import { describe, expect, it } from "vitest";
import {
  DEFAULT_TEXT_SIZE_M,
  createCircleObject,
  createImageObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createTextObject,
} from "./objects";

const common = { layerId: "layer-1", name: "Objet", xM: 2, yM: 3 };

describe("object factories", () => {
  it("stamp the discriminant, a fresh id and the anchor they are given", () => {
    const rectangle = createRectangleObject({ ...common, widthM: 4, heightM: 5 });
    expect(rectangle.type).toBe("rectangle");
    expect(rectangle.id).toMatch(/^obj_/);
    expect(rectangle.xM).toBe(2);
    expect(rectangle.yM).toBe(3);
    expect(rectangle.widthM).toBe(4);
    expect(rectangle.heightM).toBe(5);
  });

  it("give every object a distinct id", () => {
    const a = createRectangleObject({ ...common, widthM: 1, heightM: 1 });
    const b = createRectangleObject({ ...common, widthM: 1, heightM: 1 });
    expect(a.id).not.toBe(b.id);
  });

  it("default an unrotated object to zero rather than leaving it undefined", () => {
    // `rotationDeg` is not optional on the model: every consumer rotates
    // by it unconditionally, and `undefined` would poison the arithmetic.
    expect(createCircleObject({ ...common, radiusM: 1 }).rotationDeg).toBe(0);
    expect(createCircleObject({ ...common, radiusM: 1, rotationDeg: 45 }).rotationDeg).toBe(45);
  });

  it("give a text object a size that reads at the scale a plan is printed", () => {
    expect(createTextObject({ ...common, text: "Entrée" }).fontSizeM).toBe(DEFAULT_TEXT_SIZE_M);
    expect(DEFAULT_TEXT_SIZE_M).toBe(2);
    expect(createTextObject({ ...common, text: "Entrée", fontSizeM: 0.3 }).fontSizeM).toBe(0.3);
  });

  it("carry the schedule and grouping fields through", () => {
    // These are what buildSchedule groups on; a factory that dropped them
    // would leave every inserted item out of the nomenclature.
    const object = createRectangleObject({
      ...common,
      widthM: 1,
      heightM: 1,
      catalogId: "tent-5x5",
      category: "Structures",
      reference: "CHP-5X5",
      quantity: 3,
      unit: "u",
      groupId: "grp-1",
      groupName: "Village",
    });
    expect(object.catalogId).toBe("tent-5x5");
    expect(object.category).toBe("Structures");
    expect(object.reference).toBe("CHP-5X5");
    expect(object.quantity).toBe(3);
    expect(object.unit).toBe("u");
    expect(object.groupId).toBe("grp-1");
    expect(object.groupName).toBe("Village");
  });

  it("mark a measurement as one", () => {
    const line = createLineObject({
      ...common,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 1, yM: 0 },
      ],
      measurement: { kind: "length" },
    });
    expect(line.measurement).toEqual({ kind: "length" });
    expect(createPolygonObject({ ...common, pointsM: [] }).measurement).toBeUndefined();
  });

  it("keep an image's native resolution alongside its size on the ground", () => {
    // The pixels are what the aspect ratio and any re-fit are derived
    // from; the metres are what gets printed to scale.
    const image = createImageObject({
      ...common,
      url: "data:image/png;base64,AA",
      widthPx: 1600,
      heightPx: 900,
      widthM: 16,
      heightM: 9,
    });
    expect(image.type).toBe("image");
    expect(image.widthPx).toBe(1600);
    expect(image.heightPx).toBe(900);
    expect(image.widthM).toBe(16);
    expect(image.heightM).toBe(9);
  });
});
