import { describe, expect, it } from "vitest";
import { createRectangleObject } from "../domain/objects";
import { DEFAULT_LABEL_DISPLAY } from "../domain/display";
import type { PlanObject, RectangleObject } from "../domain/types";
import {
  MIN_STAND_LABEL_PT,
  PT_PER_CSS_PX,
  fitStandLabelsPt,
  measureStandLegibility,
  pointsPerMeterAtScale,
} from "./standLabels";

/** A 20 × 10 m marquee cut into `columns` × `rows`, with the names given. */
function marquee(labels: string[], columns = 2, rows = 1, style?: RectangleObject["style"]) {
  return {
    ...createRectangleObject({
      layerId: "l1",
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 20,
      heightM: 10,
      ...(style ? { style } : {}),
    }),
    stands: { columns, rows, gapM: 0, marginM: 0, labels },
  } satisfies RectangleObject;
}

const mmToPt = (mm: number) => (mm / 25.4) * 72;

describe("pointsPerMeterAtScale", () => {
  it("puts 1 m at 1000/S millimetres of paper", () => {
    // At 1:200, a metre is 5 mm.
    expect(pointsPerMeterAtScale(200)).toBeCloseTo(mmToPt(5), 6);
    expect(pointsPerMeterAtScale(100)).toBeCloseTo(mmToPt(10), 6);
  });

  it("refuses to divide by a scale that is not one", () => {
    expect(pointsPerMeterAtScale(0)).toBe(0);
    expect(pointsPerMeterAtScale(Number.NaN)).toBe(0);
  });
});

describe("fitStandLabelsPt", () => {
  const stands = marquee(["Boulanger", "Poterie"]);

  it("sizes a name against the paper the cell occupies, not a fixed point size", () => {
    // The same marquee on two sheets: at 1:100 each 10 m cell is 100 mm
    // across, at 1:800 it is 12.5 mm. The name cannot be the same size on
    // both, which is exactly what a flat 6 pt claimed.
    const near = fitStandLabelsPt(stands, stands.stands, pointsPerMeterAtScale(100));
    const far = fitStandLabelsPt(stands, stands.stands, pointsPerMeterAtScale(800));
    expect(near?.fontSizePx).toBeGreaterThan(far!.fontSizePx);
    // Halving the drawing does *not* halve the size: the breathing room
    // kept around a name is a fixed two points, so the space usable in a
    // small cell is proportionally less. This is why the scale a sheet
    // needs is searched for rather than divided out.
    const twiceAsFar = fitStandLabelsPt(stands, stands.stands, pointsPerMeterAtScale(1600), {
      minSizePt: 0,
    });
    expect(twiceAsFar!.fontSizePx).toBeLessThan(far!.fontSizePx / 2);
  });

  it("prints nothing at all rather than lettering nobody can read", () => {
    // 1:5000 puts a 10 m stand in 2 mm of paper.
    expect(fitStandLabelsPt(stands, stands.stands, pointsPerMeterAtScale(5000))).toBeNull();
  });

  it("never goes below the smallest lettering a drawing may carry", () => {
    for (const scale of [50, 100, 200, 300, 500, 800]) {
      const fitted = fitStandLabelsPt(stands, stands.stands, pointsPerMeterAtScale(scale));
      if (fitted) expect(fitted.fontSizePx).toBeGreaterThanOrEqual(MIN_STAND_LABEL_PT);
    }
  });

  it("lets the marquee's own label size raise the ceiling on paper", () => {
    const big = marquee(["A1", "A2"], 2, 1, { labelFontSize: 40 });
    const plain = marquee(["A1", "A2"]);
    const withSetting = fitStandLabelsPt(big, big.stands, pointsPerMeterAtScale(100));
    const without = fitStandLabelsPt(plain, plain.stands, pointsPerMeterAtScale(100));
    expect(withSetting?.fontSizePx).toBeCloseTo(40 * PT_PER_CSS_PX, 6);
    expect(withSetting!.fontSizePx).toBeGreaterThan(without!.fontSizePx);
  });

  it("has nothing to fit when every cell is empty", () => {
    const blank = marquee(["", ""]);
    expect(fitStandLabelsPt(blank, blank.stands, pointsPerMeterAtScale(100))).toBeNull();
  });
});

