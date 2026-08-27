import { formatPaper, formatScale } from "../domain/sheets";
import type { Project, Sheet } from "../domain/types";
import { buildPdf, mmToPt, toPdfDate } from "../printing/pdf";
import type { PdfLineItem, PdfTextItem } from "../printing/pdf";
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
}

/** Lays out the frame, title block and scale bar around the drawing, and returns the finished PDF bytes. */
export function buildSheetPdf(content: SheetContent): Uint8Array {
  const { layout, project, sheet, now } = content;
  const { frame, titleBlock, scaleBar } = layout;

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
  const text: PdfTextItem[] = [
    { text: project.name, xPt: titleBlock.leftColumnXPt, yPt: titleBlock.upperBaselinePt, sizePt: 11 },
    {
      text: `Échelle ${formatScale(sheet.scaleDenominator)} — ${formatPaper(sheet)}`,
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

  if (project.location) {
    text.push({
      text: project.location,
      xPt: titleBlock.leftColumnXPt,
      yPt: titleBlock.lowerBaselinePt,
      sizePt: 8,
    });
  }

  return buildPdf(
    {
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
      lines,
      text,
    },
    {
      title: `${project.name} — plan d'implantation`,
      creator: CREATOR,
      creationDate: toPdfDate(now),
    },
  );
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

export function downloadPng(dataUrl: string, project: Project): void {
  const blob = new Blob([toBlobPart(dataUrlToBytes(dataUrl))], { type: "image/png" });
  download(blob, exportFileName(project, "png"));
}
