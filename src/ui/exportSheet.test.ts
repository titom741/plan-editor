import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { createSheet } from "../domain/sheets";
import { computeSheetLayout } from "../printing/sheetLayout";
import { buildSheetPdf } from "./exportSheet";
import { createRectangleObject } from "../domain/objects";
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
