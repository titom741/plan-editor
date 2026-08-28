import { describe, expect, it } from "vitest";
import { createBackgroundImage } from "../domain/background";
import { calibrationFromKnownDistance } from "../domain/calibration";
import { getDefaultTargetLayer } from "../domain/layers";
import { createSheet } from "../domain/sheets";
import { createCircleObject, createRectangleObject, createTextObject } from "../domain/objects";
import { addObject, applyCalibration, createDemoProject, createEmptyProject, setBackground } from "../domain/project";
import type { Project } from "../domain/types";
import {
  FILE_KIND,
  SCHEMA_VERSION,
  deserializeProject,
  parseProjectFile,
  serializeProject,
  toProjectFile,
} from "./projectFile";

/** A project exercising every feature the app can produce: all object types, a background, a real calibration. */
function richProject(): Project {
  let project = createEmptyProject({ name: "Festival", description: "Édition 2026", location: "Nantes" });
  const layer = getDefaultTargetLayer(project.layers);
  if (!layer) throw new Error("no default layer");

  project = addObject(
    project,
    createRectangleObject({
      layerId: layer.id,
      name: "Chapiteau",
      xM: 1.5,
      yM: -2.25,
      widthM: 10,
      heightM: 5,
      style: { fill: "#cfe3ff", stroke: "#2f6fed", strokeWidth: 2, opacity: 0.8, dash: "dashed", arrowStart: false, arrowEnd: true },
      catalogId: "tent-5x5",
      category: "Structures",
      reference: "CHP",
      quantity: 2,
      unit: "u",
    }),
  );
  project = addObject(
    project,
    createCircleObject({ layerId: layer.id, name: "Rond-point", xM: 0, yM: 0, radiusM: 3.5 }),
  );
  project = addObject(
    project,
    createTextObject({ layerId: layer.id, name: "Étiquette", xM: 4, yM: 4, text: "Entrée — accès pompiers" }),
  );
  project = setBackground(
    project,
    createBackgroundImage({
      url: "data:image/png;base64,iVBORw0KGgo=",
      widthPx: 2000,
      heightPx: 1000,
      xM: -10,
      yM: -5,
      widthM: 100,
      heightM: 50,
      opacity: 0.8,
    }),
  );
  project = {
    ...project,
    sheets: [createSheet({ name: "Plan sécurité", titleBlock: { client: "Ville", author: "Léa", revision: "B", planNumber: "SEC-01", comments: "Accès pompiers" } })],
  };
  return applyCalibration(project, calibrationFromKnownDistance(500, 5));
}

/** Round-trips a project through text and returns it, failing the test if it doesn't parse. */
function roundTrip(project: Project): Project {
  const result = deserializeProject(serializeProject(project));
  if (!result.ok) throw new Error(`expected a valid file, got ${JSON.stringify(result.error)}`);
  return result.file.project;
}

describe("serializeProject / deserializeProject", () => {
  it("round-trips a project with every object type, a background and a calibration, unchanged", () => {
    const project = richProject();
    expect(roundTrip(project)).toEqual(project);
  });

  it("charge les anciens fonds sans rotation ni correction d'image", () => {
    const file: any = JSON.parse(serializeProject(richProject()));
    delete file.project.background.rotationDeg;
    delete file.project.background.brightness;
    delete file.project.background.contrast;
    delete file.project.background.grayscale;
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error(`fichier refusé : ${JSON.stringify(result.error)}`);
    expect(result.file.project.background).toMatchObject({ rotationDeg: 0, brightness: 0, contrast: 0, grayscale: false });
  });

  it("round-trips the demo project unchanged", () => {
    const project = createDemoProject();
    expect(roundTrip(project)).toEqual(project);
  });

  it("preserves exact metric values rather than rounding them", () => {
    const project = richProject();
    const rectangle = roundTrip(project).objects.find((o) => o.type === "rectangle");
    expect(rectangle?.xM).toBe(1.5);
    expect(rectangle?.yM).toBe(-2.25);
  });

  it("preserves a project with no background and no objects", () => {
    const project = createEmptyProject({ name: "Vide" });
    const restored = roundTrip(project);
    expect(restored.background).toBeNull();
    expect(restored.objects).toEqual([]);
  });

  it("writes a file tagged with our kind and the current schema version", () => {
    const parsed = JSON.parse(serializeProject(createDemoProject()));
    expect(parsed.kind).toBe(FILE_KIND);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof parsed.savedAt).toBe("string");
  });
});

