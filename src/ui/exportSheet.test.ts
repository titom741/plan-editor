import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { createSheet } from "../domain/sheets";
import { computeSheetLayout } from "../printing/sheetLayout";
import { buildSheetPdf } from "./exportSheet";
import { createLineObject, createRectangleObject } from "../domain/objects";
import type { LabelDisplay } from "../domain/display";
import type { PlanObject } from "../domain/types";

function latin1(bytes: Uint8Array) {
  return String.fromCharCode(...bytes);
}

/**
 * The y a piece of text is drawn at, read back out of the content stream.
 *
 * Each text item is written as one `Tm` matrix followed by its string, so
 * the sixth number before `(text) Tj` is its baseline. Reading it is the
 * only way to assert *where* something prints rather than merely that it
 * printed.
 */
function baselineOf(pdf: string, text: string): number | null {
  const match = new RegExp(`([-0-9.]+) ([-0-9.]+) Tm \\(${text}\\) Tj`).exec(pdf);
  return match?.[2] === undefined ? null : Number(match[2]);
}

/**
 * The point size a piece of text is drawn at, read back out of the
 * content stream: each item is one `BT … ET` block carrying its own
 * `/F1 <size> Tf`.
 */
function sizeOf(pdf: string, text: string): number | null {
  for (const segment of pdf.split("BT ")) {
    const opened = segment.indexOf("(");
    const closed = segment.lastIndexOf(") Tj");
    if (opened < 0 || closed < 0 || segment.slice(opened + 1, closed) !== text) continue;
    const size = /\/F1 ([-0-9.]+) Tf/.exec(segment);
    if (size) return Number(size[1]);
  }
  return null;
}

/** The x a piece of text starts at — the fifth number of its `Tm` matrix. */
function leftOf(pdf: string, text: string): number | null {
  const match = new RegExp(`([-0-9.]+) ([-0-9.]+) Tm \\(${text}\\) Tj`).exec(pdf);
  return match?.[1] === undefined ? null : Number(match[1]);
}

describe("buildSheetPdf title block", () => {
  it("prints the configured delivery metadata", () => {
    const project = createEmptyProject({ name: "Festival", location: "Nantes" });
    const sheet = createSheet({
      name: "Sécurité",
      titleBlock: {
        client: "Ville de Nantes",
        author: "Léa",
        revision: "C",
        planNumber: "SEC-12",
        comments: "Accès nord",
      },
    });
    const layout = computeSheetLayout(sheet, null);
    const bytes = buildSheetPdf({
      project,
      sheet,
      layout,
      drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
      pixelWidth: 1,
      pixelHeight: 1,
      now: new Date("2026-08-27T12:00:00Z"),
    });
    const text = latin1(bytes);
    expect(text).toContain("Ville de Nantes");
    expect(text).toContain("Plan SEC-12");
    expect(text).toContain("R\xE9v. C");
    expect(text).toContain("Auteur L\xE9a");
    expect(text).toContain("Acc\xE8s nord");
  });
});

describe("buildSheetPdf object labels (KL-027)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  function sheetWith(objects: PlanObject[], labelDisplay?: LabelDisplay) {
    const project = createEmptyProject({ name: "Festival" });
    const sheet = createSheet({ name: "Plan" });
    return buildSheetPdf({
      project,
      sheet,
      layout: computeSheetLayout(sheet, null),
      drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
      pixelWidth: 800,
      pixelHeight: 600,
      now: new Date("2026-08-28T12:00:00Z"),
      vectorObjects: objects,
      vectorViewport: viewport,
      ...(labelDisplay ? { labelDisplay } : {}),
    });
  }

  const crate = createRectangleObject({
    layerId: "l1",
    name: "Chapiteau",
    xM: 1,
    yM: 1,
    widthM: 10,
    heightM: 5,
    reference: "CHP-10X5",
  });

  it("names the shapes it draws — the raster half carries bitmaps only, so without this a sheet prints nothing labelled", () => {
    const text = latin1(sheetWith([crate]));
    expect(text).toContain("Chapiteau");
    expect(text).toContain("10 \xD7 5 m");
  });

  it("honours the plan's label settings, so what prints is what was on screen", () => {
    const text = latin1(
      sheetWith([crate], {
        name: true,
        dimensions: false,
        reference: true,
        quantity: false,
        stands: false,
      }),
    );
    expect(text).toContain("Chapiteau");
    expect(text).toContain("CHP-10X5");
    expect(text).not.toContain("10 \xD7 5 m");
  });

  it("lets one object override the plan and stay silent", () => {
    const quiet = {
      ...crate,
      display: { name: false, dimensions: false, reference: false, quantity: false, stands: false },
    };
    expect(latin1(sheetWith([quiet]))).not.toContain("Chapiteau");
  });
});

