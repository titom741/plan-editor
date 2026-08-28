import { describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { createSheet } from "../domain/sheets";
import { computeSheetLayout } from "../printing/sheetLayout";
import { buildSheetPdf } from "./exportSheet";

function latin1(bytes: Uint8Array) {
  return String.fromCharCode(...bytes);
}

describe("buildSheetPdf title block", () => {
  it("prints the configured delivery metadata", () => {
    const project = createEmptyProject({ name: "Festival", location: "Nantes" });
    const sheet = createSheet({
      name: "Sécurité",
      titleBlock: { client: "Ville de Nantes", author: "Léa", revision: "C", planNumber: "SEC-12", comments: "Accès nord" },
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
