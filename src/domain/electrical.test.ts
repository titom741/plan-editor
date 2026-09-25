import { describe, expect, it } from "vitest";
import { duplicateObjects } from "./clipboard";
import { DEFAULT_LABEL_DISPLAY } from "./display";
import {
  analyzeNetwork,
  cableDesignation,
  cableLengthM,
  createCableObject,
  createDeviceObject,
  currentForPowerA,
  deviceCaptionAnchorLocal,
  directLoadSocket,
  deviceCenterWorld,
  electricalLayerId,
  electricalSummary,
  flattenNetwork,
  isCable,
  maxRatingForSectionA,
  minSectionForRatingMm2,
  ratingPowerKva,
  reconcileCables,
  rolesForType,
  sizeCableForDevices,
  voltageDropPct,
  type BoardSpec,
  type CableObject,
  type DeviceObject,
  type DeviceSpec,
  type DirectLoad,
  type ElectricalIssue,
} from "./electrical";
import { objectLocalToWorld, worldToObjectLocal } from "./geometry";
import { getObjectDisplayLabel, nextObjectName } from "./labels";
import { buildSchedule } from "./catalog";
import { createLineObject } from "./objects";
import { addObject, createEmptyProject, patchObject } from "./project";
import type { PlanObject, PointM, Project } from "./types";

const LAYER = "layer-elec";

function project(...objects: PlanObject[]): Project {
  return { ...createEmptyProject({ name: "Réseau" }), objects };
}

function device<S extends DeviceSpec>(
  name: string,
  center: PointM,
  spec?: S,
): DeviceObject & { electrical: S } {
  const created = createDeviceObject({
    role: spec?.role ?? "board",
    center,
    layerId: LAYER,
    name,
  });
  return { ...created, electrical: spec ?? created.electrical } as DeviceObject & {
    electrical: S;
  };
}

function cable(
  name: string,
  from: PointM,
  to: PointM,
  spec: Partial<CableObject["electrical"]> = {},
): CableObject {
  const created = createCableObject({
    anchor: from,
    pointsM: [
      { xM: 0, yM: 0 },
      { xM: to.xM - from.xM, yM: to.yM - from.yM },
    ],
    layerId: LAYER,
    name,
  });
  return { ...created, electrical: { ...created.electrical, ...spec } };
}

/** Adds `objects` to `base` as one edit, the way the editor does, and reconciles. */
function addAll(base: Project, ...objects: PlanObject[]): Project {
  return reconcileCables(base, objects.reduce(addObject, base));
}

function endWorld(object: PlanObject, index: 0 | -1): PointM {
  if (object.type !== "line") throw new Error("not a line");
  const point = index === 0 ? object.pointsM[0] : object.pointsM.at(-1);
  return objectLocalToWorld(object, point!);
}

function find(p: Project, id: string): PlanObject {
  const object = p.objects.find((candidate) => candidate.id === id);
  if (!object) throw new Error(`no object ${id}`);
  return object;
}

const boardSpec = (object: DeviceObject) => object.electrical as BoardSpec;

const messages = (issues: readonly ElectricalIssue[], objectId?: string) =>
  issues.filter((issue) => !objectId || issue.objectId === objectId).map((issue) => issue.message);

describe("sizing tables", () => {
  it("pairs each protection with the section event electricians use", () => {
    expect(maxRatingForSectionA(2.5)).toBe(20);
    expect(maxRatingForSectionA(6)).toBe(32);
    expect(maxRatingForSectionA(16)).toBe(63);
    expect(minSectionForRatingMm2(10)).toBe(1.5);
    expect(minSectionForRatingMm2(16)).toBe(2.5);
    expect(minSectionForRatingMm2(32)).toBe(6);
    expect(minSectionForRatingMm2(63)).toBe(16);
    expect(minSectionForRatingMm2(125)).toBe(35);
  });

  it("gives a section off the table the value of the next one down, and nothing below the table", () => {
    expect(maxRatingForSectionA(8)).toBe(32);
    expect(maxRatingForSectionA(1)).toBe(0);
    expect(minSectionForRatingMm2(400)).toBeNull();
  });

  it("turns watts into amperes with a pessimistic power factor, balanced over three phases", () => {
    expect(currentForPowerA(2300, "mono")).toBeCloseTo(2300 / (230 * 0.9));
    expect(currentForPowerA(6000, "tri")).toBeCloseTo(6000 / (Math.sqrt(3) * 400 * 0.9));
    expect(currentForPowerA(0, "tri")).toBe(0);
  });

  it("states what a supply can deliver in kVA", () => {
    expect(ratingPowerKva(63, "tri")).toBeCloseTo(43.65, 1);
    expect(ratingPowerKva(16, "mono")).toBeCloseTo(3.68, 2);
  });

  it("computes the resistive voltage drop, out and back in single-phase", () => {
    // 2 × 0.0225 × 50 × 16 / 2.5 = 14.4 V on 230 V.
    expect(voltageDropPct("mono", 50, 16, 2.5)).toBeCloseTo((14.4 / 230) * 100);
    // √3 × 0.0225 × 50 × 100 / 16 on 400 V.
    expect(voltageDropPct("tri", 50, 100, 16)).toBeCloseTo(
      ((Math.sqrt(3) * 0.0225 * 50 * 100) / 16 / 400) * 100,
    );
    expect(voltageDropPct("mono", 50, 0, 2.5)).toBe(0);
  });
});

