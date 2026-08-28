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
      sheetWith([crate], { name: true, dimensions: false, reference: true, quantity: false }),
    );
    expect(text).toContain("Chapiteau");
    expect(text).toContain("CHP-10X5");
    expect(text).not.toContain("10 \xD7 5 m");
  });

  it("lets one object override the plan and stay silent", () => {
    const quiet = {
      ...crate,
      display: { name: false, dimensions: false, reference: false, quantity: false },
    };
    expect(latin1(sheetWith([quiet]))).not.toContain("Chapiteau");
  });
});
