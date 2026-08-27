import { describe, expect, it } from "vitest";
import { createBackgroundImage, worldDistanceToImagePixels } from "./background";
import { calibrationFromKnownDistance } from "./calibration";
import { getObjectDimensionSummary, getObjectDisplayLabel, nextObjectName } from "./labels";
import { createCircleObject, createRectangleObject } from "./objects";
import { createDefaultLayers, DEFAULT_LAYER_NAMES, getDefaultTargetLayer } from "./layers";
import {
  addObject,
  applyCalibration,
  createDemoProject,
  createEmptyProject,
  patchBackground,
  patchObject,
  removeBackground,
  removeObject,
  setBackground,
} from "./project";

describe("createEmptyProject", () => {
  it("creates the default layer set", () => {
    const project = createEmptyProject({ name: "Test" });
    expect(project.layers.map((l) => l.name)).toEqual([...DEFAULT_LAYER_NAMES]);
    expect(project.objects).toEqual([]);
    expect(project.background).toBeNull();
    expect(project.units).toBe("m");
  });

  it("assigns a stable, unique id to every layer", () => {
    const layers = createDefaultLayers();
    const ids = new Set(layers.map((l) => l.id));
    expect(ids.size).toBe(layers.length);
  });
});

describe("createDemoProject", () => {
  it("contains a 10 x 5 m rectangle named Chapiteau principal", () => {
    const project = createDemoProject();
    expect(project.objects).toHaveLength(1);

    const chapiteau = project.objects[0];
    expect(chapiteau).toBeDefined();
    expect(chapiteau?.type).toBe("rectangle");
    expect(chapiteau?.name).toBe("Chapiteau principal");
    if (chapiteau?.type === "rectangle") {
      expect(chapiteau.widthM).toBe(10);
      expect(chapiteau.heightM).toBe(5);
    }
  });

  it("assigns the demo object to the Structures layer", () => {
    const project = createDemoProject();
    const structuresLayer = project.layers.find((l) => l.name === "Structures");
    expect(project.objects[0]?.layerId).toBe(structuresLayer?.id);
  });
});

describe("object geometry factories", () => {
  it("stores rectangle dimensions in meters, not pixels", () => {
    const rect = createRectangleObject({
      layerId: "layer_1",
      name: "Scène",
      xM: 3,
      yM: 4,
      widthM: 8,
      heightM: 6,
    });
    expect(rect.widthM).toBe(8);
    expect(rect.heightM).toBe(6);
    expect(rect.xM).toBe(3);
    expect(rect.yM).toBe(4);
    expect(rect.rotationDeg).toBe(0);
  });

  it("stores circle radius in meters", () => {
    const circle = createCircleObject({ layerId: "layer_1", name: "Poteau", xM: 0, yM: 0, radiusM: 1.5 });
    expect(circle.radiusM).toBe(1.5);
  });
});

describe("getObjectDimensionSummary / getObjectDisplayLabel", () => {
  it("summarizes a rectangle's dimensions", () => {
    const rect = createRectangleObject({ layerId: "l", name: "Chapiteau principal", xM: 0, yM: 0, widthM: 10, heightM: 5 });
    expect(getObjectDimensionSummary(rect)).toBe("10 × 5 m");
    expect(getObjectDisplayLabel(rect)).toBe("Chapiteau principal\n10 × 5 m");
  });

  it("prefers an explicit label override when present", () => {
    const rect = createRectangleObject({
      layerId: "l",
      name: "Chapiteau principal",
      label: "Chapiteau VIP",
      xM: 0,
      yM: 0,
      widthM: 10,
      heightM: 5,
    });
    expect(getObjectDisplayLabel(rect)).toBe("Chapiteau VIP");
  });

  it("summarizes a circle by its diameter", () => {
    const circle = createCircleObject({ layerId: "l", name: "Bassin", xM: 0, yM: 0, radiusM: 2 });
    expect(getObjectDimensionSummary(circle)).toBe("⌀ 4 m");
  });
});