describe("reading electrical objects", () => {
  it("offers device roles to rectangles and circles, the cable to lines, nothing to the rest", () => {
    expect(rolesForType("rectangle")).toEqual(["source", "board", "strip", "load"]);
    expect(rolesForType("circle")).toContain("load");
    expect(rolesForType("line")).toEqual(["cable"]);
    expect(rolesForType("text")).toEqual([]);
    expect(rolesForType("symbol")).toEqual([]);
  });

  it("names a cable the way it is sold", () => {
    expect(cableDesignation({ phases: "tri", sectionMm2: 16 })).toBe("5G16");
    expect(cableDesignation({ phases: "mono", sectionMm2: 2.5 })).toBe("3G2.5");
  });

  it("measures a cable along its drawing unless a laid length was typed", () => {
    const run = cable("C", { xM: 0, yM: 0 }, { xM: 30, yM: 40 });
    expect(cableLengthM(run)).toBeCloseTo(50);
    expect(cableLengthM({ ...run, electrical: { ...run.electrical, lengthM: 62 } })).toBe(62);
  });

  it("summarises each role in one printable line", () => {
    const source = device(
      "G",
      { xM: 0, yM: 0 },
      {
        role: "source",
        kind: "generator",
        phases: "tri",
        ratingA: 80,
      },
    );
    expect(electricalSummary(source)).toBe("Groupe électrogène · 80 A tri");
    const board = device("C", { xM: 0, yM: 0 });
    expect(electricalSummary(board)).toBe("63 A tri · Diff. 30 mA");
    expect(
      electricalSummary({ ...board, electrical: { ...boardSpec(board), rcdMa: undefined } }),
    ).toBe("63 A tri");
    expect(electricalSummary(cable("K", { xM: 0, yM: 0 }, { xM: 1, yM: 0 }))).toBe("3G2.5 · 16 A");
    expect(
      electricalSummary(
        device("M", { xM: 0, yM: 0 }, { role: "strip", phases: "mono", outlets: 4, ratingA: 16 }),
      ),
    ).toBe("4 prises 16 A mono");
    expect(
      electricalSummary(
        device("R", { xM: 0, yM: 0 }, { role: "load", phases: "mono", powerW: 3500 }),
      ),
    ).toBe("3.5 kW mono");
    expect(
      electricalSummary(
        device("R", { xM: 0, yM: 0 }, { role: "load", phases: "mono", powerW: 150 }),
      ),
    ).toBe("150 W mono");
  });

  it("keeps summaries within what the PDF's standard fonts can print", () => {
    const board = device("C", { xM: 0, yM: 0 });
    for (const character of electricalSummary(board)!) {
      expect(character.codePointAt(0)!).toBeLessThanOrEqual(0xff);
    }
  });

  it("centres a new device on the click, and hangs its caption from its lower edge", () => {
    const board = device("C", { xM: 10, yM: 5 });
    expect(deviceCenterWorld(board).xM).toBeCloseTo(10);
    expect(deviceCenterWorld(board).yM).toBeCloseTo(5);
    if (board.type !== "rectangle") throw new Error("a coffret is a rectangle");
    expect(deviceCaptionAnchorLocal(board)).toEqual({ xM: board.widthM / 2, yM: board.heightM });
    const load = device("R", { xM: 0, yM: 0 }, { role: "load", phases: "mono", powerW: 1 });
    expect(load.type).toBe("circle");
    if (load.type === "circle")
      expect(deviceCaptionAnchorLocal(load)).toEqual({ xM: 0, yM: load.radiusM });
  });

  it("finds the plan's unlocked electrical layer, and none when it is locked", () => {
    const layers = createEmptyProject({ name: "p" }).layers;
    const elec = layers.find((layer) => layer.name === "Électricité")!;
    expect(electricalLayerId(layers)).toBe(elec.id);
    expect(
      electricalLayerId(
        layers.map((layer) => (layer.id === elec.id ? { ...layer, locked: true } : layer)),
      ),
    ).toBeNull();
  });
});

describe("labels and names", () => {
  it("adds the electrical line under the name, and drops it when switched off", () => {
    const board = device("Coffret 1", { xM: 0, yM: 0 });
    expect(getObjectDisplayLabel(board, { ...DEFAULT_LABEL_DISPLAY, dimensions: false })).toBe(
      "Coffret 1\n63 A tri · Diff. 30 mA",
    );
    expect(
      getObjectDisplayLabel(board, {
        ...DEFAULT_LABEL_DISPLAY,
        dimensions: false,
        electrical: false,
      }),
    ).toBe("Coffret 1");
  });

  it("states a cable's laid length as its dimension", () => {
    const run = cable("Câble 1", { xM: 0, yM: 0 }, { xM: 10, yM: 0 }, { lengthM: 14 });
    expect(getObjectDisplayLabel(run, DEFAULT_LABEL_DISPLAY)).toBe("Câble 1\n14 m\n3G2.5 · 16 A");
  });

  it("counts coffrets as coffrets, not as rectangles", () => {
    const p = project(device("Coffret 1", { xM: 0, yM: 0 }));
    expect(nextObjectName(p, "board")).toBe("Coffret 2");
    expect(nextObjectName(p, "rectangle")).toBe("Rectangle 1");
    expect(nextObjectName(p, "cable")).toBe("Câble 1");
  });
});

