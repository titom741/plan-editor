import { describe, expect, it } from "vitest";
import {
  MAX_SCALE_DENOMINATOR,
  MIN_SCALE_DENOMINATOR,
  PAPER_SIZES_MM,
  STANDARD_SCALE_DENOMINATORS,
  clampScaleDenominator,
  createSheet,
  exactFitScaleDenominator,
  fitScaleDenominator,
  formatScale,
  getCoveredAreaM,
  getPaperSizeMm,
  getPrintableAreaMm,
  metersToPaperMm,
  paperMmToMeters,
} from "./sheets";

describe("getPaperSizeMm", () => {
  it("returns ISO 216 dimensions in portrait", () => {
    expect(getPaperSizeMm({ paperSize: "A4", orientation: "portrait" })).toEqual({
      widthMm: 210,
      heightMm: 297,
    });
    expect(getPaperSizeMm({ paperSize: "A0", orientation: "portrait" })).toEqual({
      widthMm: 841,
      heightMm: 1189,
    });
  });

  it("swaps the axes in landscape", () => {
    expect(getPaperSizeMm({ paperSize: "A3", orientation: "landscape" })).toEqual({
      widthMm: 420,
      heightMm: 297,
    });
  });

  it("keeps each size double the area of the next one down, as ISO 216 requires", () => {
    // A3 is A4 rotated and doubled: A4's height is A3's width.
    expect(PAPER_SIZES_MM.A4.heightMm).toBe(PAPER_SIZES_MM.A3.widthMm);
    expect(PAPER_SIZES_MM.A3.heightMm).toBe(PAPER_SIZES_MM.A2.widthMm);
    expect(PAPER_SIZES_MM.A2.heightMm).toBe(PAPER_SIZES_MM.A1.widthMm);
    expect(PAPER_SIZES_MM.A1.heightMm).toBe(PAPER_SIZES_MM.A0.widthMm);
  });
});

describe("getPrintableAreaMm", () => {
  it("removes the margin from both edges of each axis", () => {
    const area = getPrintableAreaMm({ paperSize: "A4", orientation: "portrait", marginMm: 10 });
    expect(area).toEqual({ widthMm: 190, heightMm: 277 });
  });

  it("never returns a negative area, however absurd the margin", () => {
    const area = getPrintableAreaMm({ paperSize: "A4", orientation: "portrait", marginMm: 500 });
    expect(area).toEqual({ widthMm: 0, heightMm: 0 });
  });
});

describe("metersToPaperMm / paperMmToMeters", () => {
  it("puts one metre on ten millimetres at 1:100 — the definition of the scale", () => {
    expect(metersToPaperMm(1, 100)).toBe(10);
    expect(metersToPaperMm(10, 100)).toBe(100);
  });

  it("halves the paper distance when the denominator doubles", () => {
    expect(metersToPaperMm(10, 200)).toBe(50);
  });

  it("round-trips exactly", () => {
    for (const denominator of STANDARD_SCALE_DENOMINATORS) {
      expect(paperMmToMeters(metersToPaperMm(37.5, denominator), denominator)).toBeCloseTo(37.5, 9);
    }
  });

  it("reads a measured page distance back as real metres", () => {
    // 42 mm measured on a 1:500 print is 21 m on the ground.
    expect(paperMmToMeters(42, 500)).toBe(21);
  });
});

describe("getCoveredAreaM", () => {
  it("reports how much ground an A3 landscape sheet covers at 1:200", () => {
    const covered = getCoveredAreaM({
      paperSize: "A3",
      orientation: "landscape",
      marginMm: 10,
      scaleDenominator: 200,
    });
    // 420 × 297 mm, minus 10 mm margins → 400 × 277 mm → ×200/1000 m.
    expect(covered.widthM).toBeCloseTo(80, 9);
    expect(covered.heightM).toBeCloseTo(55.4, 9);
  });
});

