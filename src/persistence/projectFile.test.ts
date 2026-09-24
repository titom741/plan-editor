import { describe, expect, it } from "vitest";
import { createBackgroundImage } from "../domain/background";
import { calibrationFromKnownDistance } from "../domain/calibration";
import { getDefaultTargetLayer } from "../domain/layers";
import { createSheet } from "../domain/sheets";
import {
  createCircleObject,
  createRectangleObject,
  createSymbolObject,
  createTextObject,
} from "../domain/objects";
import {
  addObject,
  applyCalibration,
  createDemoProject,
  createEmptyProject,
  addBackground,
} from "../domain/project";
import { MAX_LABEL_FONT_SIZE_PX } from "../domain/display";
import { createCableObject, createDeviceObject } from "../domain/electrical";
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
  let project = createEmptyProject({
    name: "Festival",
    description: "Édition 2026",
    location: "Nantes",
  });
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
      style: {
        fill: "#cfe3ff",
        stroke: "#2f6fed",
        strokeWidth: 2,
        opacity: 0.8,
        dash: "dashed",
        arrowStart: false,
        arrowEnd: true,
        labelFontSize: 18,
      },
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
    createTextObject({
      layerId: layer.id,
      name: "Étiquette",
      xM: 4,
      yM: 4,
      text: "Entrée — accès pompiers",
    }),
  );
  project = addBackground(
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
    sheets: [
      createSheet({
        name: "Plan sécurité",
        titleBlock: {
          client: "Ville",
          author: "Léa",
          revision: "B",
          planNumber: "SEC-01",
          comments: "Accès pompiers",
        },
      }),
    ],
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
    delete file.project.backgrounds[0].rotationDeg;
    delete file.project.backgrounds[0].brightness;
    delete file.project.backgrounds[0].contrast;
    delete file.project.backgrounds[0].grayscale;
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error(`fichier refusé : ${JSON.stringify(result.error)}`);
    expect(result.file.project.backgrounds[0]).toMatchObject({
      rotationDeg: 0,
      brightness: 0,
      contrast: 0,
      grayscale: false,
    });
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
    expect(restored.backgrounds).toEqual([]);
    expect(restored.objects).toEqual([]);
  });

  it("writes a file tagged with our kind and the current schema version", () => {
    const parsed = JSON.parse(serializeProject(createDemoProject()));
    expect(parsed.kind).toBe(FILE_KIND);
    expect(parsed.schemaVersion).toBe(SCHEMA_VERSION);
    expect(typeof parsed.savedAt).toBe("string");
  });
});

describe("label font size (KL-040)", () => {
  it("round-trips a caption size set on an object", () => {
    const rectangle = roundTrip(richProject()).objects.find((o) => o.type === "rectangle");
    expect(rectangle?.style?.labelFontSize).toBe(18);
  });

  it("brings an out-of-range size back into what the app draws instead of refusing the file", () => {
    const file: any = JSON.parse(serializeProject(richProject()));
    file.project.objects[0].style.labelFontSize = 10_000;
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error(`fichier refusé : ${JSON.stringify(result.error)}`);
    expect(result.file.project.objects[0]?.style?.labelFontSize).toBe(MAX_LABEL_FONT_SIZE_PX);
  });

  it("still rejects a size that is not a number at all", () => {
    const file: any = JSON.parse(serializeProject(richProject()));
    file.project.objects[0].style.labelFontSize = "grand";
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "invalidField",
      path: "project.objects[0].style.labelFontSize",
    });
  });
});

