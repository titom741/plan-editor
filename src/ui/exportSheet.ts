import { formatPaper, formatScale } from "../domain/sheets";
import type { PlanObject, Project, Sheet } from "../domain/types";
import { buildMultiPagePdf, buildPdf, mmToPt, toPdfDate } from "../printing/pdf";
import type { PdfLineItem, PdfPage, PdfPathItem, PdfTextItem } from "../printing/pdf";
import { objectLocalToWorld } from "../domain/geometry";
import { worldToScreen, type Viewport } from "../rendering/viewport";
import type { SheetLayout } from "../printing/sheetLayout";
import { suggestedFileName } from "./projectFileActions";

/**
 * Assembling the printed sheet: the rasterised plan, plus the frame,
 * title block and scale bar drawn around it as vectors.
 *
 * The drawing is a raster (see `printing/pdf.ts` for why), but everything
 * *about* the drawing is not: the frame, the captions and — the one that
 * matters — the scale bar are real PDF vectors at exact point
 * coordinates. So the bar a user measures with a ruler is dimensionally
 * true regardless of the raster's resolution.
 */

const CREATOR = "KL — Implantation Événementielle";

/** Strips the `data:` prefix and decodes the base64 payload into the raw JPEG bytes the PDF embeds unchanged. */
export function dataUrlToBytes(dataUrl: string): Uint8Array {
  const comma = dataUrl.indexOf(",");
  const base64 = comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl;
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function jpegSize(bytes: Uint8Array): { width: number; height: number } {
  let offset = 2;
  while (offset + 8 < bytes.length) {
    if (bytes[offset] !== 0xff) { offset += 1; continue; }
    const marker = bytes[offset + 1]!;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker >= 0xc0 && marker <= 0xc3) return { height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!, width: (bytes[offset + 7]! << 8) | bytes[offset + 8]! };
    offset += Math.max(2, length + 2);
  }
  return { width: 1, height: 1 };
}