describe("parseProjectFile — rejecting what isn't ours", () => {
  it("rejects text that isn't JSON at all", () => {
    expect(deserializeProject("<html>nope</html>")).toEqual({ ok: false, error: { code: "notJson" } });
  });

  it("rejects JSON that isn't an object", () => {
    expect(deserializeProject("[1, 2, 3]").ok).toBe(false);
    expect(deserializeProject('"a string"')).toEqual({ ok: false, error: { code: "notAnObject" } });
  });

  it("rejects an unrelated JSON file with 'unknownFormat', not a field complaint", () => {
    const somebodyElsesFile = JSON.stringify({ name: "package", version: "1.0.0", dependencies: {} });
    expect(deserializeProject(somebodyElsesFile)).toEqual({ ok: false, error: { code: "unknownFormat" } });
  });

  it("refuses a file written by a newer version of the app", () => {
    const file = { ...toProjectFile(createDemoProject()), schemaVersion: SCHEMA_VERSION + 1 };
    expect(parseProjectFile(file)).toEqual({
      ok: false,
      error: { code: "unsupportedVersion", found: SCHEMA_VERSION + 1, supported: SCHEMA_VERSION },
    });
  });

  it("rejects a non-integer schema version", () => {
    const file = { ...toProjectFile(createDemoProject()), schemaVersion: "1" };
    expect(parseProjectFile(file)).toEqual({ ok: false, error: { code: "invalidField", path: "schemaVersion" } });
  });
});

