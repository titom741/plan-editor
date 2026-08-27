import { describe, expect, it } from "vitest";
import { ORIENTATIONS, PAPER_SIZE_ORDER, STANDARD_SCALE_DENOMINATORS, createSheet } from "../domain/sheets";
import { metersToPixels, worldToScreen } from "../rendering/viewport";
import { MAX_EXPORT_PIXELS, chooseScaleBarLengthM, computePrintRaster, computeSheetLayout } from "./sheetLayout";
import { mmToPt, ptToMm } from "./pdf";

const a3Landscape = createSheet({ paperSize: "A3", orientation: "landscape", scaleDenominator: 200, marginMm: 10 });

describe("computeSheetLayout", () => {
  it("sizes the page to the paper, in points", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    expect(ptToMm(layout.pageWidthPt)).toBeCloseTo(420, 6);
    expect(ptToMm(layout.pageHeightPt)).toBeCloseTo(297, 6);
  });

  it("insets the frame by the margin on all sides", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    expect(ptToMm(layout.frame.xPt)).toBeCloseTo(10, 6);
    expect(ptToMm(layout.frame.yPt)).toBeCloseTo(10, 6);
    expect(ptToMm(layout.frame.widthPt)).toBeCloseTo(400, 6);
    expect(ptToMm(layout.frame.heightPt)).toBeCloseTo(277, 6);
  });

  it("stacks the drawing above the title block, together filling the frame", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    expect(layout.drawing.yPt).toBeCloseTo(layout.titleBlock.yPt + layout.titleBlock.heightPt, 6);
    expect(layout.drawing.heightPt + layout.titleBlock.heightPt).toBeCloseTo(layout.frame.heightPt, 6);
  });

  it("reports the ground area the drawing covers at the sheet's scale", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    // 400 mm wide at 1:200 → 80 m.
    expect(layout.drawingAreaM.widthM).toBeCloseTo(80, 9);
    // 277 mm minus the 16 mm title block = 261 mm → 52.2 m.
    expect(layout.drawingAreaM.heightM).toBeCloseTo(52.2, 9);
  });

  it("centres on the content, not the world origin — a plan drawn far from (0,0) still prints", () => {
    const layout = computeSheetLayout(a3Landscape, { minXM: 1000, minYM: -500, maxXM: 1040, maxYM: -480 });
    expect(layout.drawingCenterM).toEqual({ xM: 1020, yM: -490 });
  });

  it("falls back to the origin for an empty plan", () => {
    expect(computeSheetLayout(a3Landscape, null).drawingCenterM).toEqual({ xM: 0, yM: 0 });
  });

  it("never lets the title block exceed the frame on an absurdly small printable area", () => {
    const tiny = createSheet({ paperSize: "A4", orientation: "portrait", marginMm: 104 });
    const layout = computeSheetLayout(tiny, null);
    expect(layout.titleBlock.heightPt).toBeLessThanOrEqual(layout.frame.heightPt);
    expect(layout.drawing.heightPt).toBeGreaterThanOrEqual(0);
    expect(layout.drawingAreaM.heightM).toBeGreaterThanOrEqual(0);
  });
});

describe("chooseScaleBarLengthM", () => {
  it("picks a bar that fits within the allowance", () => {
    // At 1:200, 10 m is 50 mm — the largest round value within 50 mm.
    expect(chooseScaleBarLengthM(200, 50)).toBe(10);
  });

  it("grows the represented distance as the scale coarsens", () => {
    expect(chooseScaleBarLengthM(100, 50)).toBe(5);
    expect(chooseScaleBarLengthM(500, 50)).toBe(25);
    expect(chooseScaleBarLengthM(1000, 50)).toBe(50);
  });

  it("always returns a round number a reader can use", () => {
    const rounds = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000];
    for (const denominator of [20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000]) {
      expect(rounds).toContain(chooseScaleBarLengthM(denominator, 50));
    }
  });

  it("drops below a metre at fine scales, where a 1 m bar would be too wide", () => {
    // At 1:20, 1 m is 50 mm of ink; a 30 mm allowance must yield 0.5 m.
    expect(chooseScaleBarLengthM(20, 30)).toBe(0.5);
  });

  it("still offers the smallest bar at a scale where nothing fits", () => {
    expect(chooseScaleBarLengthM(1, 1)).toBe(0.1);
  });
});