describe("parseProjectFile — rejecting what isn't ours", () => {
  it("rejects text that isn't JSON at all", () => {
    expect(deserializeProject("<html>nope</html>")).toEqual({
      ok: false,
      error: { code: "notJson" },
    });
  });

  it("rejects JSON that isn't an object", () => {
    expect(deserializeProject("[1, 2, 3]").ok).toBe(false);
    expect(deserializeProject('"a string"')).toEqual({ ok: false, error: { code: "notAnObject" } });
  });

  it("rejects an unrelated JSON file with 'unknownFormat', not a field complaint", () => {
    const somebodyElsesFile = JSON.stringify({
      name: "package",
      version: "1.0.0",
      dependencies: {},
    });
    expect(deserializeProject(somebodyElsesFile)).toEqual({
      ok: false,
      error: { code: "unknownFormat" },
    });
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
    expect(parseProjectFile(file)).toEqual({
      ok: false,
      error: { code: "invalidField", path: "schemaVersion" },
    });
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
    expect(errorAfter((f) => delete f.project.name)).toEqual({
      code: "invalidField",
      path: "project.name",
    });
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
    expect(errorAfter((f) => (f.project.units = "ft"))).toEqual({
      code: "invalidField",
      path: "project.units",
    });
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
    expect(errorAfter((f) => (f.project.backgrounds[0].opacity = 1.5))).toEqual({
      code: "invalidField",
      path: "project.backgrounds[0].opacity",
    });
  });

  it("rejects out-of-range background image corrections", () => {
    expect(errorAfter((f) => (f.project.backgrounds[0].brightness = 2))).toEqual({
      code: "invalidField",
      path: "project.backgrounds[0].brightness",
    });
    expect(errorAfter((f) => (f.project.backgrounds[0].contrast = -101))).toEqual({
      code: "invalidField",
      path: "project.backgrounds[0].contrast",
    });
  });

  it("rejects a zero-sized background", () => {
    expect(errorAfter((f) => (f.project.backgrounds[0].widthM = 0))).toEqual({
      code: "invalidField",
      path: "project.backgrounds[0].widthM",
    });
  });

  it("rejects an unknown calibration source", () => {
    expect(errorAfter((f) => (f.project.calibration.source = { type: "vibes" }))).toEqual({
      code: "invalidField",
      path: "project.calibration.source.type",
    });
  });

  it("rejects layers that aren't an array", () => {
    expect(errorAfter((f) => (f.project.layers = {}))).toEqual({
      code: "invalidField",
      path: "project.layers",
    });
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
      expect(result.error).toEqual({
        code: "invalidField",
        path: "project.objects[3].pointsM[1].yM",
      });
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
    const url =
      "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const project = addBackground(
      createEmptyProject({ name: "Fond" }),
      createBackgroundImage({ url, widthPx: 1, heightPx: 1, xM: 0, yM: 0, widthM: 1, heightM: 1 }),
    );
    expect(roundTrip(project).backgrounds[0]?.url).toBe(url);
  });
});

describe("schema version 1 → 2 migration (KL-029)", () => {
  /** A project file exactly as builds up to KL-028 wrote it: one `background`, no `backgrounds`. */
  function version1File() {
    const project = addBackground(
      createEmptyProject({ name: "Ancien plan" }),
      createBackgroundImage({
        name: "Plan cadastral",
        url: "data:image/png;base64,legacy",
        widthPx: 800,
        heightPx: 600,
        xM: 1,
        yM: 2,
        widthM: 80,
        heightM: 60,
      }),
    );
    const [background] = project.backgrounds;
    const file = JSON.parse(serializeProject(project)) as {
      schemaVersion: number;
      project: Record<string, unknown>;
    };
    file.schemaVersion = 1;
    file.project.background = background;
    delete file.project.backgrounds;
    return file;
  }

  it("reads an old single background into a one-element stack", () => {
    const result = parseProjectFile(version1File());
    if (!result.ok) throw new Error(`fichier refusé : ${JSON.stringify(result.error)}`);
    expect(result.file.project.backgrounds).toHaveLength(1);
    expect(result.file.project.backgrounds[0]).toMatchObject({
      name: "Plan cadastral",
      widthM: 80,
      heightM: 60,
      xM: 1,
      yM: 2,
    });
  });

  it("reads an old file that had no background at all as an empty stack", () => {
    const file = version1File();
    file.project.background = null;
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error(`fichier refusé : ${JSON.stringify(result.error)}`);
    expect(result.file.project.backgrounds).toEqual([]);
  });

  it("refuses a file from a *newer* schema rather than silently dropping what it doesn't understand", () => {
    const file = version1File();
    file.schemaVersion = SCHEMA_VERSION + 1;
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      code: "unsupportedVersion",
      found: SCHEMA_VERSION + 1,
      supported: SCHEMA_VERSION,
    });
  });

  it("names a background that never had a name, rather than leaving a blank row", () => {
    const file = version1File();
    delete (file.project.background as Record<string, unknown>).name;
    const result = parseProjectFile(file);
    if (!result.ok) throw new Error(`fichier refusé : ${JSON.stringify(result.error)}`);
    expect(result.file.project.backgrounds[0]?.name).toBe("Fond de plan");
  });
});