describe("reconcileCables", () => {
  const src = device(
    "Groupe",
    { xM: 0, yM: 0 },
    {
      role: "source",
      kind: "generator",
      phases: "tri",
      ratingA: 63,
    },
  );
  const board = device("Coffret", { xM: 20, yM: 0 });
  const base = project(src, board);

  it("plugs a new cable into the devices its ends were drawn on, onto their centres", () => {
    const run = cable("K", { xM: 0.5, yM: 0.3 }, { xM: 19.8, yM: -0.1 });
    const after = addAll(base, run);
    const plugged = find(after, run.id) as CableObject;
    expect(plugged.electrical.fromId).toBe(src.id);
    expect(plugged.electrical.toId).toBe(board.id);
    expect(endWorld(plugged, 0).xM).toBeCloseTo(0);
    expect(endWorld(plugged, 0).yM).toBeCloseTo(0);
    expect(endWorld(plugged, -1).xM).toBeCloseTo(20);
  });

  it("accepts an end dropped just outside a device, within the tolerance", () => {
    // The groupe is 2.2 m wide, so its edge is at x = 1.1; 1.3 is 0.2 m off.
    const run = cable("K", { xM: 1.3, yM: 0 }, { xM: 10, yM: 0 });
    const plugged = find(addAll(base, run), run.id) as CableObject;
    expect(plugged.electrical.fromId).toBe(src.id);
    expect(plugged.electrical.toId).toBeUndefined();
  });

  it("leaves a cable drawn in open ground unplugged and where it was drawn", () => {
    const run = cable("K", { xM: 5, yM: 5 }, { xM: 10, yM: 5 });
    const after = addAll(base, run);
    const unplugged = find(after, run.id) as CableObject;
    expect(unplugged.electrical.fromId).toBeUndefined();
    expect(unplugged.pointsM).toEqual(run.pointsM);
  });

  it("drags the cable's end along when its device moves", () => {
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const plugged = addAll(base, run);
    const moved = reconcileCables(
      plugged,
      patchObject(plugged, board.id, { xM: board.xM + 3, yM: board.yM + 4 }),
    );
    const followed = find(moved, run.id) as CableObject;
    expect(endWorld(followed, -1).xM).toBeCloseTo(23);
    expect(endWorld(followed, -1).yM).toBeCloseTo(4);
    // The other end, whose device stayed put, didn't budge.
    expect(endWorld(followed, 0).xM).toBeCloseTo(0);
    expect(followed.electrical.toId).toBe(board.id);
  });

  it("follows correctly when the cable itself is rotated", () => {
    // A cable turned by 30°, whose local end is chosen so that it still
    // lands on the coffret in world coordinates.
    const straight = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const run = {
      ...straight,
      rotationDeg: 30,
      pointsM: [
        { xM: 0, yM: 0 },
        worldToObjectLocal({ xM: 0, yM: 0, rotationDeg: 30 }, { xM: 20, yM: 0 }),
      ],
    };
    const plugged = addAll(base, run);
    const moved = reconcileCables(plugged, patchObject(plugged, board.id, { yM: board.yM + 10 }));
    const followed = find(moved, run.id) as CableObject;
    expect(endWorld(followed, -1).xM).toBeCloseTo(20);
    expect(endWorld(followed, -1).yM).toBeCloseTo(10);
  });

  it("unplugs an end dragged into open ground, and re-plugs one dragged onto another device", () => {
    const other = device("Coffret B", { xM: 20, yM: 20 });
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const plugged = addAll(project(src, board, other), run);
    const line = find(plugged, run.id) as CableObject;

    const toGround = reconcileCables(
      plugged,
      patchObject(plugged, run.id, { pointsM: [line.pointsM[0]!, { xM: 10, yM: 10 }] }),
    );
    const loose = find(toGround, run.id) as CableObject;
    expect(loose.electrical.toId).toBeUndefined();
    expect(endWorld(loose, -1)).toEqual({ xM: 10, yM: 10 });

    const toOther = reconcileCables(
      plugged,
      patchObject(plugged, run.id, { pointsM: [line.pointsM[0]!, { xM: 20.2, yM: 19.9 }] }),
    );
    const replugged = find(toOther, run.id) as CableObject;
    expect(replugged.electrical.toId).toBe(other.id);
    expect(endWorld(replugged, -1).xM).toBeCloseTo(20);
    expect(endWorld(replugged, -1).yM).toBeCloseTo(20);
  });

  it("honours a device picked in the panel, even far from where the end was", () => {
    const other = device("Coffret B", { xM: 50, yM: 50 });
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const plugged = addAll(project(src, board, other), run);
    const line = find(plugged, run.id) as CableObject;
    const picked = reconcileCables(
      plugged,
      patchObject(plugged, run.id, { electrical: { ...line.electrical, toId: other.id } }),
    );
    const moved = find(picked, run.id) as CableObject;
    expect(moved.electrical.toId).toBe(other.id);
    expect(endWorld(moved, -1).xM).toBeCloseTo(50);
  });

  it("unplugs an end whose device was deleted", () => {
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const plugged = addAll(base, run);
    const deleted = {
      ...plugged,
      objects: plugged.objects.filter((object) => object.id !== board.id),
    };
    const after = find(reconcileCables(plugged, deleted), run.id) as CableObject;
    expect(after.electrical.toId).toBeUndefined();
    expect(after.electrical.fromId).toBe(src.id);
  });

  it("never plugs both ends into the same device", () => {
    const run = cable("K", { xM: -0.5, yM: 0 }, { xM: 0.5, yM: 0 });
    const after = find(addAll(base, run), run.id) as CableObject;
    expect(after.electrical.fromId).toBe(src.id);
    expect(after.electrical.toId).toBeUndefined();
    // Collapsing the cable onto one centre would have made it vanish.
    expect(endWorld(after, -1).xM).toBeCloseTo(0.5);
  });

  it("returns the very same project when there is nothing to settle", () => {
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const plugged = addAll(base, run);
    const renamed = patchObject(plugged, src.id, { name: "Groupe 2" });
    expect(reconcileCables(plugged, renamed)).toBe(renamed);
    expect(reconcileCables(null, base)).toBe(base);
  });

  it("treats a line just turned into a cable as a new cable", () => {
    const line = createLineObject({
      layerId: LAYER,
      name: "Ligne",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 20, yM: 0.1 },
      ],
    });
    const before = project(src, board, line);
    const after = reconcileCables(
      before,
      patchObject(before, line.id, {
        electrical: { role: "cable", phases: "tri", sectionMm2: 16, ratingA: 63 },
      }),
    );
    const turned = find(after, line.id) as CableObject;
    expect(turned.electrical.fromId).toBe(src.id);
    expect(turned.electrical.toId).toBe(board.id);
  });
});

