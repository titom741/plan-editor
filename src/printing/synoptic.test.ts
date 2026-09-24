import { describe, expect, it } from "vitest";
import {
  analyzeNetwork,
  createCableObject,
  createDeviceObject,
  flattenNetwork,
  reconcileCables,
  type CableSpec,
  type DeviceSpec,
} from "../domain/electrical";
import { addObject, createEmptyProject } from "../domain/project";
import type { PlanObject, PointM, Project } from "../domain/types";
import {
  BOX_WIDTH_MM,
  COLUMN_GAP_MM,
  ROW_GAP_MM,
  layoutSynoptic,
  listedLoadRows,
  severityStroke,
} from "./synopticLayout";
import { buildSynopticPdf, chooseSynopticPaper, reportRows } from "./synopticPdf";

function device(name: string, center: PointM, spec: DeviceSpec) {
  const created = createDeviceObject({ role: spec.role, center, layerId: "l", name });
  return { ...created, electrical: spec };
}

function cable(from: PointM, to: PointM, spec: Partial<CableSpec> = {}) {
  const created = createCableObject({
    anchor: from,
    pointsM: [
      { xM: 0, yM: 0 },
      { xM: to.xM - from.xM, yM: to.yM - from.yM },
    ],
    layerId: "l",
    name: "Câble",
  });
  return { ...created, electrical: { ...created.electrical, ...spec } };
}

function wire(...objects: PlanObject[]): Project {
  const base = createEmptyProject({ name: "Virade" });
  return reconcileCables(base, objects.reduce(addObject, base));
}

/** Groupe → Coffret → three loads, plus a load nobody feeds. */
function site() {
  const tri = { phases: "tri", sectionMm2: 16, ratingA: 63 } as const;
  return wire(
    device(
      "Groupe",
      { xM: 0, yM: 0 },
      { role: "source", kind: "generator", phases: "tri", ratingA: 63 },
    ),
    device(
      "Coffret",
      { xM: 20, yM: 0 },
      {
        role: "board",
        phases: "tri",
        ratingA: 63,
        rcdMa: 30,
        outputs: [{ phases: "mono", ratingA: 16, count: 6 }],
      },
    ),
    device("Bar", { xM: 40, yM: -10 }, { role: "load", phases: "mono", powerW: 2000 }),
    device("Scène", { xM: 40, yM: 0 }, { role: "load", phases: "mono", powerW: 1500 }),
    device("Tente", { xM: 40, yM: 10 }, { role: "load", phases: "mono", powerW: 500 }),
    device("Oublié", { xM: 90, yM: 90 }, { role: "load", phases: "mono", powerW: 100 }),
    cable({ xM: 0, yM: 0 }, { xM: 20, yM: 0 }, tri),
    cable({ xM: 20, yM: 0 }, { xM: 40, yM: -10 }),
    cable({ xM: 20, yM: 0 }, { xM: 40, yM: 0 }),
    cable({ xM: 20, yM: 0 }, { xM: 40, yM: 10 }),
  );
}

const latin1 = (bytes: Uint8Array) => String.fromCharCode(...bytes);

