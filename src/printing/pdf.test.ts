import { describe, expect, it } from "vitest";
import { buildMultiPagePdf, buildPdf, mmToPt, ptToMm, toPdfDate } from "./pdf";

/** Decodes the produced bytes as Latin-1 so offsets in the file line up with string indices. */
function asLatin1(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += String.fromCharCode(byte);
  return out;
}

const metadata = { title: "Plan", creator: "KL", creationDate: "D:20260827120000Z" };

describe("mmToPt / ptToMm", () => {
  it("uses 72 points per inch", () => {
    expect(mmToPt(25.4)).toBeCloseTo(72, 9);
    expect(ptToMm(72)).toBeCloseTo(25.4, 9);
  });

  it("gives A4 its conventional point size", () => {
    // A4 is 595 × 842 pt to the nearest point — the number every PDF tool reports.
    expect(Math.round(mmToPt(210))).toBe(595);
    expect(Math.round(mmToPt(297))).toBe(842);
  });

  it("round-trips", () => {
    expect(ptToMm(mmToPt(123.456))).toBeCloseTo(123.456, 9);
  });
});

describe("buildPdf — structure", () => {
  const page = { widthPt: mmToPt(420), heightPt: mmToPt(297) };

  it("starts with a PDF header and ends with EOF", () => {
    const text = asLatin1(buildPdf(page, metadata));
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text.trimEnd().endsWith("%%EOF")).toBe(true);
  });

  it("declares the page at the exact physical size asked for", () => {
    const text = asLatin1(buildPdf(page, metadata));
    // 420 × 297 mm → 1190.55 × 841.89 pt.
    expect(text).toContain("/MediaBox [0 0 1190.5512 841.8898]");
  });

  it("writes a cross-reference offset that points at the xref table", () => {
    const bytes = buildPdf(page, metadata);
    const text = asLatin1(bytes);
    const match = /startxref\n(\d+)\n%%EOF/.exec(text);
    expect(match).not.toBeNull();
    const offset = Number(match?.[1]);
    // The declared offset must land exactly on the "xref" keyword, or
    // viewers open the file as blank.
    expect(text.slice(offset, offset + 4)).toBe("xref");
  });

  it("lists a byte offset for every object, each landing on that object's header", () => {
    const text = asLatin1(buildPdf(page, metadata));
    // Locate the table via the file's own startxref pointer rather than by
    // searching for "xref", which also matches "startxref".
    const xrefStart = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    const entries = [...text.slice(xrefStart).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(entries.length).toBeGreaterThan(0);
    entries.forEach((offset, index) => {
      expect(text.slice(offset)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it("keeps offsets correct when non-ASCII text shifts byte and character counts apart", () => {
    // "é" is two bytes in UTF-8 but one in the file's Latin-1 encoding.
    // If offsets were counted in JS string characters this would still
    // pass, but a mismatch anywhere would move the xref target.
    const bytes = buildPdf(page, { ...metadata, title: "Fête de la Sécurité — Nantes" });
    const text = asLatin1(bytes);
    const offset = Number(/startxref\n(\d+)\n%%EOF/.exec(text)?.[1]);
    expect(text.slice(offset, offset + 4)).toBe("xref");
    expect(bytes.length).toBe(text.length);
  });

  it("replaces characters the standard fonts can't encode instead of emitting broken bytes", () => {
    const text = asLatin1(
      buildPdf({ ...page, text: [{ text: "Fête 🎪", xPt: 0, yPt: 0, sizePt: 10 }] }, metadata),
    );
    expect(text).toContain("(F\xEAte ?)");
  });

  it("encodes the typographic characters French actually uses, which WinAnsi covers", () => {
    // "C\u0153ur \u2014 l\u2019entr\u00e9e\u2026" — oe ligature, em dash,
    // typographic apostrophe, ellipsis. Written as escapes so the test
    // still means what it says after any tool touches the file.
    const source = "C\u0153ur \u2014 l\u2019entr\u00e9e\u2026";
    const text = asLatin1(
      buildPdf({ ...page, text: [{ text: source, xPt: 0, yPt: 0, sizePt: 10 }] }, metadata),
    );
    expect(text).toContain("(C\x9Cur \x97 l\x92entr\xE9e\x85)");
  });

  it("escapes parentheses and backslashes, which would otherwise end the string early", () => {
    const text = asLatin1(
      buildPdf(
        { ...page, text: [{ text: "Zone (nord) \\ sud", xPt: 0, yPt: 0, sizePt: 10 }] },
        metadata,
      ),
    );
    expect(text).toContain("(Zone \\(nord\\) \\\\ sud)");
  });

  it("omits the image resource entirely when there is no image", () => {
    const text = asLatin1(buildPdf(page, metadata));
    expect(text).not.toContain("/XObject");
    expect(text).not.toContain("DCTDecode");
  });

  it("écrit les tracés vectoriels et les matrices de rotation du texte", () => {
    const text = asLatin1(
      buildPdf(
        {
          ...page,
          paths: [{ commands: "10 10 m 20 20 l", strokeRgb: [1, 0, 0], widthPt: 2 }],
          text: [{ text: "Cote", xPt: 30, yPt: 40, sizePt: 8, rotationDeg: 90 }],
        },
        metadata,
      ),
    );
    expect(text).toContain("1 0 0 RG 2 w 10 10 m 20 20 l S");
    expect(text).toContain("0 1 -1 0 30 40 Tm (Cote)");
  });
});

describe("buildPdf — embedded image", () => {
  // Not a real JPEG; buildPdf never inspects the bytes, it declares their
  // length and hands them to the viewer as DCTDecode data.
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 0xff, 0xd9]);
  const page = {
    widthPt: mmToPt(210),
    heightPt: mmToPt(297),
    image: {
      jpeg,
      pixelWidth: 800,
      pixelHeight: 600,
      xPt: 10,
      yPt: 20,
      widthPt: 400,
      heightPt: 300,
    },
  };

  it("declares the image as an unmodified JPEG stream", () => {
    const text = asLatin1(buildPdf(page, metadata));
    expect(text).toContain("/Subtype /Image");
    expect(text).toContain("/Filter /DCTDecode");
    expect(text).toContain("/Width 800");
    expect(text).toContain("/Height 600");
    expect(text).toContain(`/Length ${jpeg.length}`);
  });

  it("embeds the JPEG bytes verbatim", () => {
    const bytes = buildPdf(page, metadata);
    const text = asLatin1(bytes);
    const start = text.indexOf("stream\n", text.indexOf("DCTDecode")) + "stream\n".length;
    expect(Array.from(bytes.slice(start, start + jpeg.length))).toEqual(Array.from(jpeg));
  });

  it("places the image with a transform carrying its size and position", () => {
    const text = asLatin1(buildPdf(page, metadata));
    expect(text).toContain("400 0 0 300 10 20 cm /Im0 Do");
  });
});

describe("ZapfDingbats glyphs (KL-044)", () => {
  const page = { widthPt: 200, heightPt: 200 };

  it("declares the second standard font beside Helvetica", () => {
    const text = asLatin1(buildPdf(page, metadata));
    expect(text).toContain("/BaseFont /ZapfDingbats");
    expect(text).toContain("/Font << /F1 3 0 R /F2 4 0 R >>");
  });

  it("leaves ZapfDingbats its own encoding", () => {
    // Imposing WinAnsi on it would select a different glyph for every
    // byte — the table in `domain/symbols.ts` would silently be wrong.
    const text = asLatin1(buildPdf(page, metadata));
    expect(text).toContain("/BaseFont /ZapfDingbats >>");
  });

  it("writes a symbol as its byte in /F2 rather than the character in /F1", () => {
    const text = asLatin1(
      buildPdf(
        { ...page, text: [{ text: "★", dingbat: 0x48, xPt: 5, yPt: 5, sizePt: 12 }] },
        metadata,
      ),
    );
    expect(text).toContain("/F2 12 Tf");
    expect(text).not.toContain("/F1 12 Tf");
    // 0x48 is "H" as a byte: the glyph is the star, the byte is what says so.
    expect(text).toContain("(H) Tj");
  });

  it("escapes a dingbat byte that happens to be a parenthesis", () => {
    // The aeroplane is 0x28, i.e. "(" — written raw it would close the
    // string early and corrupt the page.
    const text = asLatin1(
      buildPdf(
        { ...page, text: [{ text: "✈", dingbat: 0x28, xPt: 5, yPt: 5, sizePt: 10 }] },
        metadata,
      ),
    );
    expect(text).toContain("(\\() Tj");
  });

  it("still writes ordinary text in Helvetica", () => {
    const text = asLatin1(
      buildPdf({ ...page, text: [{ text: "Entrée", xPt: 5, yPt: 5, sizePt: 9 }] }, metadata),
    );
    expect(text).toContain("/F1 9 Tf");
    expect(text).toContain("(Entr\xE9e) Tj");
  });
});

describe("toPdfDate", () => {
  it("formats a UTC date the way PDF expects", () => {
    expect(toPdfDate(new Date(Date.UTC(2026, 7, 27, 14, 5, 9)))).toBe("D:20260827140509Z");
  });
});

describe("buildMultiPagePdf", () => {
  it("produit un arbre de pages et plusieurs ressources image", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]);
    const image = {
      jpeg,
      pixelWidth: 1,
      pixelHeight: 1,
      xPt: 0,
      yPt: 0,
      widthPt: 10,
      heightPt: 10,
    };
    const text = asLatin1(
      buildMultiPagePdf(
        [
          { widthPt: 100, heightPt: 100, image, images: [{ ...image, xPt: 20 }] },
          { widthPt: 100, heightPt: 100, text: [{ text: "Page 2", xPt: 10, yPt: 10, sizePt: 8 }] },
        ],
        metadata,
      ),
    );
    expect(text).toContain("/Count 2");
    expect(text).toContain("/Im0");
    expect(text).toContain("/Im1");
    expect(text).toContain("(Page 2)");
  });
});