describe("buildSheetPdf stand labels (KL-038)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  function sheetWith(objects: PlanObject[], labelDisplay?: LabelDisplay) {
    const project = createEmptyProject({ name: "Virade" });
    const sheet = createSheet({ name: "Plan" });
    return buildSheetPdf({
      project,
      sheet,
      layout: computeSheetLayout(sheet, null),
      drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
      pixelWidth: 800,
      pixelHeight: 600,
      now: new Date("2026-08-31T12:00:00Z"),
      vectorObjects: objects,
      vectorViewport: viewport,
      ...(labelDisplay ? { labelDisplay } : {}),
    });
  }

  const marquee: PlanObject = {
    ...createRectangleObject({
      layerId: "l1",
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 20,
      heightM: 10,
    }),
    stands: {
      columns: 2,
      rows: 1,
      gapM: 0,
      marginM: 0,
      labels: ["Boulanger", "Poterie"],
    },
  };

  it("prints the stand names — a plan of stands nobody can name is not a plan", () => {
    const text = latin1(sheetWith([marquee]));
    expect(text).toContain("Boulanger");
    expect(text).toContain("Poterie");
  });

  it("drops them when the stands switch is off, so a client's copy can be plain", () => {
    const text = latin1(
      sheetWith([marquee], {
        name: true,
        dimensions: true,
        reference: false,
        quantity: false,
        stands: false,
      }),
    );
    expect(text).not.toContain("Boulanger");
    // The marquee itself is still named.
    expect(text).toContain("Chapiteau");
  });

  it("keeps writing an empty cell as nothing", () => {
    const holed: PlanObject = {
      ...marquee,
      stands: { columns: 2, rows: 1, gapM: 0, marginM: 0, labels: ["Boulanger", ""] },
    };
    const text = latin1(sheetWith([holed]));
    expect(text).toContain("Boulanger");
    expect(text).not.toContain("Poterie");
  });

  it("moves the marquee's own name clear of the stands instead of printing over them", () => {
    // PDF y grows upward, so "clear of them" means a larger y than every
    // stand name. Without the rule the title lands on the centre line,
    // which is exactly where the middle row of stands is written.
    const withStands = baselineOf(latin1(sheetWith([marquee])), "Chapiteau");
    const standBaseline = baselineOf(latin1(sheetWith([marquee])), "Boulanger");
    expect(withStands).not.toBeNull();
    expect(standBaseline).not.toBeNull();
    expect(withStands ?? 0).toBeGreaterThan(standBaseline ?? 0);
  });

  it("leaves a marquee without stands labelled in its middle, as before", () => {
    const plain: PlanObject = { ...marquee, stands: undefined };
    const centre = baselineOf(latin1(sheetWith([plain])), "Chapiteau");
    const raised = baselineOf(latin1(sheetWith([marquee])), "Chapiteau");
    expect(raised ?? 0).toBeGreaterThan(centre ?? 0);
  });
});

