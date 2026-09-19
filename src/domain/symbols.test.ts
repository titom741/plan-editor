import { describe, expect, it } from "vitest";
import {
  DEFAULT_SYMBOL_CHARACTER,
  SYMBOL_GROUPS,
  SYMBOL_PALETTE,
  dingbatCodeFor,
  findSymbol,
  isPaletteSymbol,
  symbolsByGroup,
} from "./symbols";

describe("the symbol palette", () => {
  it("offers every character exactly once", () => {
    // Two entries for one character would make the picker's selected
    // cell ambiguous and the lookup below arbitrary.
    const characters = SYMBOL_PALETTE.map((symbol) => symbol.character);
    expect(new Set(characters).size).toBe(characters.length);
  });

  it("gives every character its own glyph in the font", () => {
    // Two characters sharing a dingbat byte would print identically while
    // looking different on screen — the exact disagreement between screen
    // and paper this table exists to prevent.
    const codes = SYMBOL_PALETTE.map((symbol) => symbol.dingbat);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("stays inside the byte range a PDF string can carry", () => {
    for (const symbol of SYMBOL_PALETTE) {
      expect(Number.isInteger(symbol.dingbat)).toBe(true);
      expect(symbol.dingbat).toBeGreaterThanOrEqual(0x21);
      expect(symbol.dingbat).toBeLessThanOrEqual(0xfe);
    }
  });

  it("draws one character per symbol, not a string", () => {
    // The renderer centres a glyph on its anchor by measuring one glyph;
    // a two-character entry would sit visibly off its own point.
    for (const symbol of SYMBOL_PALETTE) {
      expect([...symbol.character]).toHaveLength(1);
    }
  });

  it("places every symbol in one of the declared groups", () => {
    for (const symbol of SYMBOL_PALETTE) {
      expect(SYMBOL_GROUPS).toContain(symbol.group);
    }
  });

  it("names every symbol", () => {
    // The name is the picker's tooltip and the object's default name: an
    // empty one would leave an unnamed object in the nomenclature.
    for (const symbol of SYMBOL_PALETTE) {
      expect(symbol.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("defaults to a character it actually offers", () => {
    expect(isPaletteSymbol(DEFAULT_SYMBOL_CHARACTER)).toBe(true);
  });
});

describe("lookups", () => {
  it("finds a symbol by its character", () => {
    expect(findSymbol("★")?.name).toBe("Étoile");
    expect(findSymbol("★")?.group).toBe("Repères");
  });

  it("returns the byte that prints it", () => {
    // Read off a ZapfDingbats proof sheet, not derived from the code
    // point: the font's encoding is its own.
    expect(dingbatCodeFor("★")).toBe(0x48);
    expect(dingbatCodeFor("➔")).toBe(0xd4);
    expect(dingbatCodeFor("✚")).toBe(0x3a);
    expect(dingbatCodeFor("①")).toBe(0xac);
  });

  it("knows nothing of characters outside the palette", () => {
    expect(isPaletteSymbol("🐙")).toBe(false);
    expect(isPaletteSymbol("A")).toBe(false);
    expect(findSymbol("🐙")).toBeUndefined();
    expect(dingbatCodeFor("🐙")).toBeUndefined();
  });

  it("covers the numbered markers one to ten in order", () => {
    // Contiguous in the font, which is what makes a plan numbered 1..10
    // print in order rather than at random.
    const numbers = SYMBOL_PALETTE.filter((symbol) => symbol.group === "Numéros");
    expect(numbers).toHaveLength(10);
    numbers.forEach((symbol, index) => {
      expect(symbol.dingbat).toBe(0xac + index);
    });
  });
});

describe("symbolsByGroup", () => {
  it("returns the groups in the declared order, each with its symbols", () => {
    const groups = symbolsByGroup();
    expect(groups.map((entry) => entry.group)).toEqual([...SYMBOL_GROUPS]);
    for (const entry of groups) {
      expect(entry.symbols.length).toBeGreaterThan(0);
      for (const symbol of entry.symbols) expect(symbol.group).toBe(entry.group);
    }
  });

  it("loses no symbol on the way", () => {
    const total = symbolsByGroup().reduce((sum, entry) => sum + entry.symbols.length, 0);
    expect(total).toBe(SYMBOL_PALETTE.length);
  });
});
