import { describe, expect, it } from "vitest";
import { buildSchedulePdf } from "./schedulePdf";

describe("buildSchedulePdf", () => {
  it("produit un PDF contenant toute la nomenclature sous forme de texte", () => {
    const bytes = buildSchedulePdf([
      { layer: "Sécurité", category: "Barrières", reference: "BAR-2M", name: "Barrière", quantity: 12, unit: "u" },
    ], "Festival", new Date("2026-08-28T12:00:00Z"));
    const text = new TextDecoder("latin1").decode(bytes);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("Festival");
    expect(text).toContain("BAR-2M");
    expect(text).toContain("Barrière");
  });
});