describe("measureStandLegibility", () => {
  it("says nothing about a plan that writes no stand names", () => {
    const plain: PlanObject = createRectangleObject({
      layerId: "l1",
      name: "Scène",
      xM: 0,
      yM: 0,
      widthM: 8,
      heightM: 6,
    });
    expect(measureStandLegibility([plain], DEFAULT_LABEL_DISPLAY, 200)).toEqual({
      scaleDenominator: 200,
      sizePt: null,
      readableScaleDenominator: null,
    });
  });

  it("reports the printed size when the scale carries it", () => {
    const stands = marquee(["Boulanger", "Poterie"]);
    const verdict = measureStandLegibility([stands], DEFAULT_LABEL_DISPLAY, 100);
    expect(verdict.sizePt).not.toBeNull();
    expect(verdict.readableScaleDenominator).toBeNull();
    expect(verdict.sizePt).toBe(
      fitStandLabelsPt(stands, stands.stands, pointsPerMeterAtScale(100))!.fontSizePx,
    );
  });

  it("names the scale that would carry them when this one does not", () => {
    const stands = marquee(["Boulangerie Dupont", "Poterie"]);
    const verdict = measureStandLegibility([stands], DEFAULT_LABEL_DISPLAY, 2000);
    expect(verdict.sizePt).toBeNull();
    expect(verdict.readableScaleDenominator).not.toBeNull();
    // And the scale it names really does carry them — the suggestion is
    // useless if pressing the button changes nothing.
    const suggested = verdict.readableScaleDenominator!;
    expect(suggested).toBeLessThan(2000);
    expect(
      measureStandLegibility([stands], DEFAULT_LABEL_DISPLAY, suggested).sizePt,
    ).not.toBeNull();
    // And it is the *largest* such scale: one step further out fails.
    expect(
      measureStandLegibility([stands], DEFAULT_LABEL_DISPLAY, suggested + 1).sizePt,
    ).toBeNull();
  });

  it("is decided by the worst marquee, not the roomiest", () => {
    const roomy = marquee(["A1", "A2"]);
    const cramped = {
      ...marquee(["Association des commerçants réunis", "B2"], 4, 4),
      id: "other",
    };
    const verdict = measureStandLegibility([roomy, cramped], DEFAULT_LABEL_DISPLAY, 400);
    expect(measureStandLegibility([roomy], DEFAULT_LABEL_DISPLAY, 400).sizePt).not.toBeNull();
    expect(verdict.sizePt).toBeNull();
  });

  it("reports the tightest marquee's size when several fit at once", () => {
    // Two tents that both print their names, but not at the same size:
    // ten-metre stands on one, three on the other. Reporting the roomier
    // number would tell the user the sheet is more legible than it is.
    const roomy = marquee(["A1", "A2"]);
    const divided = { ...marquee(["Boulanger", "", "", "", "", ""], 6), id: "other" };
    const alone = measureStandLegibility([roomy], DEFAULT_LABEL_DISPLAY, 200).sizePt;
    const tight = measureStandLegibility([divided], DEFAULT_LABEL_DISPLAY, 200).sizePt;
    expect(alone).not.toBeNull();
    expect(tight).not.toBeNull();
    expect(tight!).toBeLessThan(alone!);
    expect(measureStandLegibility([roomy, divided], DEFAULT_LABEL_DISPLAY, 200).sizePt).toBe(tight);
  });

  it("stays silent when the stand switch is off — nothing is printed to be illegible", () => {
    const stands = marquee(["Boulangerie Dupont", "Poterie"]);
    const verdict = measureStandLegibility(
      [stands],
      { ...DEFAULT_LABEL_DISPLAY, stands: false },
      5000,
    );
    expect(verdict).toEqual({
      scaleDenominator: 5000,
      sizePt: null,
      readableScaleDenominator: null,
    });
  });
});
