import { describe, expect, it } from "vitest";
import {
  LABEL_LINE_HEIGHT,
  candidateLineBreaks,
  estimateTextWidthPx,
  fitLabelsToBox,
} from "./labelFit";

const OPTIONS = { maxFontSizePx: 20, minFontSizePx: 7 };

describe("estimateTextWidthPx", () => {
  it("scales with the font size", () => {
    expect(estimateTextWidthPx("Bar", 24)).toBeCloseTo(estimateTextWidthPx("Bar", 12) * 2, 6);
  });

  it("tells narrow characters from wide ones", () => {
    expect(estimateTextWidthPx("lll", 12)).toBeLessThan(estimateTextWidthPx("mmm", 12));
  });

  it("is empty for empty text", () => {
    expect(estimateTextWidthPx("", 12)).toBe(0);
  });
});

describe("candidateLineBreaks", () => {
  it("offers the unbroken form first", () => {
    expect(candidateLineBreaks("Stand des Amis", 2)[0]).toEqual(["Stand des Amis"]);
  });

  it("never loses or reorders a word", () => {
    for (const candidate of candidateLineBreaks("Boulangerie Dupont", 2)) {
      expect(candidate.join(" ")).toBe("Boulangerie Dupont");
    }
  });

  it("breaks a hyphenated name after the hyphen, which stays on the line above", () => {
    expect(candidateLineBreaks("Sapeurs-pompiers", 2)).toEqual([
      ["Sapeurs-pompiers"],
      ["Sapeurs-", "pompiers"],
    ]);
  });

  it("puts a hyphenated name back together without inventing a space", () => {
    for (const candidate of candidateLineBreaks("Croix-Rouge de Provence", 2)) {
      expect(candidate.join("").replace(/-(?=\S)/g, "-")).not.toContain("- ");
      expect(candidate.join(" ").replace(/-\s+/g, "-")).toBe("Croix-Rouge de Provence");
    }
  });

  it("does not break inside a word that has no space or hyphen", () => {
    expect(candidateLineBreaks("Boulangerie", 2)).toEqual([["Boulangerie"]]);
  });

  it("enumerates every break of a three-word name", () => {
    expect(candidateLineBreaks("A B C", 2)).toEqual([["A B C"], ["A", "B C"], ["A B", "C"]]);
  });

  it("has nothing to break in a single word", () => {
    expect(candidateLineBreaks("Buvette", 2)).toEqual([["Buvette"]]);
  });

  it("falls back to a balanced cut rather than enumerating a sentence", () => {
    const words = "un deux trois quatre cinq six sept huit neuf dix".split(" ");
    const candidates = candidateLineBreaks(words.join(" "), 2);
    expect(candidates).toHaveLength(2);
    expect(candidates[1]).toEqual(["un deux trois quatre cinq", "six sept huit neuf dix"]);
  });
});

describe("fitLabelsToBox", () => {
  it("grows the text until the box stops it, never past the ceiling", () => {
    const fitted = fitLabelsToBox(["A1"], { widthPx: 4000, heightPx: 4000 }, OPTIONS);
    expect(fitted?.fontSizePx).toBe(20);
  });

  it("breaks a name in two when that is what makes it bigger", () => {
    // A narrow, tall cell: two columns of a marquee. On one line the name
    // is limited by the width; on two it is limited by half the height,
    // which is the larger of the two here.
    const box = { widthPx: 90, heightPx: 120 };
    const fitted = fitLabelsToBox(["Boulangerie Dupont"], box, OPTIONS);
    expect(fitted?.lines[0]).toEqual(["Boulangerie", "Dupont"]);
    const unbroken = estimateTextWidthPx("Boulangerie Dupont", 1);
    expect(fitted?.fontSizePx).toBeGreaterThan(box.widthPx / unbroken);
  });

  it("leaves a name that already fits on one line", () => {
    const fitted = fitLabelsToBox(["Bar Est"], { widthPx: 300, heightPx: 40 }, OPTIONS);
    expect(fitted?.lines[0]).toEqual(["Bar Est"]);
  });

  it("draws every cell of a grid at one size, set by its longest name", () => {
    const box = { widthPx: 120, heightPx: 60 };
    const together = fitLabelsToBox(["A1", "Association des commerçants"], box, OPTIONS);
    const alone = fitLabelsToBox(["Association des commerçants"], box, OPTIONS);
    expect(together?.fontSizePx).toBe(alone?.fontSizePx);
    expect(together?.lines[0]).toEqual(["A1"]);
  });

  it("keeps two lines inside the height it was given", () => {
    const box = { widthPx: 80, heightPx: 44 };
    const fitted = fitLabelsToBox(["Régie technique"], box, OPTIONS);
    expect(fitted).not.toBeNull();
    const height = fitted!.lines[0]!.length * LABEL_LINE_HEIGHT * fitted!.fontSizePx;
    expect(height).toBeLessThanOrEqual(box.heightPx + 1e-9);
    for (const line of fitted!.lines[0]!) {
      expect(estimateTextWidthPx(line, fitted!.fontSizePx)).toBeLessThanOrEqual(box.widthPx + 1e-9);
    }
  });

  it("is limited by the height of a wide, short cell", () => {
    // A marquee cut into many rows: there is width to spare and almost no
    // height, so the height is what sets the size.
    const box = { widthPx: 400, heightPx: 18 };
    const fitted = fitLabelsToBox(["A1"], box, OPTIONS);
    expect(fitted?.fontSizePx).toBeCloseTo(box.heightPx / LABEL_LINE_HEIGHT, 6);
    expect(fitted?.fontSizePx).toBeLessThan(OPTIONS.maxFontSizePx);
  });

  it("lets a hyphenated name wrap so it does not shrink the whole grid", () => {
    // The case from the plan: one long unbreakable name would otherwise
    // set the size for every other cell.
    const box = { widthPx: 90, heightPx: 120 };
    const withHyphen = fitLabelsToBox(["Sapeurs-pompiers"], box, OPTIONS);
    expect(withHyphen?.lines[0]).toEqual(["Sapeurs-", "pompiers"]);
    const unbreakable = fitLabelsToBox(["Sapeurspompiers"], box, OPTIONS);
    expect(withHyphen!.fontSizePx).toBeGreaterThan(unbreakable!.fontSizePx);
  });

  it("gives up rather than printing a smudge in a cell too small to read", () => {
    expect(fitLabelsToBox(["Buvette"], { widthPx: 14, heightPx: 8 }, OPTIONS)).toBeNull();
  });

  it("has nothing to fit without texts, or in a box with no room", () => {
    expect(fitLabelsToBox([], { widthPx: 100, heightPx: 100 }, OPTIONS)).toBeNull();
    expect(fitLabelsToBox(["A1"], { widthPx: 0, heightPx: 100 }, OPTIONS)).toBeNull();
  });

  it("honours a lower ceiling, which is how an object's own setting caps it", () => {
    const box = { widthPx: 4000, heightPx: 4000 };
    const fitted = fitLabelsToBox(["A1"], box, { ...OPTIONS, maxFontSizePx: 9 });
    expect(fitted?.fontSizePx).toBe(9);
  });

  it("stays on one line when told it may not break", () => {
    const fitted = fitLabelsToBox(
      ["Boulangerie Dupont"],
      { widthPx: 90, heightPx: 120 },
      { ...OPTIONS, maxLines: 1 },
    );
    expect(fitted?.lines[0]).toEqual(["Boulangerie Dupont"]);
  });
});