describe("layoutSynoptic", () => {
  const layout = layoutSynoptic(analyzeNetwork(site()));
  const box = (title: string) => layout.boxes.find((candidate) => candidate.title === title)!;
  const centreY = (title: string) => box(title).yMm + box(title).heightMm / 2;

  it("puts each level in its own column, power flowing to the right", () => {
    expect(box("Groupe").xMm).toBe(0);
    expect(box("Coffret").xMm).toBe(BOX_WIDTH_MM + COLUMN_GAP_MM);
    expect(box("Bar").xMm).toBe(2 * (BOX_WIDTH_MM + COLUMN_GAP_MM));
  });

  it("stacks the leaves without overlap and centres each parent on its children", () => {
    const leaves = ["Bar", "Scène", "Tente"].map(box);
    for (let i = 1; i < leaves.length; i += 1) {
      expect(leaves[i]!.yMm).toBeCloseTo(leaves[i - 1]!.yMm + leaves[i - 1]!.heightMm + ROW_GAP_MM);
    }
    expect(centreY("Coffret")).toBeCloseTo((centreY("Bar") + centreY("Tente")) / 2);
    expect(centreY("Groupe")).toBeCloseTo(centreY("Coffret"));
  });

  it("joins parent to child with an orthogonal run, labelled with the cable", () => {
    const toBar = layout.edges.find((edge) => edge.pointsMm.at(-1)![1] === centreY("Bar"))!;
    const [start, elbowA, elbowB, end] = toBar.pointsMm;
    expect(start).toEqual([box("Coffret").xMm + BOX_WIDTH_MM, centreY("Coffret")]);
    // Out horizontally, down (or up) vertically, in horizontally.
    expect(elbowA![1]).toBe(start![1]);
    expect(elbowA![0]).toBe(elbowB![0]);
    expect(elbowB![1]).toBe(end![1]);
    expect(end).toEqual([box("Bar").xMm, centreY("Bar")]);
    expect(toBar.label).toBe("3G2.5 · 16 A · 22.4 m");
  });

  it("sets unfed devices apart, under a heading, below the trees", () => {
    const orphan = box("Oublié");
    expect(layout.headings.map((heading) => heading.text)).toEqual(["Non alimentés"]);
    const treesBottom = Math.max(
      ...["Groupe", "Coffret", "Bar", "Scène", "Tente"].map((t) => box(t).yMm + box(t).heightMm),
    );
    expect(orphan.yMm).toBeGreaterThan(treesBottom);
    expect(layout.heightMm).toBeGreaterThanOrEqual(orphan.yMm + orphan.heightMm);
  });

  it("states load, current and drop in each box, and colours it by what is wrong", () => {
    expect(box("Coffret").lines[1]).toMatch(/^4 kW · 6.4 A · chute \d+(\.\d)? %$/);
    expect(box("Groupe").lines[1]).toMatch(/^Charge 4 kW · 6.4 A \/ 43.6 kVA$/);
    expect(box("Coffret").severity).toBeNull();
    expect(box("Oublié").severity).toBe("info");
    expect(severityStroke("error")).toBe("#dc2626");
  });

  it("colours a box by the worst thing said about it, not the first", () => {
    // No RCD (a warning) and an overload (an error) on the same box: red.
    const p = site();
    const coffret = p.objects.find((object) => object.name === "Coffret")!;
    const bar = p.objects.find((object) => object.name === "Bar")!;
    const patched = {
      ...p,
      objects: p.objects.map((object) =>
        object.id === coffret.id
          ? {
              ...object,
              electrical: {
                role: "board" as const,
                phases: "tri" as const,
                ratingA: 6,
                outputs: [],
              },
            }
          : object.id === bar.id
            ? {
                ...object,
                electrical: { role: "load" as const, phases: "mono" as const, powerW: 3000 },
              }
            : object,
      ),
    };
    const network = analyzeNetwork(patched);
    const severities = network.issues
      .filter((issue) => issue.objectId === coffret.id)
      .map((issue) => issue.severity);
    expect(severities).toContain("warning");
    expect(severities).toContain("error");
    const box = layoutSynoptic(network).boxes.find((candidate) => candidate.title === "Coffret")!;
    expect(box.severity).toBe("error");
  });

  it("lays out nothing for a plan without electricity", () => {
    const empty = layoutSynoptic(analyzeNetwork(wire()));
    expect(empty.boxes).toEqual([]);
    expect(empty.widthMm).toBe(0);
  });
});

describe("consumers listed on a coffret (KL-048)", () => {
  function listedSite() {
    const base = site();
    return {
      ...base,
      objects: base.objects.map((object) =>
        object.name === "Coffret" && object.electrical?.role === "board"
          ? {
              ...object,
              electrical: {
                ...object.electrical,
                loads: [
                  { name: "Projecteurs", phases: "mono" as const, powerW: 150, quantity: 10 },
                ],
              },
            }
          : object,
      ),
    };
  }
  const network = analyzeNetwork(listedSite());
  const layout = layoutSynoptic(network);
  const box = (title: string) => layout.boxes.find((candidate) => candidate.title === title)!;

  it("draws each listed consumer as a leaf of its coffret, after the drawn ones", () => {
    const leaf = box("Projecteurs");
    expect(leaf.xMm).toBe(box("Bar").xMm);
    expect(leaf.yMm).toBeGreaterThan(box("Tente").yMm);
    expect(leaf.lines[0]).toBe("10 × 150 W mono");
    // Clicking it selects the coffret: the consumer has no object of its own.
    expect(leaf.objectId).toBe(box("Coffret").objectId);
    expect(new Set(layout.boxes.map((b) => b.key)).size).toBe(layout.boxes.length);
    const coffretCentre = box("Coffret").yMm + box("Coffret").heightMm / 2;
    expect(coffretCentre).toBeCloseTo(
      (box("Bar").yMm + box("Bar").heightMm / 2 + leaf.yMm + leaf.heightMm / 2) / 2,
    );
  });

  it("links it with a dashed line labelled with the socket it takes", () => {
    const edge = layout.edges.find((candidate) => candidate.dashed)!;
    expect(edge.label).toBe("Prise 16 A mono");
    expect(layout.edges.filter((candidate) => candidate.dashed)).toHaveLength(1);
    const pdf = latin1(buildSynopticPdf(network, "Virade", new Date("2026-09-24T10:00:00Z")));
    expect(pdf).toContain("[2 1.5] 0 d");
  });

  it("lists it in the balance under its coffret", () => {
    const coffret = flattenNetwork(network.trees).find((node) => node.device.name === "Coffret")!;
    expect(listedLoadRows(coffret)[0]!.cells).toEqual([
      "Projecteurs",
      "Récepteur",
      "10 × 150 W mono",
      "prise 16 A de Coffret",
      "1.5 kW",
      expect.stringMatching(/ A$/),
      expect.stringMatching(/ %$/),
    ]);
    const rows = reportRows(network, new Map()).map((row) => row.cells[0]);
    expect(rows.indexOf("    Projecteurs")).toBeGreaterThan(rows.indexOf("  Coffret"));
  });
});

