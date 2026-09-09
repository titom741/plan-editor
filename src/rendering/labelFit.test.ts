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

describe("fitLabelsToBox holding the floor (KL-043)", () => {
  /** A box far too small for the text at `minFontSizePx` — the case the switch exists for. */
  const TINY = { widthPx: 6, heightPx: 4 };

  it("draws nothing there by default, as it always has", () => {
    expect(fitLabelsToBox(["Boulangerie"], TINY, OPTIONS)).toBeNull();
  });

  it("draws at the floor instead of losing the text, when asked", () => {
    const fitted = fitLabelsToBox(["Boulangerie"], TINY, { ...OPTIONS, enlargeToMin: true });
    expect(fitted?.fontSizePx).toBe(OPTIONS.minFontSizePx);
  });

  it("leaves a text that already clears the floor exactly where it was", () => {
    // The switch is a rescue, not a second size setting: a plan whose
    // labels are legible must come out of the export unchanged.
    const box = { widthPx: 200, heightPx: 60 };
    const asIs = fitLabelsToBox(["Bar"], box, OPTIONS);
    const enlarged = fitLabelsToBox(["Bar"], box, { ...OPTIONS, enlargeToMin: true });
    expect(enlarged).toEqual(asIs);
  });

  it("holds the floor even over a ceiling below it — a caller that pins both wants it readable", () => {
    const fitted = fitLabelsToBox(["Boulangerie"], TINY, {
      minFontSizePx: 7,
      maxFontSizePx: 5,
      enlargeToMin: true,
    });
    expect(fitted?.fontSizePx).toBe(7);
  });

  it("breaks the text where it overflows least, rather than leaving it on one line", () => {
    // A box that carries this name at 5.4 px at best — under the floor,
    // so nothing fits once it is forced to 7 and the break chosen is
    // the one that came closest. On one line it would spill twice as far.
    const box = { widthPx: 15, heightPx: 20 };
    expect(fitLabelsToBox(["Croix Rouge"], box, OPTIONS)).toBeNull();
    const fitted = fitLabelsToBox(["Croix Rouge"], box, { ...OPTIONS, enlargeToMin: true });
    expect(fitted?.fontSizePx).toBe(OPTIONS.minFontSizePx);
    expect(fitted?.lines[0]).toEqual(["Croix", "Rouge"]);
  });

  it("still writes into a box with no room at all, which is where the text would vanish", () => {
    const box = { widthPx: 0, heightPx: 0 };
    expect(fitLabelsToBox(["A1"], box, OPTIONS)).toBeNull();
    expect(fitLabelsToBox(["A1"], box, { ...OPTIONS, enlargeToMin: true })?.fontSizePx).toBe(7);
  });

  it("does not break a text into a box that has no height for one line, let alone two", () => {
    // A wide, flat cell — a long marquee one stand deep — leaves the
    // padding eating more than the height. Ranking the candidates by how
    // negative they came out would prefer two lines here, on the grounds
    // that each is shorter: exactly backwards, since more lines need
    // more height. Nothing fits either way, so the name stays unbroken.
    const fitted = fitLabelsToBox(
      ["Croix Rouge"],
      { widthPx: 60, heightPx: -1 },
      { ...OPTIONS, enlargeToMin: true },
    );
    expect(fitted?.fontSizePx).toBe(OPTIONS.minFontSizePx);
    expect(fitted?.lines[0]).toEqual(["Croix Rouge"]);
  });

  it("has nothing to write when there is no text, floor or not", () => {
    expect(
      fitLabelsToBox([], { widthPx: 100, heightPx: 100 }, { ...OPTIONS, enlargeToMin: true }),
    ).toBeNull();
  });
});