describe("copies", () => {
  const src = device(
    "Groupe",
    { xM: 0, yM: 0 },
    {
      role: "source",
      kind: "generator",
      phases: "tri",
      ratingA: 63,
    },
  );
  const board = device("Coffret", { xM: 20, yM: 0 });
  it("plugs a cable copied with its devices into the copies, and unplugs one copied alone", () => {
    const wired = addAll(project(src, board), cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 }));
    const context = {
      offsetM: { xM: 1, yM: 1 },
      existingLayerIds: new Set([LAYER]),
      fallbackLayerId: LAYER,
    };

    const all = duplicateObjects(wired.objects, context);
    const copiedCable = all.find(isCable)!;
    const copiedIds = new Set(all.map((object) => object.id));
    expect(copiedIds.has(copiedCable.electrical.fromId!)).toBe(true);
    expect(copiedIds.has(copiedCable.electrical.toId!)).toBe(true);

    const alone = duplicateObjects(wired.objects.filter(isCable), context)[0] as CableObject;
    expect(alone.electrical.fromId).toBeUndefined();
    expect(alone.electrical.toId).toBeUndefined();
  });
});

describe("sizeCableForDevices", () => {
  const src = device(
    "Groupe",
    { xM: 0, yM: 0 },
    {
      role: "source",
      kind: "generator",
      phases: "tri",
      ratingA: 125,
    },
  );

  function sized(target: DeviceObject, drawnFromSource = true) {
    const run = drawnFromSource
      ? cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 })
      : cable("K", { xM: 20, yM: 0 }, { xM: 0, yM: 0 });
    const wired = addAll(project(src, target), run);
    return find(sizeCableForDevices(wired, run.id), run.id) as CableObject;
  }

  it("sizes a cable to the coffret it feeds, whichever way it was drawn", () => {
    const board = device("Coffret", { xM: 20, yM: 0 });
    for (const direction of [true, false]) {
      const run = sized(board, direction);
      expect(run.electrical).toMatchObject({ phases: "tri", ratingA: 63, sectionMm2: 16 });
      expect(run.style?.stroke).toBe("#dc2626");
    }
  });

  it("feeds a power strip in single-phase and a load at the rating its power needs", () => {
    expect(
      sized(
        device("M", { xM: 20, yM: 0 }, { role: "strip", phases: "mono", outlets: 6, ratingA: 16 }),
      ).electrical,
    ).toMatchObject({ phases: "mono", ratingA: 16, sectionMm2: 2.5 });
    // 6 kW single-phase is 26 A on its plate: the 32 A socket, on 6 mm².
    expect(
      sized(device("R", { xM: 20, yM: 0 }, { role: "load", phases: "mono", powerW: 6000 }))
        .electrical,
    ).toMatchObject({ phases: "mono", ratingA: 32, sectionMm2: 6 });
  });

  it("puts a drawn fryer on the 16 A socket it would take if listed", () => {
    expect(
      sized(device("F", { xM: 20, yM: 0 }, { role: "load", phases: "mono", powerW: 3500 }))
        .electrical,
    ).toMatchObject({ phases: "mono", ratingA: 16, sectionMm2: 2.5 });
  });

  it("leaves a cable that feeds nothing as it was drawn", () => {
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 50, yM: 50 });
    const wired = addAll(project(src), run);
    expect(sizeCableForDevices(wired, run.id)).toBe(wired);
  });
});