describe("chooseSynopticPaper", () => {
  it("keeps a small diagram on A4 at full size, never enlarged", () => {
    expect(chooseSynopticPaper({ widthMm: 100, heightMm: 50 })).toMatchObject({
      paper: { name: "A4" },
      scale: 1,
    });
  });

  it("moves to A3 when A4 would shrink it past legibility", () => {
    const { paper, scale } = chooseSynopticPaper({ widthMm: 390, heightMm: 120 });
    expect(paper.name).toBe("A3");
    expect(scale).toBeCloseTo(1);
  });

  it("shrinks what even A3 cannot hold", () => {
    const { paper, scale } = chooseSynopticPaper({ widthMm: 800, heightMm: 100 });
    expect(paper.name).toBe("A3");
    expect(scale).toBeLessThan(0.5);
  });
});

describe("buildSynopticPdf", () => {
  const pdf = latin1(
    buildSynopticPdf(analyzeNetwork(site()), "Virade", new Date("2026-09-24T10:00:00Z")),
  );

  it("writes the diagram, then the balance, the cables and the alerts", () => {
    expect(pdf.startsWith("%PDF-")).toBe(true);
    expect(pdf).toContain("(Virade \u0097 Schéma électrique unifilaire) Tj");
    for (const text of [
      "Groupe",
      "Coffret",
      "Bar",
      "Bilan par équipement",
      "Câbles",
      "Alertes \\(1\\)",
    ]) {
      expect(pdf, text).toContain(`(${text.replace("â", "â")}`);
    }
    expect(pdf).toContain("(H07RN-F 3G2.5) Tj");
  });

  it("draws every box and every cable as a vector path", () => {
    // Six boxes are filled (B), four cables only stroked (S).
    expect(pdf.split(" re B Q").length - 1).toBe(6);
    expect(pdf.split(" l S Q").length - 1).toBeGreaterThanOrEqual(4);
  });

  it("names a cable in the alerts after what it feeds", () => {
    const hungry = site();
    const bar = hungry.objects.find((object) => object.name === "Bar")!;
    const patched = {
      ...hungry,
      objects: hungry.objects.map((object) =>
        object.id === bar.id
          ? {
              ...object,
              electrical: { role: "load" as const, phases: "mono" as const, powerW: 5000 },
            }
          : object,
      ),
    };
    const out = latin1(buildSynopticPdf(analyzeNetwork(patched), "Virade", new Date()));
    expect(out).toContain("(C\u00e2ble vers Bar) Tj");
  });

  it("prints the disclaimer on every page", () => {
    const pages = Number(/\/Count (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(2);
    expect(pdf.split("(Aide au pré-dimensionnement").length - 1).toBe(pages);
  });

  it("paginates a long balance instead of running off the page", () => {
    const loads: PlanObject[] = [];
    for (let i = 0; i < 60; i += 1) {
      loads.push(
        device(`Stand ${i}`, { xM: 40, yM: i * 3 }, { role: "load", phases: "mono", powerW: 50 }),
      );
      loads.push(cable({ xM: 20, yM: 0 }, { xM: 40, yM: i * 3 }));
    }
    const big = wire(
      device(
        "Groupe",
        { xM: 0, yM: 0 },
        { role: "source", kind: "grid", phases: "tri", ratingA: 63 },
      ),
      device(
        "Coffret",
        { xM: 20, yM: 0 },
        { role: "board", phases: "tri", ratingA: 63, rcdMa: 30, outputs: [] },
      ),
      cable({ xM: 0, yM: 0 }, { xM: 20, yM: 0 }, { phases: "tri", sectionMm2: 16, ratingA: 63 }),
      ...loads,
    );
    const network = analyzeNetwork(big);
    expect(reportRows(network, new Map()).length).toBeGreaterThan(60);
    const out = latin1(buildSynopticPdf(network, "Grand", new Date("2026-09-24T10:00:00Z")));
    expect(Number(/\/Count (\d+)/.exec(out)?.[1])).toBeGreaterThanOrEqual(3);
  });
});
