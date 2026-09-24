import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { createSheet } from "../domain/sheets";
import { computeSheetLayout } from "../printing/sheetLayout";
import { buildSheetPdf } from "./exportSheet";
import { createDeviceObject } from "../domain/electrical";
import { mmToPt } from "../printing/pdf";
import { createLineObject, createRectangleObject, createSymbolObject } from "../domain/objects";
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

/**
 * The whole `Tm` matrix of a piece of text: `[a b c d]` is its rotation,
 * `(x, y)` its origin. Reading the matrix is the only way to assert that
 * a caption is *turned*, not merely placed.
 */
function matrixOf(pdf: string, text: string) {
  const numbers = "([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+) ([-0-9.]+)";
  const match = new RegExp(`${numbers} Tm \\(${text}\\) Tj`).exec(pdf);
  if (!match) return null;
  const [a, b, , , x, y] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  return { a, b, x, y };
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
        electrical: false,
      }),
    );
    expect(text).toContain("Chapiteau");
    expect(text).toContain("CHP-10X5");
    expect(text).not.toContain("10 \xD7 5 m");
  });

  it("lets one object override the plan and stay silent", () => {
    const quiet = {
      ...crate,
      display: {
        name: false,
        dimensions: false,
        reference: false,
        quantity: false,
        stands: false,
        electrical: false,
      },
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
        electrical: false,
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

describe("buildSheetPdf caption rotation (KL-042)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  function sheetWith(objects: PlanObject[], labelDisplay?: LabelDisplay) {
    const sheet = createSheet({ name: "Plan" });
    return latin1(
      buildSheetPdf({
        project: createEmptyProject({ name: "Virade" }),
        sheet,
        layout: computeSheetLayout(sheet, null),
        drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
        pixelWidth: 900,
        pixelHeight: 630,
        now: new Date("2026-09-03T12:00:00Z"),
        vectorObjects: objects,
        vectorViewport: viewport,
        ...(labelDisplay ? { labelDisplay } : {}),
      }),
    );
  }

  /** A marquee at `rotationDeg`, its stands named by `labels`. */
  const marquee = (rotationDeg: number, labels: string[], columns = labels.length) => ({
    ...createRectangleObject({
      layerId: "l1",
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 20,
      heightM: 10,
    }),
    rotationDeg,
    stands: { columns, rows: 1, gapM: 0, marginM: 0, labels },
  });

  it("turns a stand name with the marquee instead of leaving it horizontal", () => {
    // PDF space has y upward, so a shape turned clockwise on screen is
    // turned the other way on the page — the convention a text object
    // already uses.
    const turned = matrixOf(sheetWith([marquee(30, ["Bar", "Miel"])]), "Bar");
    expect(turned).not.toBeNull();
    expect(turned!.a).toBeCloseTo(Math.cos((-30 * Math.PI) / 180), 3);
    expect(turned!.b).toBeCloseTo(Math.sin((-30 * Math.PI) / 180), 3);
  });

  it("leaves an unturned marquee's names square on the page", () => {
    const flat = matrixOf(sheetWith([marquee(0, ["Bar", "Miel"])]), "Bar");
    expect(flat!.a).toBeCloseTo(1, 6);
    expect(flat!.b).toBeCloseTo(0, 6);
  });

  it("turns the marquee's own name too", () => {
    const turned = matrixOf(sheetWith([marquee(45, ["Bar", "Miel"])]), "Chapiteau");
    expect(turned!.b).toBeCloseTo(Math.sin((-45 * Math.PI) / 180), 3);
  });

  it("hangs a marquee's own name off the middle of its top edge, not off a corner", () => {
    // One stand filling the tent, so its name is centred on the tent's
    // own middle — and named with the same letters as the marquee, so the
    // two captions are exactly as wide as each other and their origins
    // must line up. Anchoring the title on the shape's corner (or on its
    // bounding box, which is the same thing once it turns) moves it by
    // half a tent.
    const tent = {
      ...createRectangleObject({
        layerId: "l1",
        name: "Abc",
        xM: 0,
        yM: 0,
        widthM: 20,
        heightM: 10,
        // 20 px is 15 pt, which is also the ceiling a stand name may
        // reach: both captions then print at one size, so equal letters
        // really do mean equal widths.
        style: { labelFontSize: 20 },
      }),
      stands: { columns: 1, rows: 1, gapM: 0, marginM: 0, labels: ["cbA"] },
    };
    const pdf = sheetWith([tent], {
      name: true,
      dimensions: false,
      reference: false,
      quantity: false,
      stands: true,
      electrical: true,
    });
    const title = matrixOf(pdf, "Abc");
    const stand = matrixOf(pdf, "cbA");
    expect(title).not.toBeNull();
    expect(stand).not.toBeNull();
    expect(title!.x).toBeCloseTo(stand!.x, 6);
    // Above it, not through it: that is the rule this placement exists for.
    expect(title!.y).toBeGreaterThan(stand!.y);
  });

  it("turns a caption's line spacing with it, not just its glyphs", () => {
    // "Abcdefgh" and "hgfedcbA" are the same characters, so the two lines are
    // exactly as wide as each other: whatever separates them is the line
    // step alone, with no centring difference mixed in.
    //
    // Rotating the glyphs while leaving the offsets axis-aligned is the
    // failure this catches — the second line would stay underneath the
    // first instead of following the marquee round, and a two-line name
    // would sit across its own cell.
    // Ten narrow columns in a tent ten metres deep: the name only fits
    // broken in two, which is the case being tested.
    const name = ["Abcdefgh hgfedcbA", ...Array.from({ length: 9 }, () => "")];
    const flat = sheetWith([marquee(0, name, 10)]);
    const turned = sheetWith([marquee(90, name, 10)]);
    expect(flat).not.toContain("Abcdefgh hgfedcbA");
    expect(flat).toContain("hgfedcbA");

    const stepOf = (pdf: string) => {
      const first = matrixOf(pdf, "Abcdefgh")!;
      const second = matrixOf(pdf, "hgfedcbA")!;
      return { dx: second.x - first.x, dy: second.y - first.y };
    };
    const upright = stepOf(flat);
    const sideways = stepOf(turned);
    // Upright, the second line is below the first and directly under it.
    expect(upright.dy).toBeLessThan(0);
    expect(upright.dx).toBeCloseTo(0, 6);
    // Turned a quarter turn, the step has become horizontal — the same
    // length as before, because rotation does not stretch, and to the
    // side the turn actually goes. Comparing magnitudes only would let a
    // transposed matrix through, which mirrors the caption.
    expect(sideways.dy).toBeCloseTo(0, 6);
    expect(sideways.dx).toBeCloseTo(upright.dy, 6);
  });
});

describe("buildSheetPdf holding the readable floor (KL-043)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  function sheetWith(objects: PlanObject[], enlargeSmallText: boolean, pixelWidth = 800) {
    const sheet = createSheet({ name: "Plan" });
    return latin1(
      buildSheetPdf({
        project: createEmptyProject({ name: "Virade" }),
        sheet,
        layout: computeSheetLayout(sheet, null),
        drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
        pixelWidth,
        pixelHeight: Math.round(pixelWidth * 0.7),
        now: new Date("2026-09-09T12:00:00Z"),
        vectorObjects: objects,
        vectorViewport: viewport,
        enlargeSmallText,
      }),
    );
  }

  /** 1.8 mm, the ISO 3098 floor, in points — what every text is held to. */
  const FLOOR_PT = (1.8 / 25.4) * 72;

  const marquee = (labels: string[], columns: number) => ({
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

  /** A text object is measured in metres of ground, so it is the caption that shrinks with the scale. */
  const groundText = (fontSizeM: number): PlanObject => ({
    id: "t1",
    layerId: "l1",
    type: "text",
    name: "Note",
    text: "Entree",
    xM: 1,
    yM: 1,
    rotationDeg: 0,
    fontSizeM,
  });

  it("writes the stand names it would otherwise have dropped", () => {
    // Twenty cells in a 20 m tent, drawn over a large raster: a metre of
    // ground is a fraction of a millimetre of paper, and KL-041 leaves
    // the cells empty rather than print specks.
    const names = ["Boulangerie Dupont", ...Array.from({ length: 19 }, () => "")];
    expect(sheetWith([marquee(names, 20)], false, 6400)).not.toContain("Boulangerie");
    const rescued = sheetWith([marquee(names, 20)], true, 6400);
    // A cell this narrow holds nothing at any size, so the name is left
    // unbroken and spills — which is what the dialogue warns about.
    expect(sizeOf(rescued, "Boulangerie Dupont")).toBeCloseTo(FLOOR_PT, 4);
  });

  it("raises a ground-measured text that the scale has shrunk below the floor", () => {
    // 4 cm of lettering on the ground is nothing on paper — the one
    // caption that cannot be rescued by setting a bigger size, because
    // its size *is* a ground measurement.
    const tiny = groundText(0.04);
    const asIs = sizeOf(sheetWith([tiny], false), "Entree");
    expect(asIs).not.toBeNull();
    expect(asIs!).toBeLessThan(FLOOR_PT);
    expect(sizeOf(sheetWith([tiny], true), "Entree")).toBeCloseTo(FLOOR_PT, 4);
  });

  it("leaves a text that is already legible exactly as it was", () => {
    // The switch is a rescue, not a second size setting: a sheet whose
    // captions clear the floor must come out of the export unchanged.
    const big = groundText(4);
    expect(sizeOf(sheetWith([big], true), "Entree")).toBe(
      sizeOf(sheetWith([big], false), "Entree"),
    );

    const scene = createRectangleObject({
      layerId: "l1",
      name: "Scene",
      xM: 0,
      yM: 0,
      widthM: 8,
      heightM: 6,
    });
    // 14 px is 10.5 pt, twice the floor: untouched either way.
    expect(sizeOf(sheetWith([scene], true), "Scene")).toBeCloseTo(14 * (72 / 96), 4);
  });

  it("raises a caption whose own size was set below the floor", () => {
    const whispered = createRectangleObject({
      layerId: "l1",
      name: "Scene",
      xM: 0,
      yM: 0,
      widthM: 8,
      heightM: 6,
      style: { labelFontSize: 6 },
    });
    // 6 px is 4.5 pt — printable, and still under the 1.8 mm floor.
    expect(sizeOf(sheetWith([whispered], false), "Scene")).toBeCloseTo(4.5, 4);
    expect(sizeOf(sheetWith([whispered], true), "Scene")).toBeCloseTo(FLOOR_PT, 4);
  });

  it("changes nothing when the switch is off, which is the default", () => {
    const names = ["Boulangerie Dupont", ...Array.from({ length: 19 }, () => "")];
    const objects = [marquee(names, 20), groundText(0.04)];
    const sheet = createSheet({ name: "Plan" });
    const withoutFlag = latin1(
      buildSheetPdf({
        project: createEmptyProject({ name: "Virade" }),
        sheet,
        layout: computeSheetLayout(sheet, null),
        drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
        pixelWidth: 6400,
        pixelHeight: 4480,
        now: new Date("2026-09-09T12:00:00Z"),
        vectorObjects: objects,
        vectorViewport: viewport,
      }),
    );
    expect(withoutFlag).toBe(sheetWith(objects, false, 6400));
  });
});

describe("symbols and arrowheads (KL-044)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  function sheetWith(objects: PlanObject[]) {
    const sheet = createSheet({ name: "Plan" });
    return latin1(
      buildSheetPdf({
        project: createEmptyProject({ name: "Virade" }),
        sheet,
        layout: computeSheetLayout(sheet, null),
        drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
        pixelWidth: 800,
        pixelHeight: 560,
        now: new Date("2026-09-19T12:00:00Z"),
        vectorObjects: objects,
        vectorViewport: viewport,
      }),
    );
  }

  const star = () =>
    createSymbolObject({
      layerId: "l1",
      name: "Secours",
      xM: 5,
      yM: 5,
      character: "★",
      sizeM: 3,
    });
  const shaft = (arrowEnd: boolean) =>
    createLineObject({
      layerId: "l1",
      name: "Accès",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 20, yM: 0 },
      ],
      style: arrowEnd ? { arrowEnd: true } : {},
    });

  /** How many paths the page *fills*: `B` paints a path, `S` only strokes it. */
  const filledPaths = (pdf: string) => pdf.split(" B Q").length - 1;

  it("prints a symbol as a glyph of the dingbat font rather than a missing character", () => {
    const pdf = sheetWith([star()]);
    expect(pdf).toContain("/F2 ");
    // The star is byte 0x48 in ZapfDingbats, which is "H" read as one.
    expect(pdf).toContain("(H) Tj");
  });

  it("hangs a symbol's caption below the glyph, where the screen draws it", () => {
    // The first printed proof had it written straight through the glyph:
    // a symbol's caption cannot be centred on the symbol the way a
    // rectangle's is centred in its surface.
    const pdf = sheetWith([star()]);
    const glyph = baselineOf(pdf, "H");
    const caption = baselineOf(pdf, "Secours");
    expect(glyph).not.toBeNull();
    expect(caption).not.toBeNull();
    // PDF's y grows upward, so "below" is a smaller baseline — and by
    // more than half the 3 m glyph, not by a hair.
    expect(caption!).toBeLessThan(glyph!);
  });

  it("gives an arrow the head the vector half used to drop", () => {
    // The screen has drawn arrowheads since long before the PDF did;
    // until now the printed sheet showed the shaft alone.
    expect(filledPaths(sheetWith([shaft(true)]))).toBe(filledPaths(sheetWith([shaft(false)])) + 1);
  });

  it("leaves a plain line unfilled", () => {
    expect(filledPaths(sheetWith([shaft(false)]))).toBe(0);
  });
});