describe("analyzeNetwork", () => {
  const src = device(
    "Groupe",
    { xM: 0, yM: 0 },
    {
      role: "source",
      kind: "generator",
      phases: "tri",
      ratingA: 63,
    },
  );
  const board = device("Coffret", { xM: 20, yM: 0 });
  const strip = device(
    "Multiprise",
    { xM: 20, yM: 20 },
    { role: "strip", phases: "mono", outlets: 2, ratingA: 16 },
  );
  const fryer = device(
    "Friteuse",
    { xM: 40, yM: 20 },
    { role: "load", phases: "mono", powerW: 2000 },
  );
  const fridge = device("Frigo", { xM: 40, yM: 30 }, { role: "load", phases: "mono", powerW: 500 });

  const main = cable(
    "Principal",
    { xM: 0, yM: 0 },
    { xM: 20, yM: 0 },
    { phases: "tri", sectionMm2: 16, ratingA: 63 },
  );
  const toStrip = cable(
    "Rallonge",
    { xM: 20, yM: 0 },
    { xM: 20, yM: 20 },
    { phases: "mono", sectionMm2: 2.5, ratingA: 16 },
  );
  const toFryer = cable("F", { xM: 20, yM: 20 }, { xM: 40, yM: 20 });
  const toFridge = cable("R", { xM: 20, yM: 20 }, { xM: 40, yM: 30 });

  const wired = () =>
    addAll(project(src, board, strip, fryer, fridge), main, toStrip, toFryer, toFridge);

  it("reads the network as a tree from the source, and adds the loads up", () => {
    const network = analyzeNetwork(wired());
    expect(network.trees).toHaveLength(1);
    const names = flattenNetwork(network.trees).map((node) => `${node.depth}:${node.device.name}`);
    expect(names).toEqual(["0:Groupe", "1:Coffret", "2:Multiprise", "3:Frigo", "3:Friteuse"]);
    expect(network.totalLoadW).toBe(2500);
    const stripNode = flattenNetwork(network.trees).find((node) => node.device.id === strip.id)!;
    expect(stripNode.loadW).toBe(2500);
    expect(stripNode.supplyPhases).toBe("mono");
    expect(stripNode.currentA).toBeCloseTo(currentForPowerA(2500, "mono"));
    expect(network.unfed).toEqual([]);
    expect(network.looseCables).toEqual([]);
  });

  it("accumulates the voltage drop from the source down", () => {
    const nodes = flattenNetwork(analyzeNetwork(wired()).trees);
    const at = (id: string) => nodes.find((node) => node.device.id === id)!;
    const boardDrop = voltageDropPct("tri", 20, currentForPowerA(2500, "tri"), 16);
    const stripDrop = boardDrop + voltageDropPct("mono", 20, currentForPowerA(2500, "mono"), 2.5);
    expect(at(src.id).dropPct).toBe(0);
    expect(at(board.id).dropPct).toBeCloseTo(boardDrop);
    expect(at(strip.id).dropPct).toBeCloseTo(stripDrop);
    expect(at(fryer.id).dropPct).toBeGreaterThan(stripDrop);
  });

  it("finds nothing wrong with a sound installation", () => {
    expect(analyzeNetwork(wired()).issues).toEqual([]);
  });

  it("totals the cable to buy by designation, thinnest first", () => {
    const totals = analyzeNetwork(wired()).cableTotals;
    expect(totals.map((total) => [total.designation, total.count])).toEqual([
      ["3G2.5", 3],
      ["5G16", 1],
    ]);
    expect(totals[1]!.lengthM).toBeCloseTo(20);
  });

  it("flags a section too thin for its protection, naming the minimum", () => {
    const p = patchObject(wired(), main.id, {
      electrical: { ...(find(wired(), main.id) as CableObject).electrical, sectionMm2: 6 },
    });
    expect(messages(analyzeNetwork(p).issues, main.id)).toContain(
      "Section 6 mm² insuffisante pour 63 A (16 mm² minimum).",
    );
  });

  it("flags a three-phase device fed in single-phase, and a strip fed in three-phase", () => {
    const monoMain = patchObject(wired(), main.id, {
      electrical: { ...(find(wired(), main.id) as CableObject).electrical, phases: "mono" },
    });
    expect(messages(analyzeNetwork(monoMain).issues, board.id)).toContain(
      "Coffret est triphasé mais alimenté en monophasé.",
    );
    const triStrip = patchObject(wired(), toStrip.id, {
      electrical: { ...(find(wired(), toStrip.id) as CableObject).electrical, phases: "tri" },
    });
    expect(messages(analyzeNetwork(triStrip).issues, strip.id)).toContain(
      "Une multiprise monophasée se branche sur un départ monophasé.",
    );
  });

  it("flags a three-phase cable leaving a device that only has single-phase", () => {
    const triOut = patchObject(wired(), toFryer.id, {
      electrical: { ...(find(wired(), toFryer.id) as CableObject).electrical, phases: "tri" },
    });
    const issues = messages(analyzeNetwork(triOut).issues, toFryer.id);
    expect(issues).toContain("Câble triphasé sur Multiprise, qui n'est alimenté qu'en monophasé.");
    expect(issues).toContain("Une multiprise monophasée ne délivre que du monophasé.");
  });

  it("flags an overload on the cable and on the device", () => {
    const hungry = patchObject(wired(), fryer.id, {
      electrical: { role: "load", phases: "mono", powerW: 5000 },
    });
    const issues = analyzeNetwork(hungry).issues;
    // 5.5 kW single-phase is 26.6 A on a 16 A extension and a 16 A strip.
    expect(messages(issues, toStrip.id)).toContain("Surcharge : 26.6 A pour un départ 16 A.");
    expect(messages(issues, strip.id)).toContain("Surcharge : 26.6 A pour 16 A disponibles.");
    expect(issues.find((issue) => issue.objectId === strip.id)?.severity).toBe("error");
  });

  it("flags a socket rated above the device it leaves", () => {
    const big = patchObject(wired(), toFryer.id, {
      electrical: {
        ...(find(wired(), toFryer.id) as CableObject).electrical,
        ratingA: 32,
        sectionMm2: 6,
      },
    });
    expect(messages(analyzeNetwork(big).issues, toFryer.id)).toContain(
      "Départ 32 A sur Multiprise, protégé à 16 A.",
    );
  });

  it("flags too many cables for a strip's outlets and for a coffret's sockets", () => {
    const lamp = device("Lampe", { xM: 40, yM: 40 }, { role: "load", phases: "mono", powerW: 100 });
    const third = cable("L", { xM: 20, yM: 20 }, { xM: 40, yM: 40 });
    const crowded = addAll(wired(), lamp, third);
    expect(messages(analyzeNetwork(crowded).issues, strip.id)).toContain(
      "3 branchements pour 2 prises.",
    );

    const onlyTri = patchObject(wired(), board.id, {
      electrical: { ...boardSpec(board), outputs: [{ phases: "tri", ratingA: 32, count: 1 }] },
    });
    expect(messages(analyzeNetwork(onlyTri).issues, board.id)).toContain(
      "1 départ(s) 16 A mono pour 0 prise(s).",
    );
  });

  it("does not count sockets on a coffret whose sockets were never described", () => {
    const undescribed = patchObject(wired(), board.id, {
      electrical: { ...boardSpec(board), outputs: [] },
    });
    expect(analyzeNetwork(undescribed).issues).toEqual([]);
  });

  it("asks for a 30 mA RCD on a coffret feeding sockets up to 32 A", () => {
    const { rcdMa: _omit, ...withoutRcd } = board.electrical as Extract<
      DeviceSpec,
      { role: "board" }
    >;
    const bare = patchObject(wired(), board.id, { electrical: withoutRcd });
    expect(messages(analyzeNetwork(bare).issues, board.id)[0]).toMatch(
      /^Pas de différentiel 30 mA/,
    );
    const coarse = patchObject(wired(), board.id, { electrical: { ...withoutRcd, rcdMa: 300 } });
    expect(messages(analyzeNetwork(coarse).issues, board.id)[0]).toMatch(
      /^Pas de différentiel 30 mA/,
    );
  });

  it("warns past 5 % of voltage drop", () => {
    const far = patchObject(wired(), toStrip.id, {
      electrical: { ...(find(wired(), toStrip.id) as CableObject).electrical, lengthM: 120 },
    });
    const issue = analyzeNetwork(far).issues.find((candidate) =>
      candidate.message.startsWith("Chute"),
    );
    expect(issue?.severity).toBe("warning");
    expect(issue?.objectId).toBe(strip.id);
  });

  it("reports loose cables, unfed devices, loops and two sources tied together", () => {
    const loose = cable("Seul", { xM: 100, yM: 100 }, { xM: 110, yM: 100 });
    const orphan = device(
      "Orphelin",
      { xM: 200, yM: 200 },
      { role: "load", phases: "mono", powerW: 100 },
    );
    const loop = cable(
      "Boucle",
      { xM: 0, yM: 0 },
      { xM: 20, yM: 20 },
      { phases: "tri", sectionMm2: 16, ratingA: 63 },
    );
    const second = device(
      "Groupe B",
      { xM: 60, yM: 0 },
      {
        role: "source",
        kind: "grid",
        phases: "tri",
        ratingA: 63,
      },
    );
    const tie = cable(
      "Couplage",
      { xM: 20, yM: 0 },
      { xM: 60, yM: 0 },
      { phases: "tri", sectionMm2: 16, ratingA: 63 },
    );
    const network = analyzeNetwork(addAll(wired(), loose, orphan, loop, second, tie));

    expect(network.looseCables.map((c) => c.id)).toEqual([loose.id]);
    expect(messages(network.issues, loose.id)).toEqual([
      "Câble non raccordé à ses deux extrémités.",
    ]);
    expect(network.unfed.map((d) => d.id)).toEqual([orphan.id]);
    expect(network.issues.find((issue) => issue.objectId === orphan.id)?.severity).toBe("info");
    expect(messages(network.issues, loop.id)).toEqual([
      "Boucle : Multiprise et Groupe sont déjà reliés par ailleurs.",
    ]);
    expect(messages(network.issues, tie.id)).toEqual([
      "Relie deux alimentations (Coffret et Groupe B).",
    ]);
    expect(network.trees.map((tree) => tree.device.name)).toEqual(["Groupe", "Groupe B"]);
  });

  it("lists errors before warnings before notes, whatever order they were found in", () => {
    // Found in this order: the loose cable's warning, the orphan's note,
    // then the overloaded strip's errors — which must still come first.
    const loose = cable("Seul", { xM: 100, yM: 100 }, { xM: 110, yM: 100 });
    const orphan = device(
      "Orphelin",
      { xM: 200, yM: 200 },
      { role: "load", phases: "mono", powerW: 100 },
    );
    const hungry = patchObject(wired(), fryer.id, {
      electrical: { role: "load", phases: "mono", powerW: 5000 },
    });
    const rank = (severity: string) => ["error", "warning", "info"].indexOf(severity);
    const severities = analyzeNetwork(addAll(hungry, loose, orphan)).issues.map(
      (issue) => issue.severity,
    );
    expect(severities[0]).toBe("error");
    expect(severities).toContain("warning");
    expect(severities.at(-1)).toBe("info");
    expect(severities).toEqual([...severities].sort((a, b) => rank(a) - rank(b)));
  });

  it("says when the plan has no electricity at all", () => {
    expect(analyzeNetwork(project()).isEmpty).toBe(true);
    expect(analyzeNetwork(wired()).isEmpty).toBe(false);
  });
});

