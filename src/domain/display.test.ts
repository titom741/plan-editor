import { describe, expect, it } from "vitest";
import {
  DEFAULT_LABEL_DISPLAY,
  isLabelHidden,
  resolveLabelDisplay,
  type LabelDisplay,
} from "./display";
import { getObjectDisplayLabel } from "./labels";
import { createLineObject, createRectangleObject } from "./objects";

const ALL_OFF: LabelDisplay = {
  name: false,
  dimensions: false,
  reference: false,
  quantity: false,
  stands: false,
};

function crate(overrides: Partial<Parameters<typeof createRectangleObject>[0]> = {}) {
  return createRectangleObject({
    layerId: "l1",
    name: "Caisse",
    xM: 0,
    yM: 0,
    widthM: 2,
    heightM: 1,
    ...overrides,
  });
}

describe("resolveLabelDisplay", () => {
  it("falls back to the project default when the object has no override", () => {
    expect(resolveLabelDisplay(crate(), DEFAULT_LABEL_DISPLAY)).toEqual(DEFAULT_LABEL_DISPLAY);
  });

  it("prefers the object's own override, whole", () => {
    const object = { ...crate(), display: ALL_OFF };
    expect(resolveLabelDisplay(object, DEFAULT_LABEL_DISPLAY)).toEqual(ALL_OFF);
  });
});

describe("isLabelHidden", () => {
  it("is true only when nothing at all would be drawn", () => {
    expect(isLabelHidden(ALL_OFF)).toBe(true);
    expect(isLabelHidden({ ...ALL_OFF, reference: true })).toBe(false);
    expect(isLabelHidden(DEFAULT_LABEL_DISPLAY)).toBe(false);
  });
});

describe("getObjectDisplayLabel with display settings", () => {
  it("writes one line per switched-on part, in a fixed order", () => {
    const object = crate({ reference: "CR-2X1", quantity: 4 });
    expect(
      getObjectDisplayLabel(object, {
        name: true,
        dimensions: true,
        reference: true,
        quantity: true,
        stands: true,
      }),
    ).toBe("Caisse\n2 × 1 m\nCR-2X1\n× 4");
  });

  it("draws nothing at all when everything is off", () => {
    expect(getObjectDisplayLabel(crate({ reference: "CR" }), ALL_OFF)).toBe("");
  });

  it("omits a reference or quantity the object doesn't have, rather than printing a blank line", () => {
    expect(
      getObjectDisplayLabel(crate(), {
        name: true,
        dimensions: false,
        reference: true,
        quantity: true,
        stands: true,
      }),
    ).toBe("Caisse");
  });

  it("treats a quantity of 1 as nothing worth saying", () => {
    expect(
      getObjectDisplayLabel(crate({ quantity: 1 }), { ...ALL_OFF, quantity: true, stands: true }),
    ).toBe("");
    expect(
      getObjectDisplayLabel(crate({ quantity: 2 }), { ...ALL_OFF, quantity: true, stands: true }),
    ).toBe("× 2");
  });

  it("lets a measurement state what it measures in place of a size", () => {
    const measure = createLineObject({
      layerId: "l1",
      name: "Mesure 1",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 3, yM: 4 },
      ],
      measurement: { kind: "length" },
    });
    expect(getObjectDisplayLabel(measure, DEFAULT_LABEL_DISPLAY)).toBe("Mesure 1\n5 m");
  });

  it("still honours a pre-KL-027 free-text label, so existing plans don't silently change", () => {
    expect(getObjectDisplayLabel(crate({ label: "Zone A" }), ALL_OFF)).toBe("Zone A");
  });
});
