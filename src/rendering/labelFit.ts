/**
 * Fitting a short label inside a box: how big can the text be, and where
 * does it break.
 *
 * Written for the stand names inside a marquee (KL-038), which are the
 * case where a fixed size is plainly wrong. A tent split into two columns
 * gives cells wide enough for a name at 20 px; the same tent at six
 * columns gives slivers where the same name only fits if it breaks in
 * two — and a size chosen for the second case is unreadably small in the
 * first. So the size is derived from the box instead of decreed.
 *
 * Two properties are worth stating because they are what the callers
 * rely on:
 *
 * - **The line breaks are ours, not the renderer's.** Konva wraps by
 *   itself given a width, but it wraps at whatever size it was handed —
 *   it cannot choose the size *because* of the wrap, which is the whole
 *   point here. We hand it lines and tell it not to wrap.
 * - **One size for the whole set.** Every cell of a grid is the same
 *   size, so per-cell fitting would print "Bar" large and "Boulangerie"
 *   small in identical squares. `fitLabelsToBox` takes every text at once
 *   and returns the one size that suits them all.
 *
 * Text width is *estimated* (see `estimateTextWidthPx`) rather than
 * measured on a canvas: this module stays pure and testable in Node, and
 * an estimate a few percent out costs a few percent of font size, never a
 * broken layout — because the breaks it is choosing between are the ones
 * that actually get drawn.
 */

/** Baseline-to-baseline distance as a multiple of the font size. Passed to Konva as `lineHeight` so both agree on how tall two lines are. */
export const LABEL_LINE_HEIGHT = 1.15;

/**
 * Character widths for Helvetica/Arial as a fraction of the font size,
 * from the standard font metrics, kept only where they differ enough from
 * the average to matter: `Ill` and `MMM` are three characters that differ
 * by a factor of four, and a stand called "IIe" in a narrow cell should
 * not be shrunk as if it were "MMM".
 */
const CHARACTER_WIDTHS: Record<string, number> = {
  " ": 0.278,
  ".": 0.278,
  ",": 0.278,
  ":": 0.278,
  ";": 0.278,
  "'": 0.191,
  "!": 0.278,
  "|": 0.26,
  "(": 0.333,
  ")": 0.333,
  "-": 0.333,
  i: 0.222,
  j: 0.222,
  l: 0.222,
  I: 0.278,
  f: 0.278,
  t: 0.278,
  r: 0.333,
  J: 0.5,
  m: 0.889,
  w: 0.722,
  M: 0.833,
  W: 0.944,
};

/** Everything not in the table: the average of the rest, close enough for lowercase text and digits alike. */
const AVERAGE_CHARACTER_WIDTH = 0.556;

/** Roughly how wide `text` renders at `fontSizePx`, in the same pixels. */
export function estimateTextWidthPx(text: string, fontSizePx: number): number {
  let widths = 0;
  for (const character of text) widths += CHARACTER_WIDTHS[character] ?? AVERAGE_CHARACTER_WIDTH;
  return widths * fontSizePx;
}

export interface LabelBoxPx {
  widthPx: number;
  heightPx: number;
}

export interface FittedLabels {
  /** The size every label is drawn at, in the box's own pixels. */
  fontSizePx: number;
  /** One entry per input text, already broken into the lines to draw. */
  lines: string[][];
}

export interface FitLabelsOptions {
  /** Never grow past this, however much room there is — a name alone in a hall should not print as a headline. */
  maxFontSizePx: number;
  /** Below this the text is not read, it is guessed at; the caller draws nothing instead. */
  minFontSizePx: number;
  /** How many lines a label may break into. Two by default: it buys most of the size, and three lines in a stand cell is a paragraph. */
  maxLines?: number;
}

const DEFAULT_MAX_LINES = 2;

/**
 * Above this many pieces, every possible break is no longer worth
 * enumerating (the count grows with the number of gaps chosen from) and a
 * balanced greedy cut is used instead. Stand names are one to three
 * words; this bound exists so a pasted sentence cannot stall a render.
 */
const MAX_ENUMERATED_TOKENS = 8;

/** The largest size at which these lines still fit the box, ignoring the caller's own ceiling. */
function largestSizeFor(lines: readonly string[], box: LabelBoxPx): number {
  const widest = Math.max(...lines.map((line) => estimateTextWidthPx(line, 1)), 0);
  const byWidth = widest > 0 ? box.widthPx / widest : Number.POSITIVE_INFINITY;
  const byHeight = box.heightPx / (lines.length * LABEL_LINE_HEIGHT);
  return Math.min(byWidth, byHeight);
}

