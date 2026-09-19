import { formatPaper, formatScale } from "../domain/sheets";
import type { PlanObject, Project, RectangleObject, Sheet, StandGrid } from "../domain/types";
import { buildMultiPagePdf, buildPdf, mmToPt, toPdfDate } from "../printing/pdf";
import type { PdfLineItem, PdfPage, PdfPathItem, PdfTextItem } from "../printing/pdf";
import { objectLocalToWorld } from "../domain/geometry";
import { boundsCenterM, getObjectBoundsM } from "../domain/bounds";
import { getObjectDisplayLabel } from "../domain/labels";
import { dingbatCodeFor } from "../domain/symbols";
import { labelledStandCells, standGridToDraw } from "../domain/stands";
import {
  DEFAULT_LABEL_DISPLAY,
  resolveLabelDisplay,
  resolveLabelFontSizePx,
  type LabelDisplay,
} from "../domain/display";
import { polylineMidpointM } from "../domain/measure";
import { LABEL_LINE_HEIGHT, estimateTextWidthPx } from "../rendering/labelFit";
import { getEffectivePixelsPerMeter, worldToScreen, type Viewport } from "../rendering/viewport";
import {
  PT_PER_CSS_PX,
  clampLabelPt,
  enlargeToReadable,
  fitStandLabelsPt,
} from "../printing/standLabels";
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