function formatDate(date: Date): string {
  return date.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export interface SheetContent {
  project: Project;
  sheet: Sheet;
  layout: SheetLayout;
  /** The rasterised plan as a JPEG data URL, sized to `layout.drawing`. */
  drawingJpegDataUrl: string;
  pixelWidth: number;
  pixelHeight: number;
  now: Date;
  vectorObjects?: readonly PlanObject[];
  vectorViewport?: Viewport;
}

function rgb(hex: string | undefined, fallback: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : fallback;
  return [Number.parseInt(value.slice(1, 3), 16) / 255, Number.parseInt(value.slice(3, 5), 16) / 255, Number.parseInt(value.slice(5, 7), 16) / 255];
}

function vectorGraphics(content: SheetContent): { paths: PdfPathItem[]; text: PdfTextItem[] } {
  if (!content.vectorViewport) return { paths: [], text: [] };
  const { drawing } = content.layout;
  const point = (world: { xM: number; yM: number }) => {
    const screen = worldToScreen(world, content.vectorViewport!);
    return { x: drawing.xPt + (screen.x / content.pixelWidth) * drawing.widthPt, y: drawing.yPt + drawing.heightPt - (screen.y / content.pixelHeight) * drawing.heightPt };
  };
  const paths: PdfPathItem[] = [];
  const text: PdfTextItem[] = [];
  for (const object of content.vectorObjects ?? []) {
    const strokeRgb = rgb(object.style?.stroke, "#0f172a");
    const fillRgb = object.type !== "line" && object.type !== "text" ? rgb(object.style?.fill, "#ffffff") : undefined;
    const widthPt = Math.max(0.3, (object.style?.strokeWidth ?? 1.5) * 0.5);
    const dashPt = object.style?.dash === "dashed" ? [5, 3] : object.style?.dash === "dotted" ? [1, 3] : undefined;
    if (object.type === "text") {
      const anchor = point({ xM: object.xM, yM: object.yM });
      text.push({ text: object.text, xPt: anchor.x, yPt: anchor.y, sizePt: Math.max(4, object.fontSizeM * content.vectorViewport.basePixelsPerMeter * content.vectorViewport.zoom * drawing.widthPt / content.pixelWidth), rotationDeg: -object.rotationDeg });
      continue;
    }
    if (object.type === "image") continue;
    if (object.type === "circle") {
      const center = point({ xM: object.xM, yM: object.yM });
      const edge = point({ xM: object.xM + object.radiusM, yM: object.yM });
      const radius = Math.abs(edge.x - center.x); const k = radius * 0.5522847498;
      paths.push({ commands: `${center.x + radius} ${center.y} m ${center.x + radius} ${center.y + k} ${center.x + k} ${center.y + radius} ${center.x} ${center.y + radius} c ${center.x - k} ${center.y + radius} ${center.x - radius} ${center.y + k} ${center.x - radius} ${center.y} c ${center.x - radius} ${center.y - k} ${center.x - k} ${center.y - radius} ${center.x} ${center.y - radius} c ${center.x + k} ${center.y - radius} ${center.x + radius} ${center.y - k} ${center.x + radius} ${center.y} c h`, strokeRgb, fillRgb, widthPt, dashPt });
      continue;
    }
    const local = object.type === "rectangle" ? [{ xM: 0, yM: 0 }, { xM: object.widthM, yM: 0 }, { xM: object.widthM, yM: object.heightM }, { xM: 0, yM: object.heightM }] : object.pointsM;
    const points = local.map((localPoint) => point(objectLocalToWorld(object, localPoint)));
    const first = points[0]; if (!first) continue;
    const closed = object.type === "rectangle" || object.type === "polygon";
    paths.push({ commands: `${first.x} ${first.y} m ${points.slice(1).map((p) => `${p.x} ${p.y} l`).join(" ")}${closed ? " h" : ""}`, strokeRgb, fillRgb: closed ? fillRgb : undefined, widthPt, dashPt });
  }
  return { paths, text };
}

/** Lays out the frame, title block and scale bar around the drawing, and returns the finished PDF bytes. */
export function buildSheetPdfPage(content: SheetContent, pageLabel?: string): PdfPage {
  const { layout, project, sheet, now } = content;
  const { frame, titleBlock, scaleBar } = layout;
  const vectors = vectorGraphics(content);

  const lines: PdfLineItem[] = [
    // Frame.
    { fromPt: [frame.xPt, frame.yPt], toPt: [frame.xPt + frame.widthPt, frame.yPt], widthPt: 0.8 },
    {
      fromPt: [frame.xPt + frame.widthPt, frame.yPt],
      toPt: [frame.xPt + frame.widthPt, frame.yPt + frame.heightPt],
      widthPt: 0.8,
    },
    {
      fromPt: [frame.xPt + frame.widthPt, frame.yPt + frame.heightPt],
      toPt: [frame.xPt, frame.yPt + frame.heightPt],
      widthPt: 0.8,
    },
    { fromPt: [frame.xPt, frame.yPt + frame.heightPt], toPt: [frame.xPt, frame.yPt], widthPt: 0.8 },
    // Rule between the drawing and the title block.
    {
      fromPt: [titleBlock.xPt, titleBlock.yPt + titleBlock.heightPt],
      toPt: [titleBlock.xPt + titleBlock.widthPt, titleBlock.yPt + titleBlock.heightPt],
      widthPt: 0.8,
    },
    // Scale bar: the horizontal rule plus a tick at each end, so it can be
    // measured precisely rather than eyeballed.
    {
      fromPt: [scaleBar.xPt, scaleBar.yPt],
      toPt: [scaleBar.xPt + scaleBar.lengthPt, scaleBar.yPt],
      widthPt: 1.2,
    },
    {
      fromPt: [scaleBar.xPt, scaleBar.yPt - scaleBar.heightPt / 2],
      toPt: [scaleBar.xPt, scaleBar.yPt + scaleBar.heightPt],
      widthPt: 1.2,
    },
    {
      fromPt: [scaleBar.xPt + scaleBar.lengthPt, scaleBar.yPt - scaleBar.heightPt / 2],
      toPt: [scaleBar.xPt + scaleBar.lengthPt, scaleBar.yPt + scaleBar.heightPt],
      widthPt: 1.2,
    },
  ];

  // Three columns, two baselines — the geometry comes from the layout so
  // the pieces can't be placed on top of one another (see `TitleBlockLayout`).
  const text: PdfTextItem[] = [...vectors.text,
    { text: project.name, xPt: titleBlock.leftColumnXPt, yPt: titleBlock.upperBaselinePt, sizePt: 11 },
    {
      text: `${sheet.name}${pageLabel ? ` — ${pageLabel}` : ""} — Échelle ${formatScale(sheet.scaleDenominator)} — ${formatPaper(sheet)}`,
      xPt: titleBlock.rightColumnXPt,
      yPt: titleBlock.upperBaselinePt,
      sizePt: 9,
    },
    { text: formatDate(now), xPt: titleBlock.rightColumnXPt, yPt: titleBlock.lowerBaselinePt, sizePt: 8 },
    // Label sits above the bar, which occupies the lower baseline.
    {
      text: `${scaleBar.lengthM} m`,
      xPt: scaleBar.xPt,
      yPt: scaleBar.yPt + scaleBar.heightPt + mmToPt(1),
      sizePt: 7,
    },
  ];

  const block = sheet.titleBlock;
  const clientAndLocation = [block?.client ? `Client : ${block.client}` : "", project.location].filter(Boolean).join(" — ");
  if (clientAndLocation) {
    text.push({
      text: clientAndLocation,
      xPt: titleBlock.leftColumnXPt,
      yPt: titleBlock.lowerBaselinePt,
      sizePt: 8,
    });
  }

  const delivery = [block?.planNumber ? `Plan ${block.planNumber}` : "", block?.revision ? `Rév. ${block.revision}` : "", block?.author ? `Auteur ${block.author}` : ""].filter(Boolean).join(" — ");
  if (delivery) text.push({ text: delivery, xPt: titleBlock.rightColumnXPt, yPt: titleBlock.lowerBaselinePt, sizePt: 7 });
  if (block?.comments) text.push({ text: block.comments, xPt: titleBlock.middleColumnXPt, yPt: titleBlock.upperBaselinePt, sizePt: 7 });
  for (const [index, field] of (block?.customFields ?? []).slice(0, 3).entries()) {
    text.push({ text: `${field.label} : ${field.value}`, xPt: titleBlock.middleColumnXPt, yPt: titleBlock.upperBaselinePt - mmToPt(3 + index * 2.5), sizePt: 6 });
  }

  const logoBytes = block?.logoDataUrl ? dataUrlToBytes(block.logoDataUrl) : null;
  const logoSize = logoBytes ? jpegSize(logoBytes) : null;

  return {
      widthPt: layout.pageWidthPt,
      heightPt: layout.pageHeightPt,
      image: {
        jpeg: dataUrlToBytes(content.drawingJpegDataUrl),
        pixelWidth: content.pixelWidth,
        pixelHeight: content.pixelHeight,
        xPt: layout.drawing.xPt,
        yPt: layout.drawing.yPt,
        widthPt: layout.drawing.widthPt,
        heightPt: layout.drawing.heightPt,
      },
      images: logoBytes && logoSize ? [{ jpeg: logoBytes, pixelWidth: logoSize.width, pixelHeight: logoSize.height, xPt: titleBlock.xPt + titleBlock.widthPt - mmToPt(22), yPt: titleBlock.yPt + mmToPt(2), widthPt: mmToPt(18), heightPt: mmToPt(12) }] : undefined,
      lines,
      paths: vectors.paths,
      text,
    };
}

/** Lays out the frame, title block and scale bar around the drawing, and returns the finished PDF bytes. */
export function buildSheetPdf(content: SheetContent): Uint8Array {
  return buildPdf(buildSheetPdfPage(content), {
      title: `${content.project.name} — plan d'implantation`,
      creator: CREATOR,
      creationDate: toPdfDate(content.now),
    });
}

export function buildMultiSheetPdf(contents: readonly SheetContent[]): Uint8Array {
  const first = contents[0];
  if (!first) throw new Error("Aucune page à exporter.");
  return buildMultiPagePdf(contents.map((content, index) => buildSheetPdfPage(content, `${index + 1}/${contents.length}`)), {
    title: `${first.project.name} — plan d'implantation multipage`,
    creator: CREATOR,
    creationDate: toPdfDate(first.now),
  });
}

/**
 * Copies bytes into a standalone `ArrayBuffer` for `Blob`.
 *
 * A `Uint8Array` can be a view onto a larger (or shared) buffer, which
 * `Blob` would take in full — so the copy is what guarantees the file
 * contains the bytes we meant and nothing after them.
 */
function toBlobPart(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

function download(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Filename for an exported sheet: the project's slug plus the extension, reusing the project-file naming so exports sit together alphabetically. */
export function exportFileName(project: Project, extension: "pdf" | "png"): string {
  return `${suggestedFileName(project).replace(/\.kl\.json$/, "")}.${extension}`;
}

export function downloadSheetPdf(content: SheetContent): void {
  const blob = new Blob([toBlobPart(buildSheetPdf(content))], { type: "application/pdf" });
  download(blob, exportFileName(content.project, "pdf"));
}

export function downloadMultiSheetPdf(contents: readonly SheetContent[]): void {
  const first = contents[0];
  if (!first) return;
  const blob = new Blob([toBlobPart(buildMultiSheetPdf(contents))], { type: "application/pdf" });
  download(blob, exportFileName(first.project, "pdf"));
}

export function downloadPng(dataUrl: string, project: Project): void {
  const blob = new Blob([toBlobPart(dataUrlToBytes(dataUrl))], { type: "image/png" });
  download(blob, exportFileName(project, "png"));
}