describe("parseProjectFile — field validation", () => {
  /**
   * Applies `mutate` to a valid file and returns the resulting parse
   * error, asserting there was one. The callback's argument is
   * deliberately untyped: these tests exist to corrupt the file in ways
   * the type system forbids, which is exactly the input `parseProjectFile`
   * has to survive.
   */
  function errorAfter(mutate: (file: any) => void) {
    const file = JSON.parse(JSON.stringify(toProjectFile(richProject())));
    mutate(file);
    const result = parseProjectFile(file);
    if (result.ok) throw new Error("expected the file to be rejected");
    return result.error;
  }

  it("names the offending path so the UI can say what's wrong", () => {
    expect(errorAfter((f) => (f.project.objects[0].widthM = "wide"))).toEqual({
      code: "invalidField",
      path: "project.objects[0].widthM",
    });
  });

  it("rejects a missing required field", () => {
    expect(errorAfter((f) => delete f.project.name)).toEqual({ code: "invalidField", path: "project.name" });
  });

  it("rejects an unknown object type instead of loading a half-understood project", () => {
    expect(errorAfter((f) => (f.project.objects[0].type = "hexagon"))).toEqual({
      code: "invalidField",
      path: "project.objects[0].type",
    });
  });

  it("rejects an unknown line pattern", () => {
    expect(errorAfter((f) => (f.project.objects[0].style.dash = "zigzag"))).toEqual({
      code: "invalidField",
      path: "project.objects[0].style.dash",
    });
  });

  it("rejects units other than meters", () => {
    expect(errorAfter((f) => (f.project.units = "ft"))).toEqual({ code: "invalidField", path: "project.units" });
  });

  it("rejects NaN and Infinity, which JSON turns into null", () => {
    expect(errorAfter((f) => (f.project.objects[0].xM = null))).toEqual({
      code: "invalidField",
      path: "project.objects[0].xM",
    });
  });

  it("rejects a zero or negative pixelsPerMeter, which would break every conversion", () => {
    expect(errorAfter((f) => (f.project.calibration.pixelsPerMeter = 0))).toEqual({
      code: "invalidField",
      path: "project.calibration.pixelsPerMeter",
    });
    expect(errorAfter((f) => (f.project.calibration.pixelsPerMeter = -20))).toEqual({
      code: "invalidField",
      path: "project.calibration.pixelsPerMeter",
    });
  });

  it("rejects an out-of-range background opacity", () => {
    expect(errorAfter((f) => (f.project.background.opacity = 1.5))).toEqual({
      code: "invalidField",
      path: "project.background.opacity",
    });
  });

  it("rejects out-of-range background image corrections", () => {
    expect(errorAfter((f) => (f.project.background.brightness = 2))).toEqual({
      code: "invalidField",
      path: "project.background.brightness",
    });
    expect(errorAfter((f) => (f.project.background.contrast = -101))).toEqual({
      code: "invalidField",
      path: "project.background.contrast",
    });
  });

  it("rejects a zero-sized background", () => {
    expect(errorAfter((f) => (f.project.background.widthM = 0))).toEqual({
      code: "invalidField",
      path: "project.background.widthM",
    });
  });

  it("rejects an unknown calibration source", () => {
    expect(errorAfter((f) => (f.project.calibration.source = { type: "vibes" }))).toEqual({
      code: "invalidField",
      path: "project.calibration.source.type",
    });
  });

  it("rejects layers that aren't an array", () => {
    expect(errorAfter((f) => (f.project.layers = {}))).toEqual({ code: "invalidField", path: "project.layers" });
  });

  it("rejects a malformed point inside a line", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(richProject())));
    const layerId = file.project.layers[0].id;
    file.project.objects.push({
      id: "line_1",
      layerId,
      name: "Ligne",
      xM: 0,
      yM: 0,
      rotationDeg: 0,
      type: "line",
      pointsM: [{ xM: 0, yM: 0 }, { xM: 1 }],
    });
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({ code: "invalidField", path: "project.objects[3].pointsM[1].yM" });
    }
  });
});

describe("parseProjectFile — referential integrity", () => {
  it("rejects an object pointing at a layer the file doesn't contain", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(richProject())));
    file.project.objects[0].layerId = "layer_ghost";
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toEqual({
        code: "danglingLayerRef",
        objectId: file.project.objects[0].id,
        layerId: "layer_ghost",
      });
    }
  });

  it("accepts an object on any layer that is present, whatever its order", () => {
    const project = richProject();
    const lastLayer = project.layers[project.layers.length - 1];
    if (!lastLayer) throw new Error("no layers");
    const moved: Project = {
      ...project,
      objects: project.objects.map((object) => ({ ...object, layerId: lastLayer.id })),
    };
    expect(roundTrip(moved).objects.every((o) => o.layerId === lastLayer.id)).toBe(true);
  });
});

describe("parseProjectFile — tolerance", () => {
  it("accepts a file whose optional savedAt is missing", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(createDemoProject())));
    delete file.savedAt;
    const result = parseProjectFile(file);
    expect(result.ok).toBe(true);
  });

  it("accepts objects without an optional style or label", () => {
    const project = createEmptyProject({ name: "Nu" });
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    const bare = addObject(
      project,
      createCircleObject({ layerId: layer.id, name: "Cercle", xM: 0, yM: 0, radiusM: 1 }),
    );
    expect(roundTrip(bare)).toEqual(bare);
  });

  it("keeps a background's data: URL byte-for-byte", () => {
    const url = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const project = setBackground(
      createEmptyProject({ name: "Fond" }),
      createBackgroundImage({ url, widthPx: 1, heightPx: 1, xM: 0, yM: 0, widthM: 1, heightM: 1 }),
    );
    expect(roundTrip(project).background?.url).toBe(url);
  });
});