const CREATOR = "Plan Editor";

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
    if (bytes[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = bytes[offset + 1]!;
    const length = (bytes[offset + 2]! << 8) | bytes[offset + 3]!;
    if (marker >= 0xc0 && marker <= 0xc3)
      return {
        height: (bytes[offset + 5]! << 8) | bytes[offset + 6]!,
        width: (bytes[offset + 7]! << 8) | bytes[offset + 8]!,
      };
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
  /** The plan's default label settings; each object may still override them. */
  labelDisplay?: LabelDisplay;
  /**
   * Hold every printed text to the readable floor, spilling out of the
   * shape it names rather than shrinking below it or being dropped
   * (KL-043). Off unless the user asked for it in the export dialogue.
   */
  enlargeSmallText?: boolean;
}

function rgb(hex: string | undefined, fallback: string): [number, number, number] {
  const value = /^#[0-9a-f]{6}$/i.test(hex ?? "") ? hex! : fallback;
  return [
    Number.parseInt(value.slice(1, 3), 16) / 255,
    Number.parseInt(value.slice(3, 5), 16) / 255,
    Number.parseInt(value.slice(5, 7), 16) / 255,
  ];
}

function vectorGraphics(content: SheetContent): { paths: PdfPathItem[]; text: PdfTextItem[] } {
  if (!content.vectorViewport) return { paths: [], text: [] };
  const { drawing } = content.layout;
  const point = (world: { xM: number; yM: number }) => {
    const screen = worldToScreen(world, content.vectorViewport!);
    return {
      x: drawing.xPt + (screen.x / content.pixelWidth) * drawing.widthPt,
      y: drawing.yPt + drawing.heightPt - (screen.y / content.pixelHeight) * drawing.heightPt,
    };
  };
  const paths: PdfPathItem[] = [];
  const text: PdfTextItem[] = [];
  for (const object of content.vectorObjects ?? []) {
    const strokeRgb = rgb(object.style?.stroke, "#0f172a");
    const fillRgb =
      object.type !== "line" && object.type !== "text"
        ? rgb(object.style?.fill, "#ffffff")
        : undefined;
    const widthPt = Math.max(0.3, (object.style?.strokeWidth ?? 1.5) * 0.5);
    const dashPt =
      object.style?.dash === "dashed"
        ? [5, 3]
        : object.style?.dash === "dotted"
          ? [1, 3]
          : undefined;
    if (object.type === "text") {
      const anchor = point({ xM: object.xM, yM: object.yM });
      text.push({
        text: object.text,
        xPt: anchor.x,
        yPt: anchor.y,
        // A text object is measured in metres of ground, so it is the one
        // caption that shrinks with the scale: 2 m at 1:2000 is a
        // millimetre of paper. The 4 pt floor keeps it printable; the
        // readable floor, when asked for, keeps it legible.
        sizePt: enlargeToReadable(
          Math.max(
            4,
            (object.fontSizeM *
              content.vectorViewport.basePixelsPerMeter *
              content.vectorViewport.zoom *
              drawing.widthPt) /
              content.pixelWidth,
          ),
          content.enlargeSmallText ?? false,
        ),
        rotationDeg: -object.rotationDeg,
      });
      continue;
    }
    if (object.type === "symbol") {
      const centre = point({ xM: object.xM, yM: object.yM });
      const sizePt = enlargeToReadable(
        Math.max(4, object.sizeM * pointsPerMeter(content)),
        content.enlargeSmallText ?? false,
      );
      const code = dingbatCodeFor(object.character);
      if (code !== undefined) {
        text.push({
          text: object.character,
          dingbat: code,
          // PDF text grows from its baseline and starts at its left edge,
          // while a symbol is centred on its anchor — so it is nudged
          // back by half a glyph each way, turned with the object like
          // any other caption (KL-042).
          ...offsetText(centre, -sizePt * 0.5, -sizePt * CAP_HALF_HEIGHT, -object.rotationDeg),
          sizePt,
          rotationDeg: -object.rotationDeg,
        });
      }
      continue;
    }
    if (object.type === "image") continue;
    if (object.type === "circle") {
      const center = point({ xM: object.xM, yM: object.yM });
      const edge = point({ xM: object.xM + object.radiusM, yM: object.yM });
      const radius = Math.abs(edge.x - center.x);
      const k = radius * 0.5522847498;
      paths.push({
        commands: `${center.x + radius} ${center.y} m ${center.x + radius} ${center.y + k} ${center.x + k} ${center.y + radius} ${center.x} ${center.y + radius} c ${center.x - k} ${center.y + radius} ${center.x - radius} ${center.y + k} ${center.x - radius} ${center.y} c ${center.x - radius} ${center.y - k} ${center.x - k} ${center.y - radius} ${center.x} ${center.y - radius} c ${center.x + k} ${center.y - radius} ${center.x + radius} ${center.y - k} ${center.x + radius} ${center.y} c h`,
        strokeRgb,
        fillRgb,
        widthPt,
        dashPt,
      });
      continue;
    }
    const local =
      object.type === "rectangle"
        ? [
            { xM: 0, yM: 0 },
            { xM: object.widthM, yM: 0 },
            { xM: object.widthM, yM: object.heightM },
            { xM: 0, yM: object.heightM },
          ]
        : object.pointsM;
    const points = local.map((localPoint) => point(objectLocalToWorld(object, localPoint)));
    const first = points[0];
    if (!first) continue;
    const closed = object.type === "rectangle" || object.type === "polygon";
    paths.push({
      commands: `${first.x} ${first.y} m ${points
        .slice(1)
        .map((p) => `${p.x} ${p.y} l`)
        .join(" ")}${closed ? " h" : ""}`,
      strokeRgb,
      fillRgb: closed ? fillRgb : undefined,
      widthPt,
      dashPt,
    });
    // The arrowheads. The screen has drawn them since long before this
    // file existed (Konva's `Arrow`), but the vector half drew the shaft
    // alone — so an arrow exported to PDF came out as a plain line, with
    // the one thing that made it an arrow missing.
    if (object.type === "line") {
      const headPt = Math.max(3, widthPt * 4);
      if (object.style?.arrowEnd) {
        const tip = points[points.length - 1];
        const from = points[points.length - 2];
        if (tip && from) paths.push(arrowHead(from, tip, headPt, strokeRgb));
      }
      if (object.style?.arrowStart) {
        const tip = points[0];
        const from = points[1];
        if (tip && from) paths.push(arrowHead(from, tip, headPt, strokeRgb));
      }
    }
  }
  // Labels, after every shape, so no fill can cover the text that names it.
  for (const object of content.vectorObjects ?? []) {
    if (object.type === "text" || object.type === "image") continue;
    text.push(...labelText(object, content, point));
  }
  return { paths, text };
}

/**
 * A filled triangle at `tip`, pointing the way the segment from `from`
 * was going. Solid rather than two strokes: at print sizes a stroked head
 * closes up into a blob, and a filled one is what the screen draws.
 */
function arrowHead(
  from: { x: number; y: number },
  tip: { x: number; y: number },
  lengthPt: number,
  strokeRgb: [number, number, number],
): PdfPathItem {
  const dx = tip.x - from.x;
  const dy = tip.y - from.y;
  const distance = Math.hypot(dx, dy) || 1;
  const ux = dx / distance;
  const uy = dy / distance;
  // The base sits one head-length back along the shaft, its two corners
  // half a width to each side of it.
  const baseX = tip.x - ux * lengthPt;
  const baseY = tip.y - uy * lengthPt;
  const halfWidth = lengthPt * 0.45;
  return {
    commands:
      `${tip.x} ${tip.y} m ` +
      `${baseX - uy * halfWidth} ${baseY + ux * halfWidth} l ` +
      `${baseX + uy * halfWidth} ${baseY - ux * halfWidth} l h`,
    strokeRgb,
    fillRgb: strokeRgb,
    widthPt: 0.3,
  };
}

/** A point offset in a caption's own frame, then turned with it — the same rotation `stackedText` applies. */
function offsetText(
  anchor: { x: number; y: number },
  dx: number,
  dy: number,
  rotationDeg: number,
): { xPt: number; yPt: number } {
  const angle = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { xPt: anchor.x + dx * cos - dy * sin, yPt: anchor.y + dx * sin + dy * cos };
}

/**
 * A caption's size on paper comes from its size on screen: a CSS pixel is
 * 1/96 inch and a point is 1/72, so the conversion is fixed at 0.75 pt
 * per pixel (`PT_PER_CSS_PX`). It is the same conversion the raster half
 * applies — `renderScale = dpi / 96`, and a print pixel is 1/dpi inch —
 * which is what makes the vector and raster halves of an export agree by
 * construction rather than by inspection.
 *
 * This replaced a flat 6 pt (KL-041). Six points is 2.1 mm: legible held
 * close, invisible on a sheet read at arm's length, and — the real defect
 * — deaf to everything. A stand cell 50 mm wide on paper was handed the
 * same 6 pt as one of 5 mm, and the size the user had set on the object
 * was ignored outright.
 */

/**
 * Where a line of text sits above its own baseline, as a fraction of the
 * font size — Helvetica's capitals are about 0.72 em tall, so their
 * middle is around 0.36 em up. Centring a caption on a shape means
 * centring the letters, not the baseline.
 */
const CAP_HALF_HEIGHT = 0.36;

/** Gap between a caption and the edge (or stroke) it is placed clear of, in points — the 6 screen pixels the editor uses. */
const LABEL_GAP_PT = 6 * PT_PER_CSS_PX;

/** The size this object's caption prints at, its own setting included, and the floor the sheet may be holding. */
function labelSizePt(object: PlanObject, enlarge: boolean): number {
  return enlargeToReadable(clampLabelPt(resolveLabelFontSizePx(object) * PT_PER_CSS_PX), enlarge);
}

/**
 * Points per metre on this sheet — the print scale, in the unit the PDF
 * is written in. Taken from the raster's own viewport rather than from
 * the sheet's nominal scale, because a tiled sheet or a fitted scale can
 * differ from it, and what the captions must match is the drawing that
 * was actually laid out.
 */
function pointsPerMeter(content: SheetContent): number {
  const viewport = content.vectorViewport;
  if (!viewport || content.pixelWidth <= 0) return 0;
  return (
    getEffectivePixelsPerMeter(viewport) * (content.layout.drawing.widthPt / content.pixelWidth)
  );
}

/**
 * Lays a caption's lines out as PDF text items, centred on `anchor` and
 * turned with the object (KL-042).
 *
 * The offsets are worked out in the caption's *own* frame — half a line's
 * width to the left, one step down per line — and then rotated with it.
 * Rotating the glyphs while leaving the offsets axis-aligned would be
 * worse than not rotating at all: a stand name would slide out of the
 * cell it names as soon as the marquee was turned.
 *
 * `rotationDeg` is the object's rotation expressed in PDF space, where y
 * grows upward — that is, negated, the same convention a `text` object
 * already uses. The matrix here is the one `printing/pdf.ts` writes into
 * `Tm`, so the two cannot drift apart.
 *
 * Lines are centred with the same width model the fitter uses
 * (`estimateTextWidthPx`) rather than by counting characters at half an
 * em: "Illy" and "MMMM" are four characters and nowhere near the same
 * width, and the old estimate put every narrow name visibly off-centre.
 */
function stackedText(
  lines: readonly string[],
  sizePt: number,
  anchor: { x: number; y: number },
  /** Where the first line's baseline sits above the anchor, in the caption's own frame. */
  topOffsetPt: number,
  rotationDeg: number,
): PdfTextItem[] {
  const angle = (rotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return lines.map((line, index) => {
    const dx = -estimateTextWidthPx(line, sizePt) / 2;
    const dy = topOffsetPt - index * sizePt * LABEL_LINE_HEIGHT;
    return {
      text: line,
      xPt: anchor.x + dx * cos - dy * sin,
      yPt: anchor.y + dx * sin + dy * cos,
      sizePt,
      rotationDeg,
    };
  });
}

/**
 * The lines an object writes on the printed sheet.
 *
 * The raster half of the export draws bitmaps only, so without this a
 * PDF came out with every shape correctly placed and *nothing named* —
 * which is most of what a plan is for. The text comes from the same
 * `getObjectDisplayLabel` the screen uses, through the same display
 * settings, so what prints is what was on screen.
 *
 * Lines are centred on the object's extent rather than hung off its
 * anchor: a rotated rectangle's anchor is a corner somewhere out in the
 * field, and the label belongs in the middle of the thing it names.
 */
function labelText(
  object: PlanObject,
  content: SheetContent,
  point: (world: { xM: number; yM: number }) => { x: number; y: number },
): PdfTextItem[] {
  const display = resolveLabelDisplay(object, content.labelDisplay ?? DEFAULT_LABEL_DISPLAY);
  const grid = standGridToDraw(object, display);
  const stands =
    grid && object.type === "rectangle" ? standLabels(object, grid, content, point) : [];

  const lines = getObjectDisplayLabel(object, display)
    .split("\n")
    .filter((line) => line.length > 0);
  if (lines.length === 0) return stands;

  const bounds = getObjectBoundsM(object);
  if (!bounds) return stands;
  const sizePt = labelSizePt(object, content.enlargeSmallText ?? false);
  const step = sizePt * LABEL_LINE_HEIGHT;

  // A line's caption reads half-way along the line; a marquee full of
  // stand names has no middle left, so its own name moves clear of its
  // top edge. Both anchors are taken in the object's *local* frame and
  // turned with it, so a tent pitched at an angle keeps its name along
  // its own side instead of somewhere off its bounding box (KL-042).
  const anchorM =
    object.type === "line"
      ? polylineMidpointM(object.pointsM)
      : object.type === "symbol"
        ? { xM: 0, yM: 0 }
        : grid && object.type === "rectangle"
          ? { xM: object.widthM / 2, yM: 0 }
          : null;

  // Clear of the anchor: the last line sits one gap away, the ones above
  // it a step further. Centred on it otherwise, letters not baselines.
  //
  // A symbol is the one that hangs its caption *below* itself. Centred
  // like a rectangle's it would be struck through its own glyph — which
  // is exactly what the first printed proof showed — and the screen
  // already draws it underneath, so the two halves would disagree.
  const topOffsetPt =
    object.type === "symbol"
      ? -((object.sizeM / 2) * pointsPerMeter(content) + LABEL_GAP_PT + sizePt * CAP_HALF_HEIGHT)
      : anchorM
        ? LABEL_GAP_PT + (lines.length - 1) * step
        : ((lines.length - 1) * step) / 2 - CAP_HALF_HEIGHT * sizePt;
  const anchor = anchorM
    ? point(objectLocalToWorld(object, anchorM))
    : point(boundsCenterM(bounds));

  return [...stands, ...stackedText(lines, sizePt, anchor, topOffsetPt, -object.rotationDeg)];
}

/**
 * One text item per named stand, centred on its own cell and turned with
 * the marquee.
 *
 * The cells come out of `domain/stands.ts` in the marquee's local frame,
 * so they are rotated with it here exactly as the shape outlines are —
 * and so is the text, which the raster half gets for free from the Konva
 * group and this one has to say (KL-042).
 */
function standLabels(
  object: RectangleObject,
  grid: StandGrid,
  content: SheetContent,
  point: (world: { xM: number; yM: number }) => { x: number; y: number },
): PdfTextItem[] {
  const cells = labelledStandCells(object, grid);
  if (cells.length === 0) return [];

  // Sized against the space the cell actually occupies on paper, through
  // the same fitter the screen and the raster use — one rule, three
  // units. A flat point size could not be right twice: the same 6 pt was
  // handed to a cell 50 mm wide and to one of 5 mm. The bounds and the
  // padding live in `printing/standLabels.ts`, with the function the
  // export dialogue uses to warn that a scale cannot carry them.
  const fitted = fitStandLabelsPt(object, grid, pointsPerMeter(content), {
    enlarge: content.enlargeSmallText ?? false,
  });
  // Nothing fits at a size anyone could read: the cells print empty, as
  // they do on screen, rather than carrying a row of grey specks —
  // unless the sheet is holding the floor, in which case they print
  // over the cell's edges, which the dialogue warned about.
  if (!fitted) return [];

  const sizePt = fitted.fontSizePx;
  const step = sizePt * LABEL_LINE_HEIGHT;
  return cells.flatMap((cell, index) => {
    const centre = point(
      objectLocalToWorld(object, {
        xM: cell.xM + cell.widthM / 2,
        yM: cell.yM + cell.heightM / 2,
      }),
    );
    const lines = fitted.lines[index] ?? [cell.text];
    const topOffsetPt = ((lines.length - 1) * step) / 2 - CAP_HALF_HEIGHT * sizePt;
    return stackedText(lines, sizePt, centre, topOffsetPt, -object.rotationDeg);
  });
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
  const text: PdfTextItem[] = [
    ...vectors.text,
    {
      text: project.name,
      xPt: titleBlock.leftColumnXPt,
      yPt: titleBlock.upperBaselinePt,
      sizePt: 11,
    },
    {
      text: `${sheet.name}${pageLabel ? ` — ${pageLabel}` : ""} — Échelle ${formatScale(sheet.scaleDenominator)} — ${formatPaper(sheet)}`,
      xPt: titleBlock.rightColumnXPt,
      yPt: titleBlock.upperBaselinePt,
      sizePt: 9,
    },
    {
      text: formatDate(now),
      xPt: titleBlock.rightColumnXPt,
      yPt: titleBlock.lowerBaselinePt,
      sizePt: 8,
    },
    // Label sits above the bar, which occupies the lower baseline.
    {
      text: `${scaleBar.lengthM} m`,
      xPt: scaleBar.xPt,
      yPt: scaleBar.yPt + scaleBar.heightPt + mmToPt(1),
      sizePt: 7,
    },
  ];

  const block = sheet.titleBlock;
  const clientAndLocation = [block?.client ? `Client : ${block.client}` : "", project.location]
    .filter(Boolean)
    .join(" — ");
  if (clientAndLocation) {
    text.push({
      text: clientAndLocation,
      xPt: titleBlock.leftColumnXPt,
      yPt: titleBlock.lowerBaselinePt,
      sizePt: 8,
    });
  }

  const delivery = [
    block?.planNumber ? `Plan ${block.planNumber}` : "",
    block?.revision ? `Rév. ${block.revision}` : "",
    block?.author ? `Auteur ${block.author}` : "",
  ]
    .filter(Boolean)
    .join(" — ");
  if (delivery)
    text.push({
      text: delivery,
      xPt: titleBlock.rightColumnXPt,
      yPt: titleBlock.lowerBaselinePt,
      sizePt: 7,
    });
  if (block?.comments)
    text.push({
      text: block.comments,
      xPt: titleBlock.middleColumnXPt,
      yPt: titleBlock.upperBaselinePt,
      sizePt: 7,
    });
  for (const [index, field] of (block?.customFields ?? []).slice(0, 3).entries()) {
    text.push({
      text: `${field.label} : ${field.value}`,
      xPt: titleBlock.middleColumnXPt,
      yPt: titleBlock.upperBaselinePt - mmToPt(3 + index * 2.5),
      sizePt: 6,
    });
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
    images:
      logoBytes && logoSize
        ? [
            {
              jpeg: logoBytes,
              pixelWidth: logoSize.width,
              pixelHeight: logoSize.height,
              xPt: titleBlock.xPt + titleBlock.widthPt - mmToPt(22),
              yPt: titleBlock.yPt + mmToPt(2),
              widthPt: mmToPt(18),
              heightPt: mmToPt(12),
            },
          ]
        : undefined,
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
  return buildMultiPagePdf(
    contents.map((content, index) => buildSheetPdfPage(content, `${index + 1}/${contents.length}`)),
    {
      title: `${first.project.name} — plan d'implantation multipage`,
      creator: CREATOR,
      creationDate: toPdfDate(first.now),
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