describe("nextObjectName", () => {
  it("starts at 1 for an empty project", () => {
    const project = createEmptyProject({ name: "Test" });
    expect(nextObjectName(project, "rectangle")).toBe("Rectangle 1");
  });

  it("counts only objects of the same type", () => {
    const project = createDemoProject(); // already has one rectangle
    expect(nextObjectName(project, "rectangle")).toBe("Rectangle 2");
    expect(nextObjectName(project, "circle")).toBe("Cercle 1");
    expect(nextObjectName(project, "text")).toBe("Texte 1");
  });
});

describe("addObject / removeObject / patchObject", () => {
  it("addObject appends without mutating the original project", () => {
    const project = createEmptyProject({ name: "Test" });
    const layer = project.layers[0];
    if (!layer) throw new Error("expected a default layer");
    const rect = createRectangleObject({ layerId: layer.id, name: "R", xM: 0, yM: 0, widthM: 1, heightM: 1 });

    const next = addObject(project, rect);
    expect(project.objects).toHaveLength(0); // original untouched
    expect(next.objects).toHaveLength(1);
    expect(next.objects[0]).toBe(rect);
  });

  it("removeObject filters out the matching object and is a no-op otherwise", () => {
    const project = createDemoProject();
    const id = project.objects[0]?.id;
    if (!id) throw new Error("expected the demo object");

    const removed = removeObject(project, id);
    expect(removed.objects).toHaveLength(0);

    const noop = removeObject(project, "does-not-exist");
    expect(noop.objects).toHaveLength(1);
  });

  it("patchObject merges fields into the matching object only", () => {
    const project = createDemoProject();
    const id = project.objects[0]?.id;
    if (!id) throw new Error("expected the demo object");

    const patched = patchObject(project, id, { xM: 42, yM: -3 });
    const patchedObject = patched.objects[0];
    expect(patchedObject?.xM).toBe(42);
    expect(patchedObject?.yM).toBe(-3);
    if (patchedObject?.type === "rectangle") {
      expect(patchedObject.widthM).toBe(10); // untouched fields survive the merge
    }
  });

  it("patchObject is a no-op (same array) when the id doesn't match anything", () => {
    const project = createDemoProject();
    const result = patchObject(project, "does-not-exist", { xM: 1 });
    expect(result).toBe(project);
  });
});

describe("getDefaultTargetLayer", () => {
  it("returns the first layer by order when none are locked", () => {
    const layers = createDefaultLayers();
    expect(getDefaultTargetLayer(layers)?.id).toBe(layers[0]?.id);
  });

  it("skips locked layers", () => {
    const layers = createDefaultLayers();
    const first = layers[0];
    if (!first) throw new Error("expected at least one layer");
    const withFirstLocked = layers.map((l) => (l.id === first.id ? { ...l, locked: true } : l));
    expect(getDefaultTargetLayer(withFirstLocked)?.id).toBe(layers[1]?.id);
  });

  it("falls back to the first layer if every layer is locked", () => {
    const layers = createDefaultLayers().map((l) => ({ ...l, locked: true }));
    expect(getDefaultTargetLayer(layers)?.id).toBe(layers[0]?.id);
  });
});

describe("setBackground / removeBackground / patchBackground", () => {
  const sampleBackground = createBackgroundImage({
    url: "data:image/png;base64,xyz",
    widthPx: 2000,
    heightPx: 1000,
    xM: 0,
    yM: 0,
    widthM: 40,
    heightM: 20,
  });

  it("setBackground replaces any existing background without mutating the original project", () => {
    const project = createEmptyProject({ name: "Test" });
    const next = setBackground(project, sampleBackground);
    expect(project.background).toBeNull(); // original untouched
    expect(next.background).toBe(sampleBackground);
  });

  it("removeBackground clears it and is a no-op when there isn't one", () => {
    const withBackground = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    const removed = removeBackground(withBackground);
    expect(removed.background).toBeNull();

    const alreadyEmpty = createEmptyProject({ name: "Test" });
    expect(removeBackground(alreadyEmpty)).toBe(alreadyEmpty);
  });

  it("patchBackground merges fields and is a no-op when there isn't one", () => {
    const withBackground = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    const patched = patchBackground(withBackground, { xM: 5, yM: 5, opacity: 0.5 });
    expect(patched.background?.xM).toBe(5);
    expect(patched.background?.yM).toBe(5);
    expect(patched.background?.opacity).toBe(0.5);
    expect(patched.background?.widthM).toBe(40); // untouched fields survive the merge

    const empty = createEmptyProject({ name: "Test" });
    expect(patchBackground(empty, { xM: 1 })).toBe(empty);
  });
});