describe("electrical devices (KL-045)", () => {
  const viewport = { basePixelsPerMeter: 20, zoom: 1, offsetXPx: 0, offsetYPx: 0 };

  function sheetWith(objects: PlanObject[]) {
    const sheet = { ...createSheet({ name: "Plan" }), scaleDenominator: 50 };
    return latin1(
      buildSheetPdf({
        project: createEmptyProject({ name: "Virade" }),
        sheet,
        layout: computeSheetLayout(sheet, null),
        drawingJpegDataUrl: "data:image/jpeg;base64,/9j/2Q==",
        pixelWidth: 800,
        pixelHeight: 560,
        now: new Date("2026-09-19T12:00:00Z"),
        vectorObjects: objects,
        vectorViewport: viewport,
      }),
    );
  }

  const coffret = () =>
    createDeviceObject({ role: "board", center: { xM: 5, yM: 5 }, layerId: "l1", name: "Coffret" });

  it("hangs a device's caption under it instead of cramming it inside", () => {
    // The same shape without its electrical record centres its caption,
    // which is what a 0.6 m box cannot hold.
    const board = coffret();
    const { electrical: _omit, ...plain } = board;
    const hanging = baselineOf(sheetWith([board]), "Coffret");
    const centred = baselineOf(sheetWith([plain as PlanObject]), "Coffret");
    expect(hanging).not.toBeNull();
    expect(centred).not.toBeNull();
    // PDF's y grows upward: below is smaller, by more than the half
    // height (0.3 m, 6 mm at 1:50) the centred caption sits above the edge.
    expect(hanging!).toBeLessThan(centred! - mmToPt(6));
  });

  it("prints the characteristics line in the PDF's own encoding", () => {
    // "·" is 0xB7 in WinAnsi; a "?" here would mean it fell outside it.
    expect(sheetWith([coffret()])).toContain("(63 A tri · Diff. 30 mA) Tj");
  });
});