describe("nomenclature", () => {
  it("counts a cable by the metre it runs, even when its unit says m", () => {
    const run = { ...cable("Câble 5G6", { xM: 0, yM: 0 }, { xM: 30, yM: 40 }), unit: "m" };
    const rows = buildSchedule([run]);
    expect(rows).toHaveLength(1);
    expect(rows[0]!.quantity).toBeCloseTo(50);
    expect(rows[0]!.unit).toBe("m");
  });

  it("groups cables by designation, whatever each run is called", () => {
    const rows = buildSchedule([
      cable("Câble 1", { xM: 0, yM: 0 }, { xM: 10, yM: 0 }),
      cable("Câble 2", { xM: 0, yM: 0 }, { xM: 15, yM: 0 }),
      cable("Câble 3", { xM: 0, yM: 0 }, { xM: 20, yM: 0 }, { phases: "tri", sectionMm2: 6 }),
    ]);
    expect(rows.map((row) => [row.name, row.reference, row.quantity])).toEqual([
      ["Câble 3G2.5", "H07RN-F 3G2.5", 25],
      ["Câble 5G6", "H07RN-F 5G6", 20],
    ]);
  });
});

describe("consumers listed on a device (KL-048)", () => {
  const src = device(
    "Groupe",
    { xM: 0, yM: 0 },
    { role: "source", kind: "generator", phases: "tri", ratingA: 63 },
  );
  const listedBoard = (loads: DirectLoad[], outputs: BoardSpec["outputs"] = []) =>
    device(
      "Coffret",
      { xM: 20, yM: 0 },
      { role: "board", phases: "tri", ratingA: 63, rcdMa: 30, outputs, loads },
    );
  const main = () =>
    cable(
      "Principal",
      { xM: 0, yM: 0 },
      { xM: 20, yM: 0 },
      { phases: "tri", sectionMm2: 16, ratingA: 63 },
    );
  const projectors: DirectLoad = { name: "Projecteur", phases: "mono", powerW: 150, quantity: 10 };
  const fryer: DirectLoad = { name: "Friteuse", phases: "mono", powerW: 3500, quantity: 1 };

  it("counts listed consumers in the balance, quantity included", () => {
    const network = analyzeNetwork(addAll(project(src, listedBoard([projectors, fryer])), main()));
    expect(network.totalLoadW).toBe(1500 + 3500);
    const board = flattenNetwork(network.trees).find((node) => node.device.name === "Coffret")!;
    expect(board.loadW).toBe(5000);
    expect(board.currentA).toBeCloseTo(currentForPowerA(5000, "tri"));
  });

  it("adds listed and drawn consumers on the same coffret", () => {
    const drawn = device("Sono", { xM: 40, yM: 0 }, { role: "load", phases: "mono", powerW: 3000 });
    const network = analyzeNetwork(
      addAll(
        project(src, listedBoard([fryer]), drawn),
        main(),
        cable("K", { xM: 20, yM: 0 }, { xM: 40, yM: 0 }),
      ),
    );
    expect(network.totalLoadW).toBe(6500);
  });

  it("gives each consumer the smallest socket that carries its nameplate current", () => {
    // A 3.5 kW fryer draws 15.2 A on its plate: a 16 A socket, not a
    // 20 A one, which is a breaker size and not a socket.
    expect(directLoadSocket({ phases: "mono", powerW: 3500 })).toEqual({
      phases: "mono",
      ratingA: 16,
    });
    // 3680 W is exactly what 16 A carries.
    expect(directLoadSocket({ phases: "mono", powerW: 3680 }).ratingA).toBe(16);
    expect(directLoadSocket({ phases: "mono", powerW: 3700 }).ratingA).toBe(32);
    expect(directLoadSocket({ phases: "mono", powerW: 6000 }).ratingA).toBe(32);
    expect(directLoadSocket({ phases: "tri", powerW: 6000 }).ratingA).toBe(16);
    expect(directLoadSocket({ phases: "tri", powerW: 200000 }).ratingA).toBe(125);
  });

  it("takes one socket per unit, alongside the drawn cables", () => {
    const outputs = [{ phases: "mono" as const, ratingA: 16, count: 6 }];
    const lamp = device("Lampe", { xM: 40, yM: 0 }, { role: "load", phases: "mono", powerW: 100 });
    const crowded = addAll(
      project(src, listedBoard([{ ...projectors, quantity: 5 }], outputs), lamp),
      main(),
      cable("K", { xM: 20, yM: 0 }, { xM: 40, yM: 0 }),
    );
    const board = crowded.objects.find((object) => object.name === "Coffret")!;
    // Five listed units and one cable: every socket taken, none short.
    expect(
      messages(analyzeNetwork(crowded).issues, board.id).filter((m) => m.includes("départ")),
    ).toEqual([]);
    const tooMany = addAll(
      project(src, listedBoard([{ ...projectors, quantity: 6 }], outputs), lamp),
      main(),
      cable("K", { xM: 20, yM: 0 }, { xM: 40, yM: 0 }),
    );
    const tooManyBoard = tooMany.objects.find((object) => object.name === "Coffret")!;
    expect(messages(analyzeNetwork(tooMany).issues, tooManyBoard.id)).toContain(
      "7 départ(s) 16 A mono pour 6 prise(s).",
    );
  });

  it("asks for a 30 mA RCD when only listed consumers use the sockets", () => {
    const bare = device(
      "Coffret",
      { xM: 20, yM: 0 },
      { role: "board", phases: "tri", ratingA: 63, outputs: [], loads: [projectors] },
    );
    const network = analyzeNetwork(addAll(project(src, bare), main()));
    expect(messages(network.issues, bare.id)[0]).toMatch(/^Pas de différentiel 30 mA/);
  });

  it("refuses a three-phase consumer on a strip or on a single-phase supply", () => {
    const strip = device(
      "Multiprise",
      { xM: 20, yM: 0 },
      {
        role: "strip",
        phases: "mono",
        outlets: 6,
        ratingA: 16,
        loads: [{ name: "Chambre froide", phases: "tri", powerW: 6000, quantity: 1 }],
      },
    );
    const onStrip = analyzeNetwork(
      addAll(project(src, strip), cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 })),
    );
    expect(messages(onStrip.issues, strip.id)).toContain(
      "Chambre froide : une multiprise monophasée ne délivre que du monophasé.",
    );

    const monoBoard = device(
      "Coffret mono",
      { xM: 20, yM: 0 },
      {
        role: "board",
        phases: "mono",
        ratingA: 32,
        rcdMa: 30,
        outputs: [],
        loads: [{ name: "Chambre froide", phases: "tri", powerW: 6000, quantity: 1 }],
      },
    );
    const onMono = analyzeNetwork(
      addAll(project(src, monoBoard), cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 })),
    );
    expect(messages(onMono.issues, monoBoard.id)).toContain(
      "Chambre froide est triphasé mais Coffret mono n'est alimenté qu'en monophasé.",
    );
  });

  it("counts listed units against a strip's outlets", () => {
    const strip = device(
      "Multiprise",
      { xM: 20, yM: 0 },
      {
        role: "strip",
        phases: "mono",
        outlets: 4,
        ratingA: 16,
        loads: [{ ...projectors, quantity: 5 }],
      },
    );
    const network = analyzeNetwork(
      addAll(project(src, strip), cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 })),
    );
    expect(messages(network.issues, strip.id)).toContain("5 branchements pour 4 prises.");
  });

  it("says on the plan how many consumers a device carries, and can leave it out", () => {
    const board = listedBoard([projectors, fryer]);
    expect(electricalSummary(board)).toBe("63 A tri · Diff. 30 mA · 11 récepteurs (5 kW)");
    expect(electricalSummary(board, { withListed: false })).toBe("63 A tri · Diff. 30 mA");
    expect(electricalSummary(listedBoard([fryer]))).toBe(
      "63 A tri · Diff. 30 mA · 1 récepteur (3.5 kW)",
    );
  });
});