describe("fitScaleDenominator", () => {
  const a3Landscape = { paperSize: "A3", orientation: "landscape", marginMm: 10 } as const;

  it("chooses a standard scale that actually fits the content", () => {
    const content = { widthM: 70, heightM: 40 };
    const denominator = fitScaleDenominator(content, a3Landscape);
    const covered = getCoveredAreaM({ ...a3Landscape, scaleDenominator: denominator });
    expect(covered.widthM).toBeGreaterThanOrEqual(content.widthM);
    expect(covered.heightM).toBeGreaterThanOrEqual(content.heightM);
  });

  it("only ever returns a value from the standard ladder", () => {
    const denominator = fitScaleDenominator({ widthM: 63.7, heightM: 21.2 }, a3Landscape);
    expect(STANDARD_SCALE_DENOMINATORS).toContain(denominator);
  });

  it("rounds up rather than fitting to the millimetre", () => {
    // Exactly 80 m wide needs 1:200 on this sheet; anything more must not
    // stay at 200, or the drawing would run into the margin.
    expect(fitScaleDenominator({ widthM: 80, heightM: 10 }, a3Landscape)).toBe(200);
    expect(fitScaleDenominator({ widthM: 80.5, heightM: 10 }, a3Landscape)).toBe(250);
  });

  it("is driven by whichever axis is tighter", () => {
    // A tall, narrow plan is limited by height, not width.
    const byHeight = fitScaleDenominator({ widthM: 1, heightM: 55.4 }, a3Landscape);
    expect(byHeight).toBe(200);
  });

  it("keeps the most detailed scale for an empty plan", () => {
    expect(fitScaleDenominator({ widthM: 0, heightM: 0 }, a3Landscape)).toBe(
      STANDARD_SCALE_DENOMINATORS[0],
    );
  });

  it("falls back to the largest scale rather than failing when nothing fits", () => {
    const huge = fitScaleDenominator({ widthM: 100000, heightM: 100000 }, a3Landscape);
    expect(huge).toBe(STANDARD_SCALE_DENOMINATORS[STANDARD_SCALE_DENOMINATORS.length - 1]);
  });

  it("needs a smaller scale on a smaller sheet for the same content", () => {
    const content = { widthM: 70, heightM: 40 };
    const onA3 = fitScaleDenominator(content, a3Landscape);
    const onA4 = fitScaleDenominator(content, {
      paperSize: "A4",
      orientation: "landscape",
      marginMm: 10,
    });
    expect(onA4).toBeGreaterThan(onA3);
  });
});

describe("createSheet", () => {
  it("defaults to a usable printable sheet", () => {
    const sheet = createSheet();
    expect(sheet.paperSize).toBe("A3");
    expect(sheet.orientation).toBe("landscape");
    expect(sheet.scaleDenominator).toBe(200);
    expect(sheet.id).toBeTruthy();
  });

  it("accepts overrides", () => {
    const sheet = createSheet({ paperSize: "A1", scaleDenominator: 500, name: "Vue générale" });
    expect(sheet.paperSize).toBe("A1");
    expect(sheet.scaleDenominator).toBe(500);
    expect(sheet.name).toBe("Vue générale");
  });
});

describe("formatScale", () => {
  it("writes the conventional 1:S form", () => {
    expect(formatScale(200)).toBe("1:200");
  });
});

describe("exactFitScaleDenominator", () => {
  const a3 = createSheet({ paperSize: "A3", orientation: "landscape", marginMm: 10 });

  it("gives the scale at which the plan fills the sheet, not the next one up the ladder", () => {
    // A3 landscape less 10 mm each side is 400 × 277 mm. A 60 m plan needs
    // 1:150, which the ladder does not have — it would jump to 1:200 and
    // leave a quarter of the paper white.
    expect(exactFitScaleDenominator({ widthM: 60, heightM: 20 }, a3)).toBe(150);
    expect(fitScaleDenominator({ widthM: 60, heightM: 20 }, a3)).toBe(200);
  });

  it("fits on whichever side runs out first", () => {
    // The same plan turned on its side is limited by the paper's height.
    expect(exactFitScaleDenominator({ widthM: 20, heightM: 60 }, a3)).toBe(217);
  });

  it("rounds up, so the content clears the margin instead of straddling it", () => {
    const denominator = exactFitScaleDenominator({ widthM: 60, heightM: 20 }, a3);
    const covered = getCoveredAreaM({ ...a3, scaleDenominator: denominator ?? 1 });
    expect(covered.widthM).toBeGreaterThanOrEqual(60);
  });

  it("has no answer for a plan with nothing in it", () => {
    expect(exactFitScaleDenominator({ widthM: 0, heightM: 0 }, a3)).toBeNull();
  });

  it("stays inside the usable range for a plan the size of a county", () => {
    expect(exactFitScaleDenominator({ widthM: 5_000_000, heightM: 1 }, a3)).toBe(
      MAX_SCALE_DENOMINATOR,
    );
  });
});

describe("clampScaleDenominator", () => {
  it("keeps a hand-typed scale whole — 1:137.4 is not a scale anyone writes", () => {
    expect(clampScaleDenominator(137.4)).toBe(137);
    expect(clampScaleDenominator(137.6)).toBe(138);
  });

  it("holds it inside the usable range at both ends", () => {
    expect(clampScaleDenominator(0)).toBe(MIN_SCALE_DENOMINATOR);
    expect(clampScaleDenominator(-50)).toBe(MIN_SCALE_DENOMINATOR);
    expect(clampScaleDenominator(1e9)).toBe(MAX_SCALE_DENOMINATOR);
  });

  it("refuses what is not a number at all, rather than passing NaN into the layout", () => {
    expect(clampScaleDenominator(NaN)).toBeNull();
    expect(clampScaleDenominator(Infinity)).toBeNull();
  });

  it("leaves an ordinary scale exactly as typed", () => {
    expect(clampScaleDenominator(137)).toBe(137);
  });
});
