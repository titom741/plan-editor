import { useRef } from "react";
import type Konva from "konva";
import type { BackgroundImage, Layer, PlanObject, Project, Sheet } from "../../domain/types";
import type { SheetLayout } from "../../printing/sheetLayout";
import { computePrintRaster } from "../../printing/sheetLayout";
import { formatScale } from "../../domain/sheets";
import { DEFAULT_LABEL_DISPLAY } from "../../domain/display";
import { PrintCanvas } from "./PrintCanvas";

const PREVIEW_DPI = 34;
function noop() {}

interface SheetPreviewProps {
  project: Project;
  sheet: Sheet;
  layout: SheetLayout;
  objects: PlanObject[];
  layers: Layer[];
  backgrounds: readonly BackgroundImage[];
  showGrid: boolean;
}

export function SheetPreview({ project, sheet, layout, objects, layers, backgrounds, showGrid }: SheetPreviewProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const raster = computePrintRaster(layout, PREVIEW_DPI);
  const pxPerPt = PREVIEW_DPI / 72;
  const pageWidth = layout.pageWidthPt * pxPerPt;
  const pageHeight = layout.pageHeightPt * pxPerPt;
  const drawingLeft = layout.drawing.xPt * pxPerPt;
  const drawingTop = (layout.pageHeightPt - layout.drawing.yPt - layout.drawing.heightPt) * pxPerPt;
  const frameLeft = layout.frame.xPt * pxPerPt;
  const frameTop = (layout.pageHeightPt - layout.frame.yPt - layout.frame.heightPt) * pxPerPt;
  return (
    <div className="sheet-preview" aria-label="Aperçu de la feuille finale">
      <div className="sheet-preview__page" style={{ width: pageWidth, height: pageHeight }}>
        <div className="sheet-preview__frame" style={{ left: frameLeft, top: frameTop, width: layout.frame.widthPt * pxPerPt, height: layout.frame.heightPt * pxPerPt }} />
        <div className="sheet-preview__drawing" style={{ left: drawingLeft, top: drawingTop, width: raster.pixelWidth, height: raster.pixelHeight }}>
          <PrintCanvas stageRef={stageRef} pixelWidth={raster.pixelWidth} pixelHeight={raster.pixelHeight} viewport={raster.viewport} objects={objects} layers={layers} backgrounds={backgrounds} showGrid={showGrid} labelDisplay={project.labelDisplay ?? DEFAULT_LABEL_DISPLAY} renderScale={PREVIEW_DPI / 96} onReady={noop} />
        </div>
        <div className="sheet-preview__title" style={{ left: frameLeft, bottom: layout.frame.yPt * pxPerPt, width: layout.frame.widthPt * pxPerPt, height: layout.titleBlock.heightPt * pxPerPt }}>
          <strong>{project.name}</strong><span>{sheet.name} · {formatScale(sheet.scaleDenominator)}</span>
          <small>{sheet.titleBlock?.client || project.location || " "}</small><small>{sheet.titleBlock?.revision ? `Rév. ${sheet.titleBlock.revision}` : " "}</small>
        </div>
      </div>
    </div>
  );
}