describe("applyCalibration", () => {
  const sampleBackground = createBackgroundImage({
    url: "data:image/png;base64,xyz",
    widthPx: 2000,
    heightPx: 1000,
    xM: 3,
    yM: 4,
    widthM: 40, // wrong, pre-calibration guess
    heightM: 20,
  });

  it("sets the calibration and recomputes the background's size from it", () => {
    const project = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    const calibration = calibrationFromKnownDistance(500, 5); // 100 image px / m
    const next = applyCalibration(project, calibration);

    expect(next.calibration).toEqual(calibration);
    expect(next.background?.widthM).toBeCloseTo(20, 9); // 2000px / 100 px-per-m
    expect(next.background?.heightM).toBeCloseTo(10, 9); // 1000px / 100 px-per-m
    expect(next.background?.xM).toBe(3); // anchor untouched
    expect(next.background?.yM).toBe(4);
  });

  it("still records the calibration when there is no background", () => {
    const project = createEmptyProject({ name: "Test" });
    const calibration = calibrationFromKnownDistance(500, 5);
    const next = applyCalibration(project, calibration);
    expect(next.calibration).toEqual(calibration);
    expect(next.background).toBeNull();
  });

  it("does not mutate the original project", () => {
    const project = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    applyCalibration(project, calibrationFromKnownDistance(500, 5));
    expect(project.background?.widthM).toBe(40);
  });

  it("leaves plan objects untouched — calibration corrects the background, not the plan", () => {
    const project = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    const chapiteau = createRectangleObject({
      layerId: layer.id,
      name: "Chapiteau",
      xM: 2,
      yM: 3,
      widthM: 10,
      heightM: 5,
    });
    const withObject = addObject(project, chapiteau);
    const next = applyCalibration(withObject, calibrationFromKnownDistance(500, 5));
    expect(next.objects[0]).toEqual(chapiteau);
  });

  it("keeps the background's aspect ratio, whatever the measured distance", () => {
    const project = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    const next = applyCalibration(project, calibrationFromKnownDistance(137, 3.7));
    const bg = next.background;
    if (!bg) throw new Error("background missing");
    expect(bg.widthM / bg.heightM).toBeCloseTo(bg.widthPx / bg.heightPx, 9);
  });

  it("is self-consistent when recalibrated: a second pass on the same real segment is a no-op", () => {
    // Measure the same physical thing twice. The first calibration fixes
    // the background's size; measuring that same span again on the
    // corrected background and giving the same real distance must land
    // back on the same pixelsPerMeter — otherwise recalibrating would
    // drift the plan a little further every time.
    const project = setBackground(createEmptyProject({ name: "Test" }), sampleBackground);
    const first = applyCalibration(project, calibrationFromKnownDistance(500, 5));
    const bg = first.background;
    if (!bg) throw new Error("background missing");

    // The same 500 image px, re-measured in world meters on the corrected
    // background, then fed back through the same conversion the UI uses.
    const worldSpanM = 500 / (bg.widthPx / bg.widthM);
    const pixelDistance = worldDistanceToImagePixels(bg, worldSpanM);
    const second = applyCalibration(first, calibrationFromKnownDistance(pixelDistance, 5));

    expect(second.calibration.pixelsPerMeter).toBeCloseTo(first.calibration.pixelsPerMeter, 9);
    expect(second.background?.widthM).toBeCloseTo(bg.widthM, 9);
  });
});
