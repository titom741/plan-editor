/**
 * The symbol palette: the characters a `symbol` object can be, and the
 * byte each one becomes in a PDF.
 *
 * **Why a fixed palette rather than any character.** A plan is drawn on
 * screen and read on paper, and those two have different alphabets. The
 * screen draws whatever the system font has, emoji included; the PDF
 * writes text with the 14 standard fonts, which no viewer needs to
 * download — and they cover Latin-1 and this dingbat set, nothing else.
 * Let the user type any character and half of them print as `?`, which is
 * the one outcome a plan must never have: what is on paper has to be what
 * was on screen. So the palette is the intersection, chosen once.
 *
 * `dingbat` is the byte that selects the glyph in **ZapfDingbats**, whose
 * encoding is its own — the character's Unicode code point has nothing to
 * do with it, which is why these numbers were read off a proof sheet
 * rather than derived. `printing/pdf.ts` writes them through `/F2`.
 *
 * The `name`s are French because they are shown in the palette; the code
 * around them is English, as everywhere else in this repo.
 */

export interface PlanSymbol {
  /** What the screen draws — a real Unicode character, so the canvas needs no font of ours. */
  character: string;
  /** Shown under the character in the palette, and used as the object's default name. */
  name: string;
  /** The palette's sections, in the order they are offered. */
  group: SymbolGroup;
  /** The byte selecting this glyph in the ZapfDingbats standard font. */
  dingbat: number;
}

export type SymbolGroup = "Circulation" | "Sécurité" | "Repères" | "Numéros";

export const SYMBOL_GROUPS: readonly SymbolGroup[] = [
  "Circulation",
  "Sécurité",
  "Repères",
  "Numéros",
];

/**
 * Height of a new symbol, in metres of ground.
 *
 * The same two metres a text object defaults to (`DEFAULT_TEXT_SIZE_M`):
 * both are read at the scale a plan is printed at, and a symbol that
 * needed resizing before it could be seen would be a symbol nobody uses.
 */
export const DEFAULT_SYMBOL_SIZE_M = 2;

/** Below this a symbol is a speck; the properties panel and the file reader both hold to it. */
export const MIN_SYMBOL_SIZE_M = 0.05;

export const SYMBOL_PALETTE: readonly PlanSymbol[] = [
  // Circulation — where people and vehicles go. The heavy arrow first:
  // it is the one that still reads at 1:500.
  { character: "➔", name: "Flèche", group: "Circulation", dingbat: 0xd4 },
  { character: "→", name: "Flèche fine", group: "Circulation", dingbat: 0xd5 },
  { character: "➡", name: "Flèche pleine", group: "Circulation", dingbat: 0xe1 },
  { character: "↔", name: "Double sens", group: "Circulation", dingbat: 0xd6 },
  { character: "↕", name: "Double sens vertical", group: "Circulation", dingbat: 0xd7 },
  { character: "☞", name: "Main indicatrice", group: "Circulation", dingbat: 0x2b },

  // Sécurité — the marks a safety commission looks for.
  { character: "✚", name: "Poste de secours", group: "Sécurité", dingbat: 0x3a },
  { character: "✔", name: "Conforme", group: "Sécurité", dingbat: 0x34 },
  { character: "✖", name: "Interdit", group: "Sécurité", dingbat: 0x36 },
  { character: "☎", name: "Téléphone", group: "Sécurité", dingbat: 0x25 },
  { character: "✈", name: "Hélisurface", group: "Sécurité", dingbat: 0x28 },
  { character: "✂", name: "Point de coupure", group: "Sécurité", dingbat: 0x22 },

  // Repères — the plain shapes used to mark a point and nothing more.
  { character: "★", name: "Étoile", group: "Repères", dingbat: 0x48 },
  { character: "☆", name: "Étoile creuse", group: "Repères", dingbat: 0x49 },
  { character: "●", name: "Point", group: "Repères", dingbat: 0x6c },
  { character: "■", name: "Carré", group: "Repères", dingbat: 0x6e },
  { character: "▲", name: "Triangle", group: "Repères", dingbat: 0x73 },
  { character: "▼", name: "Triangle inversé", group: "Repères", dingbat: 0x74 },
  { character: "◆", name: "Losange", group: "Repères", dingbat: 0x75 },
  { character: "✎", name: "Annotation", group: "Repères", dingbat: 0x2e },

  // Numéros — numbering posts, gates or stands on the plan itself, which
  // is what a legend then refers to.
  { character: "①", name: "Numéro 1", group: "Numéros", dingbat: 0xac },
  { character: "②", name: "Numéro 2", group: "Numéros", dingbat: 0xad },
  { character: "③", name: "Numéro 3", group: "Numéros", dingbat: 0xae },
  { character: "④", name: "Numéro 4", group: "Numéros", dingbat: 0xaf },
  { character: "⑤", name: "Numéro 5", group: "Numéros", dingbat: 0xb0 },
  { character: "⑥", name: "Numéro 6", group: "Numéros", dingbat: 0xb1 },
  { character: "⑦", name: "Numéro 7", group: "Numéros", dingbat: 0xb2 },
  { character: "⑧", name: "Numéro 8", group: "Numéros", dingbat: 0xb3 },
  { character: "⑨", name: "Numéro 9", group: "Numéros", dingbat: 0xb4 },
  { character: "⑩", name: "Numéro 10", group: "Numéros", dingbat: 0xb5 },
];

/** What a symbol placed without a choice is — the arrow, the one anybody reaches for first. */
export const DEFAULT_SYMBOL_CHARACTER = "➔";

const BY_CHARACTER = new Map(SYMBOL_PALETTE.map((symbol) => [symbol.character, symbol]));

/** The palette entry for a character, or `undefined` for anything not in the palette. */
export function findSymbol(character: string): PlanSymbol | undefined {
  return BY_CHARACTER.get(character);
}

/**
 * True for a character the palette offers.
 *
 * The file reader uses it to refuse an unknown one rather than accept a
 * plan that cannot print: an object carrying a character with no dingbat
 * would draw on screen and come out blank on paper, which is exactly the
 * silent disagreement this module exists to prevent.
 */
export function isPaletteSymbol(character: string): boolean {
  return BY_CHARACTER.has(character);
}

/** The ZapfDingbats byte for a character, or `undefined` if it has none. */
export function dingbatCodeFor(character: string): number | undefined {
  return BY_CHARACTER.get(character)?.dingbat;
}

/** The palette split into its sections, in `SYMBOL_GROUPS` order — what the picker renders. */
export function symbolsByGroup(): { group: SymbolGroup; symbols: PlanSymbol[] }[] {
  return SYMBOL_GROUPS.map((group) => ({
    group,
    symbols: SYMBOL_PALETTE.filter((symbol) => symbol.group === group),
  }));
}