describe("three-phase power strips (KL-049)", () => {
  const src = device(
    "Groupe",
    { xM: 0, yM: 0 },
    { role: "source", kind: "generator", phases: "tri", ratingA: 63 },
  );
  const triStrip = (loads: DirectLoad[] = []) =>
    device(
      "Multiprise tri",
      { xM: 20, yM: 0 },
      { role: "strip", phases: "tri", outlets: 3, ratingA: 32, loads },
    );
  const feed = (phases: "mono" | "tri") =>
    cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 }, { phases, sectionMm2: 6, ratingA: 32 });
  const coldRoom: DirectLoad = {
    name: "Chambre froide",
    phases: "tri",
    powerW: 6000,
    quantity: 1,
  };

  it("states its phases on the plan", () => {
    expect(electricalSummary(triStrip())).toBe("3 prises 32 A tri");
  });

  it("takes three-phase consumers without complaint when fed in three-phase", () => {
    const network = analyzeNetwork(addAll(project(src, triStrip([coldRoom])), feed("tri")));
    expect(network.issues).toEqual([]);
    expect(network.totalLoadW).toBe(6000);
  });

  it("is a three-phase device: fed in single-phase, it is flagged", () => {
    const strip = triStrip();
    const network = analyzeNetwork(addAll(project(src, strip), feed("mono")));
    expect(messages(network.issues, strip.id)).toContain(
      "Multiprise tri est triphasé mais alimenté en monophasé.",
    );
  });

  it("has only three-phase sockets: a single-phase cable or consumer is refused", () => {
    const strip = triStrip([{ name: "Frigo", phases: "mono", powerW: 500, quantity: 1 }]);
    const lamp = device("Lampe", { xM: 40, yM: 0 }, { role: "load", phases: "mono", powerW: 100 });
    const out = cable("L", { xM: 20, yM: 0 }, { xM: 40, yM: 0 });
    const network = analyzeNetwork(addAll(project(src, strip, lamp), feed("tri"), out));
    expect(messages(network.issues, out.id)).toContain(
      "Une multiprise triphasée n'a que des prises triphasées.",
    );
    expect(messages(network.issues, strip.id)).toContain(
      "Frigo : une multiprise triphasée n'a que des prises triphasées.",
    );
  });

  it("gets a cable sized to it: three-phase, at its rating", () => {
    const run = cable("K", { xM: 0, yM: 0 }, { xM: 20, yM: 0 });
    const wired = addAll(project(src, triStrip()), run);
    const sized = find(sizeCableForDevices(wired, run.id), run.id) as CableObject;
    expect(sized.electrical).toMatchObject({ phases: "tri", ratingA: 32, sectionMm2: 6 });
  });
});