describe("stand grids (KL-038)", () => {
  /** A marquee carrying a grid, in a project ready to round-trip. */
  function marqueeWithStands(stands: unknown): Project {
    const project = createEmptyProject({ name: "Virade" });
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    const marquee = createRectangleObject({
      layerId: layer.id,
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 20,
      heightM: 10,
    });
    return addObject(project, { ...marquee, stands } as typeof marquee);
  }

  const validGrid = {
    columns: 2,
    rows: 2,
    gapM: 0.8,
    marginM: 0,
    labels: ["Boulanger", "", "Fromager", "Bar"],
  };

  it("keeps a grid and its labels through a save and a reload", () => {
    const project = marqueeWithStands(validGrid);
    const reloaded = roundTrip(project);
    expect(reloaded.objects[0]).toMatchObject({ stands: validGrid });
  });

  it("keeps an empty cell empty rather than dropping it", () => {
    // The blank is meaningful: it is how a technical corner is expressed.
    const reloaded = roundTrip(marqueeWithStands(validGrid));
    const stands = reloaded.objects[0]?.type === "rectangle" ? reloaded.objects[0].stands : null;
    expect(stands?.labels).toEqual(["Boulanger", "", "Fromager", "Bar"]);
  });

  it("reads a rectangle that has no grid, which is nearly all of them", () => {
    const project = createEmptyProject({ name: "Nu" });
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    const bare = addObject(
      project,
      createRectangleObject({
        layerId: layer.id,
        name: "Caisse",
        xM: 0,
        yM: 0,
        widthM: 1,
        heightM: 1,
      }),
    );
    expect(roundTrip(bare)).toEqual(bare);
  });

  it("refuses a labels array that does not match the grid", () => {
    // Padding it would silently move the user's text into the wrong
    // squares, which is worse than saying where the file is wrong.
    const result = parseProjectFile(
      toProjectFile(marqueeWithStands({ ...validGrid, labels: ["A1", "A2"] })),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe("invalidField");
  });

  it("refuses a fractional or empty grid", () => {
    for (const broken of [
      { ...validGrid, columns: 2.5 },
      { ...validGrid, columns: 0 },
      { ...validGrid, rows: -1 },
    ]) {
      expect(parseProjectFile(toProjectFile(marqueeWithStands(broken))).ok).toBe(false);
    }
  });

  it("refuses a negative aisle or walkway", () => {
    for (const broken of [
      { ...validGrid, gapM: -1 },
      { ...validGrid, marginM: -0.5 },
    ]) {
      expect(parseProjectFile(toProjectFile(marqueeWithStands(broken))).ok).toBe(false);
    }
  });

  it("refuses a label that is not text", () => {
    const result = parseProjectFile(
      toProjectFile(marqueeWithStands({ ...validGrid, labels: ["A1", 2, "A3", "A4"] })),
    );
    expect(result.ok).toBe(false);
  });

  it("defaults the stands switch on a labelDisplay written before KL-038", () => {
    // Every file up to KL-037 lacks the key. Missing is not corrupt.
    const file = JSON.parse(JSON.stringify(toProjectFile(createDemoProject())));
    file.project.labelDisplay = { name: true, dimensions: true, reference: false, quantity: false };
    const result = parseProjectFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.project.labelDisplay?.stands).toBe(true);
  });

  it("still refuses a labelDisplay whose stands key is present but not a boolean", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(createDemoProject())));
    file.project.labelDisplay = {
      name: true,
      dimensions: true,
      reference: false,
      quantity: false,
      stands: "oui",
    };
    expect(parseProjectFile(file).ok).toBe(false);
  });
});