describe("computePrintRaster", () => {
  it("sizes the raster from the drawing area at the requested resolution", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    const raster = computePrintRaster(layout, 150);
    // 400 mm at 150 dpi → 400/25.4*150 ≈ 2362 px.
    expect(raster.pixelWidth).toBe(Math.round((400 / 25.4) * 150));
    expect(raster.effectiveDpi).toBe(150);
  });

  it("produces a viewport that draws the plan at exactly the sheet's scale", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    const raster = computePrintRaster(layout, 150);
    // The whole 80 m the sheet covers must span exactly the raster width.
    expect(metersToPixels(layout.drawingAreaM.widthM, raster.viewport)).toBeCloseTo(raster.pixelWidth, 6);
  });

  it("puts the plan's centre at the centre of the raster", () => {
    const layout = computeSheetLayout(a3Landscape, { minXM: 100, minYM: 200, maxXM: 140, maxYM: 220 });
    const raster = computePrintRaster(layout, 150);
    const centre = worldToScreen(layout.drawingCenterM, raster.viewport);
    expect(centre.x).toBeCloseTo(raster.pixelWidth / 2, 6);
    expect(centre.y).toBeCloseTo(raster.pixelHeight / 2, 6);
  });

  it("keeps a real-world distance a fixed number of millimetres on paper, whatever the resolution", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    for (const dpi of [72, 150, 300]) {
      const raster = computePrintRaster(layout, dpi);
      // 10 m at 1:200 must be 50 mm on the page. In raster pixels that is
      // 50/25.4*dpi — the invariant the whole export rests on.
      const pixels = metersToPixels(10, raster.viewport);
      expect(ptToMm((pixels / raster.pixelWidth) * layout.drawing.widthPt)).toBeCloseTo(50, 6);
    }
  });

  it("reduces the resolution rather than asking for a canvas the browser would refuse", () => {
    const a0 = createSheet({ paperSize: "A0", orientation: "landscape", scaleDenominator: 500, marginMm: 10 });
    const layout = computeSheetLayout(a0, null);
    const raster = computePrintRaster(layout, 600);
    expect(raster.pixelWidth * raster.pixelHeight).toBeLessThanOrEqual(MAX_EXPORT_PIXELS);
    expect(raster.effectiveDpi).toBeLessThan(600);
    // Scale fidelity must survive the downgrade.
    expect(metersToPixels(layout.drawingAreaM.widthM, raster.viewport)).toBeCloseTo(raster.pixelWidth, 6);
  });

  it("leaves the resolution alone when it's already within the cap", () => {
    const layout = computeSheetLayout(createSheet({ paperSize: "A4", orientation: "portrait" }), null);
    expect(computePrintRaster(layout, 150).effectiveDpi).toBe(150);
  });
});

describe("scale bar geometry", () => {
  it("draws the bar at the length it claims", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    // The bar says "10 m"; on a 1:200 sheet that must be 50 mm of ink.
    expect(layout.scaleBar.lengthM).toBe(10);
    expect(ptToMm(layout.scaleBar.lengthPt)).toBeCloseTo(50, 6);
  });

  it("holds at every offered scale — the bar's length always matches its label", () => {
    for (const scaleDenominator of [20, 50, 100, 200, 500, 1000, 5000]) {
      const layout = computeSheetLayout(createSheet({ scaleDenominator }), null);
      const expectedMm = (layout.scaleBar.lengthM * 1000) / scaleDenominator;
      expect(ptToMm(layout.scaleBar.lengthPt)).toBeCloseTo(expectedMm, 6);
    }
  });

  it("sits inside the title block", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    expect(layout.scaleBar.xPt).toBeGreaterThanOrEqual(layout.titleBlock.xPt);
    expect(layout.scaleBar.xPt + layout.scaleBar.lengthPt).toBeLessThanOrEqual(
      layout.titleBlock.xPt + layout.titleBlock.widthPt,
    );
    expect(layout.scaleBar.yPt).toBeGreaterThanOrEqual(layout.titleBlock.yPt);
  });
});