/**
 * The pieces a label may be broken between: words, and the parts of a
 * hyphenated word.
 *
 * The hyphen is not a nicety here. French stand names are full of them —
 * "Sapeurs-pompiers", "Croix-Rouge", "Saint-Étienne" — and since one size
 * serves the whole grid, a single unbreakable long word drags every cell
 * down with it. Breaking after the hyphen is what the language already
 * does; the hyphen stays on the line above, where it belongs.
 */
function tokenize(text: string): string[] {
  return text
    .split(/\s+/)
    .flatMap((word) => word.split(/(?<=-)/))
    .filter((token) => token.length > 0);
}

/** Puts tokens back together: a space between words, nothing after a hyphen that already separates them. */
function joinTokens(tokens: readonly string[]): string {
  return tokens.reduce(
    (line, token) => (line === "" ? token : line.endsWith("-") ? line + token : `${line} ${token}`),
    "",
  );
}

/** Cuts `tokens` into exactly `count` non-empty runs, as evenly as their counts allow. */
function balancedCut(tokens: readonly string[], count: number): string[] {
  const lines: string[] = [];
  let remaining = tokens.length;
  let index = 0;
  for (let line = count; line > 0; line -= 1) {
    const take = Math.max(1, Math.round(remaining / line));
    lines.push(joinTokens(tokens.slice(index, index + take)));
    index += take;
    remaining -= take;
  }
  return lines.filter((line) => line.length > 0);
}

/**
 * Every way of breaking `text` into at most `maxLines` lines, at spaces
 * only — a word is never cut. The single-line form is always first, which
 * is how the tie between "fits on one line" and "fits on two at the same
 * size" is settled in favour of one.
 */
export function candidateLineBreaks(text: string, maxLines: number): string[][] {
  const tokens = tokenize(text);
  if (tokens.length <= 1) return [[text]];

  const lineCap = Math.min(maxLines, tokens.length);
  if (tokens.length > MAX_ENUMERATED_TOKENS) {
    return Array.from({ length: lineCap }, (_, index) => balancedCut(tokens, index + 1));
  }

  const candidates: string[][] = [];
  const build = (startIndex: number, current: string[]) => {
    // Whatever is left always has the option of being the last line; the
    // loop below adds the ways of breaking it further.
    candidates.push([...current, joinTokens(tokens.slice(startIndex))]);
    if (current.length + 1 >= lineCap) return;
    for (let end = startIndex + 1; end < tokens.length; end += 1) {
      build(end, [...current, joinTokens(tokens.slice(startIndex, end))]);
    }
  };
  build(0, []);
  // Fewest lines first, so an equal fit never gains a break for nothing.
  return candidates.sort((a, b) => a.length - b.length);
}

/**
 * The one font size at which every one of `texts` fits the box, and the
 * lines each of them breaks into at that size.
 *
 * `null` when even the smallest allowed size does not fit — the caller's
 * cue to draw nothing at all, which is what a plan wants at low zoom:
 * empty cells rather than a smudge of grey.
 */
export function fitLabelsToBox(
  texts: readonly string[],
  box: LabelBoxPx,
  options: FitLabelsOptions,
): FittedLabels | null {
  const maxLines = Math.max(1, options.maxLines ?? DEFAULT_MAX_LINES);
  if (texts.length === 0) return null;
  if (box.widthPx <= 0 || box.heightPx <= 0) return null;

  const perText = texts.map((text) => {
    const candidates = candidateLineBreaks(text, maxLines);
    const sizes = candidates.map((lines) => largestSizeFor(lines, box));
    return { candidates, sizes, best: Math.max(...sizes) };
  });

  const fontSizePx = Math.min(options.maxFontSizePx, ...perText.map((entry) => entry.best));
  if (!Number.isFinite(fontSizePx) || fontSizePx < options.minFontSizePx) return null;

  return {
    fontSizePx,
    lines: perText.map((entry) => {
      // Candidates are ordered fewest-lines-first, so this is the least
      // broken form that still fits at the size everyone shares.
      const index = entry.sizes.findIndex((size) => size >= fontSizePx);
      return entry.candidates[index === -1 ? entry.sizes.indexOf(entry.best) : index] ?? [];
    }),
  };
}
