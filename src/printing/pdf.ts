/**
 * A small PDF writer: one or several pages, an optional JPEG per page,
 * vector paths and searchable text.
 *
 * **Why hand-written rather than a library.** Not for the sake of it — a
 * PDF library would be a reasonable dependency. It's that what this app
 * needs to put on the page is *exactly what the canvas already draws*, so
 * the alternative (a library that draws shapes) would mean writing a
 * second renderer: every rectangle, circle, polygon, label and rotation
 * re-implemented against a different API, and silently drifting from the
 * Konva one every time either changes. Rasterising the existing renderer
 * at print resolution keeps one source of truth for how a plan looks. That
 * turns the PDF's job into "wrap a JPEG and a few captions in a page of a
 * precise physical size", which is genuinely small.
 *
 * The trade-off, stated plainly: the drawing inside the PDF is a raster,
 * so it doesn't stay crisp when magnified far beyond its export
 * resolution, and text in it isn't selectable. What it *is* is
 * dimensionally exact — the page is a true A-series size and the drawing
 * sits on it at a true scale, which is the property that matters for a
 * plan someone measures with a ruler.
 *
 * JPEG data is embedded with `DCTDecode`, i.e. handed to the PDF exactly
 * as the encoder produced it — no re-compression, no pixel handling here.
 *
 * Everything in this file is pure: it takes numbers and bytes and returns
 * bytes. No DOM, so it is tested in Node.
 */

/** PDF's unit: 1 pt = 1/72 inch. */
export const MM_PER_INCH = 25.4;
export const POINTS_PER_INCH = 72;

export function mmToPt(mm: number): number {
  return (mm * POINTS_PER_INCH) / MM_PER_INCH;
}

export function ptToMm(pt: number): number {
  return (pt * MM_PER_INCH) / POINTS_PER_INCH;
}

/** A JPEG to place on the page, positioned in points from the bottom-left corner (PDF's origin). */
export interface PdfImagePlacement {
  jpeg: Uint8Array;
  pixelWidth: number;
  pixelHeight: number;
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
}

export interface PdfTextItem {
  text: string;
  xPt: number;
  yPt: number;
  sizePt: number;
  rotationDeg?: number;
  /**
   * Print this item as a single glyph from **ZapfDingbats** (`/F2`)
   * instead of Helvetica: the value is the byte that selects the glyph in
   * that font's own encoding, which has nothing to do with the
   * character's Unicode code point (see `domain/symbols.ts`, where the
   * table was read off a proof sheet).
   *
   * `text` still carries the character itself, so a content stream can be
   * read and tested in terms of what was meant, not only what was sent.
   */
  dingbat?: number;
}

export interface PdfPathItem {
  /** PDF path operators, e.g. `x y m x y l ... h`. */
  commands: string;
  strokeRgb?: [number, number, number];
  fillRgb?: [number, number, number];
  widthPt?: number;
  dashPt?: number[];
  opacity?: number;
}

/** A straight line in points — used for the frame and the scale bar. */
export interface PdfLineItem {
  fromPt: [number, number];
  toPt: [number, number];
  widthPt: number;
}

export interface PdfFilledRect {
  xPt: number;
  yPt: number;
  widthPt: number;
  heightPt: number;
  /** 0 = black, 1 = white. Greyscale is all this document needs. */
  grey: number;
}

export interface PdfPage {
  widthPt: number;
  heightPt: number;
  image?: PdfImagePlacement;
  /** Additional JPEGs, e.g. a title-block logo. */
  images?: PdfImagePlacement[];
  lines?: PdfLineItem[];
  rects?: PdfFilledRect[];
  text?: PdfTextItem[];
  paths?: PdfPathItem[];
}

export interface PdfMetadata {
  title: string;
  creator: string;
  /** PDF date string, e.g. `D:20260827143000Z`. Supplied by the caller so this module stays pure. */
  creationDate: string;
}

/** Formats a number for a PDF content stream: fixed notation, no exponent (which PDF doesn't accept), no trailing zeros. */
function num(value: number): string {
  if (!Number.isFinite(value)) return "0";
  const fixed = value.toFixed(4);
  return fixed.replace(/\.?0+$/, "") || "0";
}

/**
 * The characters WinAnsiEncoding places in 0x80–0x9F, where Latin-1 has
 * control codes. Worth spelling out because most of them are ordinary in
 * French: the typographic apostrophe, the em dash used as punctuation, the
 * ellipsis, and œ — a project called "Cœur de ville — plan général" should
 * print as written, not peppered with question marks.
 */