describe("title block layout", () => {
  // Regression: the first version put the project name, the location and
  // the scale bar at the same coordinates, so a PDF printed them straight
  // through one another.
  it("keeps its two baselines apart and inside the block", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    const { titleBlock } = layout;
    expect(titleBlock.upperBaselinePt).toBeGreaterThan(titleBlock.lowerBaselinePt);
    expect(titleBlock.lowerBaselinePt).toBeGreaterThanOrEqual(titleBlock.yPt);
    expect(titleBlock.upperBaselinePt).toBeLessThanOrEqual(titleBlock.yPt + titleBlock.heightPt);
  });

  it("orders its three columns left to right, all inside the block", () => {
    const { titleBlock } = computeSheetLayout(a3Landscape, null);
    expect(titleBlock.leftColumnXPt).toBeLessThan(titleBlock.middleColumnXPt);
    expect(titleBlock.middleColumnXPt).toBeLessThan(titleBlock.rightColumnXPt);
    expect(titleBlock.leftColumnXPt).toBeGreaterThanOrEqual(titleBlock.xPt);
    expect(titleBlock.rightColumnXPt).toBeLessThan(titleBlock.xPt + titleBlock.widthPt);
  });

  it("puts the scale bar in the middle column, clear of the left column's text", () => {
    const layout = computeSheetLayout(a3Landscape, null);
    expect(layout.scaleBar.xPt).toBe(layout.titleBlock.middleColumnXPt);
    expect(layout.scaleBar.xPt).toBeGreaterThan(layout.titleBlock.leftColumnXPt);
  });

  it("never lets the scale bar run into the right-hand column, on any sheet or scale", () => {
    // Regression: on A4 portrait the bar's end tick printed through the date.
    for (const paperSize of PAPER_SIZE_ORDER) {
      for (const orientation of ORIENTATIONS) {
        for (const scaleDenominator of STANDARD_SCALE_DENOMINATORS) {
          const layout = computeSheetLayout(createSheet({ paperSize, orientation, scaleDenominator }), null);
          expect(layout.scaleBar.xPt + layout.scaleBar.lengthPt).toBeLessThanOrEqual(
            layout.titleBlock.rightColumnXPt,
          );
        }
      }
    }
  });

  it("still draws the bar at the length it claims after being fitted to the column", () => {
    const a4Portrait = createSheet({ paperSize: "A4", orientation: "portrait", scaleDenominator: 500 });
    const layout = computeSheetLayout(a4Portrait, null);
    expect(ptToMm(layout.scaleBar.lengthPt)).toBeCloseTo((layout.scaleBar.lengthM * 1000) / 500, 6);
  });

  it("keeps its baselines within the block even when the sheet is squeezed", () => {
    // A margin this large leaves a printable area smaller than the title
    // block's nominal height, so the baselines have to scale rather than
    // spill outside the frame.
    const squeezed = createSheet({ paperSize: "A4", orientation: "portrait", marginMm: 100 });
    const { titleBlock } = computeSheetLayout(squeezed, null);
    expect(titleBlock.upperBaselinePt).toBeLessThanOrEqual(titleBlock.yPt + titleBlock.heightPt);
    expect(titleBlock.lowerBaselinePt).toBeGreaterThanOrEqual(titleBlock.yPt);
    expect(titleBlock.upperBaselinePt).toBeGreaterThan(titleBlock.lowerBaselinePt);
  });
});

describe("mmToPt sanity for the sheet", () => {
  it("agrees with the paper module on A3 landscape", () => {
    expect(mmToPt(420)).toBeCloseTo(1190.5512, 3);
  });
});