describe("buildSheetPdf label sizes (KL-041)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  /**
   * A sheet whose raster is described honestly: `pixelWidth` pixels for
   * the drawing area, so the points-per-metre the captions are sized
   * against is the one the sheet is really laid out at.
   */
  function sheetWith(objects: PlanObject[], pixelWidth = 800) {
    const sheet = createSheet({ name: "Plan" });
    return latin1(
      buildSheetPdf({
        project: createEmptyProject({ name: "Virade" }),
        sheet,
        layout: computeSheetLayout(sheet, null),
        drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
        pixelWidth,
        pixelHeight: Math.round(pixelWidth * 0.7),
        now: new Date("2026-09-03T12:00:00Z"),
        vectorObjects: objects,
        vectorViewport: viewport,
      }),
    );
  }

  const stand = (labels: string[], columns = 2) => ({
    ...createRectangleObject({
      layerId: "l1",
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 20,
      heightM: 10,
    }),
    stands: { columns, rows: 1, gapM: 0, marginM: 0, labels },
  });

  it("writes an object's caption at the size it has on screen, converted to points", () => {
    // 96 CSS pixels to the inch, 72 points: a 14 px default is 10.5 pt.
    // The flat 6 pt this replaces was smaller than the app's own default
    // and ignored the setting entirely.
    const plain = createRectangleObject({
      layerId: "l1",
      name: "Scene",
      xM: 0,
      yM: 0,
      widthM: 8,
      heightM: 6,
    });
    expect(sizeOf(sheetWith([plain]), "Scene")).toBeCloseTo(14 * (72 / 96), 4);
  });

  it("honours the size set on the object", () => {
    const shouted = {
      ...createRectangleObject({
        layerId: "l1",
        name: "Scene",
        xM: 0,
        yM: 0,
        widthM: 8,
        heightM: 6,
        style: { labelFontSize: 32 },
      }),
    };
    expect(sizeOf(sheetWith([shouted]), "Scene")).toBeCloseTo(32 * (72 / 96), 4);
  });

  it("sizes stand names against the paper their cell occupies", () => {
    // The same marquee, the same sheet, twice the raster: the plan is
    // laid out over a smaller share of the paper, so its stands have
    // less room. A fixed point size could not tell the two apart — that
    // was the defect.
    const roomy = sizeOf(sheetWith([stand(["Boulanger", "Poterie"])], 400), "Boulanger");
    const cramped = sizeOf(sheetWith([stand(["Boulanger", "Poterie"])], 6400), "Boulanger");
    expect(roomy).not.toBeNull();
    expect(cramped).not.toBeNull();
    expect(roomy!).toBeGreaterThan(cramped!);
  });

  it("also sizes them against how finely the marquee is divided", () => {
    // Two stands in a 20 m tent, or twenty: the same sheet, and text
    // that cannot be the same size in a 10 m cell and in a 1 m one.
    const wide = sizeOf(sheetWith([stand(["Boulanger", "Poterie"])]), "Boulanger");
    const narrow = sizeOf(
      sheetWith([stand(["Boulanger", ...Array.from({ length: 9 }, () => "")], 10)]),
      "Boulanger",
    );
    expect(wide!).toBeGreaterThan(narrow!);
  });

  it("gives every cell of one grid the same size, so identical cases do not read as a mistake", () => {
    const pdf = sheetWith([stand(["Boulanger", "Bar"])], 600);
    expect(sizeOf(pdf, "Boulanger")).toBe(sizeOf(pdf, "Bar"));
  });

  it("breaks a name over two lines on paper as it does on screen", () => {
    // Six columns of a 20 m tent: cells of 3.3 m, where the name only
    // fits broken in two.
    const pdf = sheetWith([stand(["Boulangerie Dupont", "", "", "", "", ""], 6)], 900);
    expect(pdf).toContain("Boulangerie");
    expect(pdf).toContain("Dupont");
    expect(pdf).not.toContain("Boulangerie Dupont");
    // Two lines, one above the other, at one size.
    expect(sizeOf(pdf, "Boulangerie")).toBe(sizeOf(pdf, "Dupont"));
    expect(baselineOf(pdf, "Boulangerie") ?? 0).toBeGreaterThan(baselineOf(pdf, "Dupont") ?? 0);
  });

  it("leaves the cells empty when no size would be readable, instead of printing specks", () => {
    // A 20 m tent cut into forty: half-metre cells, which on this sheet
    // are a couple of points across.
    const pdf = sheetWith([stand(["Boulanger", ...Array.from({ length: 39 }, () => "")], 40)]);
    expect(pdf).not.toContain("Boulanger");
    // The marquee itself is still named: its caption has a size of its
    // own and does not have to fit inside a cell.
    expect(pdf).toContain("Chapiteau");
  });

  it("centres a caption on the width of its letters, not on how many there are", () => {
    // "llll" and "MMMM" are four characters and nowhere near the same
    // width; centring by character count put every narrow name visibly
    // off to one side.
    const narrow = { ...stand(["llll", ""]), name: "" };
    const wide = { ...stand(["MMMM", ""]), name: "" };
    const narrowLeft = leftOf(sheetWith([narrow]), "llll");
    const wideLeft = leftOf(sheetWith([wide]), "MMMM");
    expect(narrowLeft).not.toBeNull();
    expect(wideLeft).not.toBeNull();
    // Same cell, same centre: the wider text has to start further left.
    expect(wideLeft!).toBeLessThan(narrowLeft!);
  });

  it("writes a line's caption half-way along it, as the editor does", () => {
    const cable = (pointsM: { xM: number; yM: number }[]): PlanObject => ({
      ...createLineObject({ layerId: "l1", name: "Cable", xM: 0, yM: 0, pointsM }),
      label: "Cable",
    });
    // Two lines that start alike. On the straight one, half-way along is
    // (10, 0) — the same point as the centre of its bounding box. On the
    // L it is the corner, (20, 0), while the box centre is (10, 10),
    // which is not even on the line. So a caption placed half-way along
    // moves to the right between the two, and one hung off the box
    // centre does not move at all.
    const straight = leftOf(
      sheetWith([
        cable([
          { xM: 0, yM: 0 },
          { xM: 20, yM: 0 },
        ]),
      ]),
      "Cable",
    );
    const bent = leftOf(
      sheetWith([
        cable([
          { xM: 0, yM: 0 },
          { xM: 20, yM: 0 },
          { xM: 20, yM: 20 },
        ]),
      ]),
      "Cable",
    );
    expect(straight).not.toBeNull();
    expect(bent).not.toBeNull();
    expect(bent!).toBeGreaterThan(straight!);
  });
});