// Written as escapes rather than literal glyphs: several of these are
// visually indistinguishable from their ASCII lookalikes (and from each
// other) in an editor, which is exactly how a duplicate key slips in.
const WIN_ANSI_HIGH: Record<string, number> = {
  "\u20ac": 0x80,
  "\u201a": 0x82,
  "\u0192": 0x83,
  "\u201e": 0x84,
  "\u2026": 0x85, // ellipsis
  "\u2020": 0x86,
  "\u2021": 0x87,
  "\u02c6": 0x88,
  "\u2030": 0x89,
  "\u0160": 0x8a,
  "\u2039": 0x8b,
  "\u0152": 0x8c,
  "\u017d": 0x8e,
  "\u2018": 0x91, // left single quote
  "\u2019": 0x92, // right single quote - the French apostrophe
  "\u201c": 0x93, // left double quote
  "\u201d": 0x94, // right double quote
  "\u2022": 0x95,
  "\u2013": 0x96, // en dash
  "\u2014": 0x97, // em dash
  "\u02dc": 0x98,
  "\u2122": 0x99,
  "\u0161": 0x9a,
  "\u203a": 0x9b,
  "\u0153": 0x9c, // oe ligature
  "\u017e": 0x9e,
  "\u0178": 0x9f,
};

/**
 * Escapes a string for a PDF literal and encodes it as WinAnsi.
 *
 * The 14 standard fonts are used without embedding a font file, so the
 * page is limited to what WinAnsiEncoding covers — which is all of Latin-1
 * plus the typographic characters above, i.e. everything French needs.
 * Anything beyond that (emoji, non-Latin scripts) becomes "?" rather than
 * bytes the viewer would render as mojibake, since user-supplied project
 * names pass through here.
 */
function pdfString(text: string): string {
  let out = "";
  for (const char of text) {
    const mapped = WIN_ANSI_HIGH[char];
    const code = char.codePointAt(0) ?? 63;
    // 0x80–0x9F are undefined in WinAnsi except for the table above, so a
    // raw code point in that range is replaced rather than passed through.
    const byte = mapped ?? (code <= 0xff && (code < 0x80 || code > 0x9f) ? code : 63);
    if (byte === 0x28 || byte === 0x29 || byte === 0x5c) out += `\\${String.fromCharCode(byte)}`;
    else out += String.fromCharCode(byte);
  }
  return out;
}

/** One raw byte as a PDF literal: only `(`, `)` and `\` carry meaning inside one, and all three occur in ZapfDingbats. */
function escapeByte(code: number): string {
  const byte = Math.max(0, Math.min(255, Math.round(code)));
  const char = String.fromCharCode(byte);
  return byte === 0x28 || byte === 0x29 || byte === 0x5c ? `\\${char}` : char;
}

function latin1Bytes(text: string): Uint8Array {
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
  return bytes;
}

function pageImages(page: PdfPage): PdfImagePlacement[] {
  return [...(page.image ? [page.image] : []), ...(page.images ?? [])];
}