describe("symbols (KL-044)", () => {
  function projectWithSymbol(character: string): Project {
    const project = createEmptyProject({ name: "Symboles" });
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    return addObject(
      project,
      createSymbolObject({
        layerId: layer.id,
        name: "Secours",
        xM: 3,
        yM: -1,
        character,
        sizeM: 1.5,
      }),
    );
  }

  it("round-trips a symbol with its character and its size", () => {
    const project = projectWithSymbol("✚");
    const result = parseProjectFile(JSON.parse(serializeProject(project)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.project).toEqual(project);
  });

  it("refuses a character the app cannot print", () => {
    // It would draw on screen and leave a hole on paper — a file that
    // reads fine and prints wrong is worse than one that refuses.
    const file = JSON.parse(JSON.stringify(toProjectFile(projectWithSymbol("✚"))));
    file.project.objects[0].character = "🐙";
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual({
        code: "invalidField",
        path: "project.objects[0].character",
      });
  });

  it("refuses a symbol with no size", () => {
    const file = JSON.parse(JSON.stringify(toProjectFile(projectWithSymbol("★"))));
    file.project.objects[0].sizeM = 0;
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual({
        code: "invalidField",
        path: "project.objects[0].sizeM",
      });
  });
});

describe("electrical objects (KL-045)", () => {
  function wiredProject(): Project {
    const project = createEmptyProject({ name: "Réseau" });
    const layer = getDefaultTargetLayer(project.layers);
    if (!layer) throw new Error("no default layer");
    const source = createDeviceObject({
      role: "source",
      center: { xM: 0, yM: 0 },
      layerId: layer.id,
      name: "Groupe",
    });
    const board = createDeviceObject({
      role: "board",
      center: { xM: 20, yM: 0 },
      layerId: layer.id,
      name: "Coffret",
    });
    const load = createDeviceObject({
      role: "load",
      center: { xM: 30, yM: 0 },
      layerId: layer.id,
      name: "Frigo",
    });
    const strip = createDeviceObject({
      role: "strip",
      center: { xM: 30, yM: 10 },
      layerId: layer.id,
      name: "Multiprise",
    });
    const cable = createCableObject({
      anchor: { xM: 0, yM: 0 },
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 20, yM: 0 },
      ],
      layerId: layer.id,
      name: "Câble",
    });
    const plugged = {
      ...cable,
      electrical: { ...cable.electrical, fromId: source.id, toId: board.id, lengthM: 24 },
    };
    return [source, board, load, strip, plugged].reduce(addObject, project);
  }

  const firstFile = () => JSON.parse(JSON.stringify(toProjectFile(wiredProject())));

  it("round-trips every role with its characteristics and its connections", () => {
    const project = wiredProject();
    const result = parseProjectFile(JSON.parse(serializeProject(project)));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.project).toEqual(project);
  });

  it("refuses a role the shape cannot carry", () => {
    // A cable on a rectangle is nothing the app can draw or reason about.
    const file = firstFile();
    file.project.objects[1].electrical = {
      role: "cable",
      phases: "mono",
      sectionMm2: 2.5,
      ratingA: 16,
    };
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual({
        code: "invalidField",
        path: "project.objects[1].electrical.role",
      });
  });

  it("refuses characteristics that would feed the checks nonsense", () => {
    for (const [index, key, value] of [
      [0, "phases", "biphasé"],
      [1, "ratingA", "63"],
      [4, "sectionMm2", 0],
      [3, "outlets", 2.5],
      [2, "powerW", -100],
    ] as const) {
      const file = firstFile();
      file.project.objects[index].electrical[key] = value;
      const result = parseProjectFile(file);
      expect(result.ok, `${key} = ${String(value)}`).toBe(false);
      if (!result.ok)
        expect(result.error).toEqual({
          code: "invalidField",
          path: `project.objects[${index}].electrical.${key}`,
        });
    }
  });

  it("refuses a coffret socket group of no sockets", () => {
    const file = firstFile();
    file.project.objects[1].electrical.outputs[0].count = 0;
    const result = parseProjectFile(file);
    expect(result.ok).toBe(false);
    if (!result.ok)
      expect(result.error).toEqual({
        code: "invalidField",
        path: "project.objects[1].electrical.outputs[0].count",
      });
  });

  it("keeps a cable naming a device that is no longer there", () => {
    // An unplugged end is a legitimate state; one deleted coffret must not
    // cost the whole plan.
    const file = firstFile();
    file.project.objects[4].electrical.toId = "obj_gone";
    const result = parseProjectFile(file);
    expect(result.ok).toBe(true);
  });

  it("reads a label setting written before the electrical switch existed as on", () => {
    const file = firstFile();
    file.project.labelDisplay = {
      name: true,
      dimensions: true,
      reference: false,
      quantity: false,
      stands: true,
    };
    const result = parseProjectFile(file);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.file.project.labelDisplay?.electrical).toBe(true);
  });
});