function buildContentStream(page: PdfPage): string {
  const parts: string[] = [];

  for (const rect of page.rects ?? []) {
    parts.push(
      `q ${num(rect.grey)} g ${num(rect.xPt)} ${num(rect.yPt)} ${num(rect.widthPt)} ${num(rect.heightPt)} re f Q`,
    );
  }

  for (const [index, image] of pageImages(page).entries()) {
    const { xPt, yPt, widthPt, heightPt } = image;
    // PDF draws an XObject into the unit square, so the CTM carries the
    // size and position: [w 0 0 h x y].
    parts.push(
      `q ${num(widthPt)} 0 0 ${num(heightPt)} ${num(xPt)} ${num(yPt)} cm /Im${index} Do Q`,
    );
  }

  for (const path of page.paths ?? []) {
    const stroke = path.strokeRgb ?? [0, 0, 0];
    const fill = path.fillRgb;
    const dash = path.dashPt?.length ? `[${path.dashPt.map(num).join(" ")}] 0 d ` : "";
    const colors = `${stroke.map(num).join(" ")} RG ${fill ? `${fill.map(num).join(" ")} rg ` : ""}`;
    parts.push(
      `q ${colors}${num(path.widthPt ?? 0.8)} w ${dash}${path.commands} ${fill ? "B" : "S"} Q`,
    );
  }

  for (const line of page.lines ?? []) {
    parts.push(
      `q 0 G ${num(line.widthPt)} w ${num(line.fromPt[0])} ${num(line.fromPt[1])} m ` +
        `${num(line.toPt[0])} ${num(line.toPt[1])} l S Q`,
    );
  }

  for (const item of page.text ?? []) {
    const angle = ((item.rotationDeg ?? 0) * Math.PI) / 180;
    const cos = num(Math.cos(angle));
    const sin = num(Math.sin(angle));
    // A dingbat is one byte in a font with its own encoding, so it skips
    // `pdfString`'s WinAnsi mapping entirely — and only the three
    // structural characters still need escaping, since the byte may well
    // be `(`, `)` or `\` (an aeroplane is 0x28).
    const glyph = item.dingbat === undefined ? pdfString(item.text) : escapeByte(item.dingbat);
    const font = item.dingbat === undefined ? "/F1" : "/F2";
    parts.push(
      `BT 0 g ${font} ${num(item.sizePt)} Tf ${cos} ${sin} ${num(-Math.sin(angle))} ${cos} ${num(item.xPt)} ${num(item.yPt)} Tm (${glyph}) Tj ET`,
    );
  }

  return parts.join("\n");
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Assembles a one-page PDF.
 *
 * The fiddly part of the format is the cross-reference table: it lists the
 * byte offset of every object, so the objects have to be written first and
 * measured as they go. Offsets are counted in *bytes*, not characters,
 * which is why everything is assembled as `Uint8Array` — a single accented
 * character in a project name would otherwise shift every later offset by
 * one and produce a file that opens as blank.
 */
export function buildPdf(page: PdfPage, metadata: PdfMetadata): Uint8Array {
  return buildMultiPagePdf([page], metadata);
}

/** Assembles a PDF with one independent image XObject per page when needed. */
export function buildMultiPagePdf(pages: readonly PdfPage[], metadata: PdfMetadata): Uint8Array {
  if (pages.length === 0) throw new Error("Un PDF doit contenir au moins une page.");

  // 1 catalog, 2 page tree, 3 and 4 the two shared fonts, then
  // page/content/(image), finally info.
  let nextObject = 5;
  const pageObjects = pages.map((page) => {
    const descriptor = {
      page,
      pageObject: nextObject++,
      contentObject: nextObject++,
      imageObjects: pageImages(page).map(() => nextObject++),
    };
    return descriptor;
  });
  const infoObjectNumber = nextObject++;
  const objectCount = nextObject - 1;

  const chunks: Uint8Array[] = [];
  const offsets: number[] = new Array(objectCount + 1).fill(0);
  let length = 0;

  const push = (text: string) => {
    const bytes = latin1Bytes(text);
    chunks.push(bytes);
    length += bytes.length;
  };
  const pushBytes = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  const startObject = (n: number) => {
    offsets[n] = length;
    push(`${n} 0 obj\n`);
  };

  push("%PDF-1.4\n");
  // A comment of high bytes marks the file as binary for tools that would
  // otherwise treat it as text and mangle line endings.
  pushBytes(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]));

  startObject(1);
  push("<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");

  startObject(2);
  push(
    `<< /Type /Pages /Kids [${pageObjects.map(({ pageObject }) => `${pageObject} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`,
  );

  startObject(3);
  push(
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>\nendobj\n",
  );

  // The second of the 14 standard fonts this app uses, and the reason the
  // plan's symbols print anywhere without embedding a font file. No
  // `/Encoding`: ZapfDingbats carries its own, and imposing WinAnsi on it
  // would select the wrong glyph for every byte.
  startObject(4);
  push("<< /Type /Font /Subtype /Type1 /BaseFont /ZapfDingbats >>\nendobj\n");

  for (const descriptor of pageObjects) {
    const { page, pageObject, contentObject, imageObjects } = descriptor;
    const contentBytes = latin1Bytes(buildContentStream(page));
    startObject(pageObject);
    push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.widthPt)} ${num(page.heightPt)}] ` +
        `/Resources << /Font << /F1 3 0 R /F2 4 0 R >>${imageObjects.length ? ` /XObject << ${imageObjects.map((objectNumber, index) => `/Im${index} ${objectNumber} 0 R`).join(" ")} >>` : ""} >> ` +
        `/Contents ${contentObject} 0 R >>\nendobj\n`,
    );
    startObject(contentObject);
    push(`<< /Length ${contentBytes.length} >>\nstream\n`);
    pushBytes(contentBytes);
    push("\nendstream\nendobj\n");
    for (const [index, image] of pageImages(page).entries()) {
      const imageObject = imageObjects[index]!;
      startObject(imageObject);
      push(
        `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} ` +
          `/ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.jpeg.length} >>\nstream\n`,
      );
      pushBytes(image.jpeg);
      push("\nendstream\nendobj\n");
    }
  }

  startObject(infoObjectNumber);
  push(
    `<< /Title (${pdfString(metadata.title)}) /Creator (${pdfString(metadata.creator)}) ` +
      `/Producer (${pdfString(metadata.creator)}) /CreationDate (${pdfString(metadata.creationDate)}) >>\nendobj\n`,
  );

  const xrefOffset = length;
  push(`xref\n0 ${objectCount + 1}\n`);
  push("0000000000 65535 f \n");
  for (let n = 1; n <= objectCount; n += 1) {
    push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  }
  push(
    `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R /Info ${infoObjectNumber} 0 R >>\n` +
      `startxref\n${xrefOffset}\n%%EOF\n`,
  );

  return concatBytes(chunks);
}

/** Formats a `Date` as a PDF date string (`D:YYYYMMDDHHmmSSZ`), in UTC to avoid an offset syntax viewers disagree about. */
export function toPdfDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return (
    `D:${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}
