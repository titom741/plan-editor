import { useCallback, useEffect, useLayoutEffect, useRef, useState, type Ref } from "react";
import { Image as KonvaImage, Layer as KonvaLayer, Line, Rect, Stage } from "react-konva";
import Konva from "konva";
import { computeGridLines } from "../../rendering/grid";
import { metersToPixels, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";
import type { BackgroundImage, Layer, PlanObject } from "../../domain/types";
import { PlanObjectShape } from "./PlanObjectShape";
import type { LabelDisplay } from "../../domain/display";
import { useHtmlImage } from "../hooks/useHtmlImage";
import { createWhiteRemovalFilter } from "../imageFilters";
import { MIN_READABLE_PT } from "../../printing/standLabels";
import { POINTS_PER_INCH } from "../../printing/pdf";

interface PrintCanvasProps {
  stageRef: Ref<Konva.Stage>;
  pixelWidth: number;
  pixelHeight: number;
  viewport: Viewport;
  objects: PlanObject[];
  layers: Layer[];
  backgrounds: readonly BackgroundImage[];
  showGrid: boolean;
  labelDisplay: LabelDisplay;
  /** Screen-pixel sizes (strokes, labels) are multiplied by this so they come out the right physical size at print resolution. */
  renderScale: number;
  /**
   * The resolution this raster is drawn at, needed only to turn the
   * readable floor — which is a size on *paper*, in points — into this
   * stage's own pixels. Omitted, no floor is held.
   */
  effectiveDpi?: number;
  /** Hold every text to the readable floor, letting it spill rather than vanish (KL-043). */
  enlargeSmallText?: boolean;
  transparentBackground?: boolean;
  /** Called once everything that needs loading has loaded and the stage is safe to rasterise. */
  onReady: () => void;
}

/**
 * The plan as it goes on paper: the same shapes as the editor, drawn into
 * an off-screen stage sized to the sheet's drawing area.
 *
 * It reuses `PlanObjectShape` deliberately. The alternative — translating
 * the model into PDF drawing operators — would be a second renderer, and
 * every fill, stroke, label and rotation would have to be kept in step
 * with this one by hand. Rendering through the component the editor
 * already uses means what you print is what you saw, by construction.
 *
 * What it drops is everything that only makes sense on screen: selection
 * outlines, resize handles, hover cursors, and any interactivity at all
 * (`listening={false}` throughout — this stage is never clicked).
 *
 * The background is drawn directly rather than through
 * `BackgroundImageShape`, which exists to be dragged and resized; on paper
 * it's just an image at a position. Both go through the same
 * `worldToScreen` / `metersToPixels`, which is where the shared truth
 * actually lives.
 */
export function PrintCanvas({
  stageRef,
  pixelWidth,
  pixelHeight,
  viewport,
  objects,
  layers,
  backgrounds,
  showGrid,
  labelDisplay,
  renderScale,
  effectiveDpi,
  enlargeSmallText = false,
  transparentBackground = false,
  onReady,
}: PrintCanvasProps) {
  /**
   * The readable floor in this stage's pixels. A point is 1/72 inch and
   * the stage is `effectiveDpi` pixels to the inch, so the conversion is
   * the resolution itself — the same arithmetic the PDF half does in
   * reverse, which is why both halves come out at one size.
   */
  const minTextPx =
    enlargeSmallText && effectiveDpi ? (MIN_READABLE_PT * effectiveDpi) / POINTS_PER_INCH : 0;
  // Only the bottom visible backdrop is filtered/cached here; the rest are
  // drawn by `PrintBackground` below, one component each, because Konva
  // filters are per node and a hook can't be called in a loop.
  const visibleBackgrounds = backgrounds.filter((background) => background.visible);

  /**
   * Which backdrops have finished decoding. Rasterising before they have
   * would silently produce a plan with blank backdrops, so the caller is
   * told only once every one of them is in.
   */
  const [loadedIds, setLoadedIds] = useState<ReadonlySet<string>>(new Set());
  const handleBackgroundLoaded = useCallback((id: string) => {
    setLoadedIds((current) => (current.has(id) ? current : new Set(current).add(id)));
  }, []);
  const waitingForImages = visibleBackgrounds.some((background) => !loadedIds.has(background.id));

  useEffect(() => {
    if (waitingForImages) return;
    onReady();
  }, [waitingForImages, onReady]);

  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const grid = showGrid ? computeGridLines(viewport, pixelWidth, pixelHeight) : null;

  return (
    <Stage ref={stageRef} width={pixelWidth} height={pixelHeight} listening={false}>
      <KonvaLayer listening={false}>
        {/*
          An explicit white ground. A Konva stage is transparent where
          nothing is drawn, and JPEG has no alpha channel — so without this
          every uncovered part of the sheet encodes as black, and the plan
          prints as a solid dark rectangle. Drawn here rather than left to
          the PDF so the PNG export gets the same treatment.
        */}
        {!transparentBackground && (
          <Rect
            x={0}
            y={0}
            width={pixelWidth}
            height={pixelHeight}
            fill="#ffffff"
            listening={false}
          />
        )}
        {visibleBackgrounds.map((background) => (
          <PrintBackground
            key={background.id}
            background={background}
            viewport={viewport}
            onLoaded={handleBackgroundLoaded}
          />
        ))}
      </KonvaLayer>
      {grid && (
        <KonvaLayer listening={false}>
          {grid.vertical.map((line) => (
            <Line
              key={`v-${line.points[0]}`}
              points={line.points}
              stroke={line.isAxis ? "#94a3b8" : "#e2e8f0"}
              strokeWidth={(line.isAxis ? 1.5 : 1) * renderScale}
            />
          ))}
          {grid.horizontal.map((line) => (
            <Line
              key={`h-${line.points[1]}`}
              points={line.points}
              stroke={line.isAxis ? "#94a3b8" : "#e2e8f0"}
              strokeWidth={(line.isAxis ? 1.5 : 1) * renderScale}
            />
          ))}
        </KonvaLayer>
      )}
      <KonvaLayer listening={false}>
        {objects
          .filter((object) => visibleLayerIds.has(object.layerId))
          .map((object) => (
            <PlanObjectShape
              key={object.id}
              labelDisplay={labelDisplay}
              object={object}
              viewport={viewport}
              selected={false}
              draggable={false}
              selectable={false}
              renderScale={renderScale}
              minTextPx={minTextPx}
              onSelect={noop}
              onBeginEdit={noop}
              onMoveLive={noop}
            />
          ))}
      </KonvaLayer>
    </Stage>
  );
}

function noop() {}

/**
 * One backdrop on the print stage.
 *
 * A component of its own because Konva's filters are per node and have to
 * be applied through `cache()` in a layout effect — neither of which can
 * be done in a loop inside the parent. It reports back once its image has
 * decoded so the parent knows when the whole stage is safe to rasterise.
 */
function PrintBackground({
  background,
  viewport,
  onLoaded,
}: {
  background: BackgroundImage;
  viewport: Viewport;
  onLoaded: (id: string) => void;
}) {
  const image = useHtmlImage(background.url);
  const nodeRef = useRef<Konva.Image>(null);

  const filters = [
    ...(background.brightness !== 0 ? [Konva.Filters.Brighten] : []),
    ...(background.contrast !== 0 ? [Konva.Filters.Contrast] : []),
    ...(background.grayscale ? [Konva.Filters.Grayscale] : []),
    ...(background.whiteRemoval ? [createWhiteRemovalFilter(background.whiteThreshold)] : []),
  ];
  const hasFilters = filters.length > 0;

  useLayoutEffect(() => {
    const node = nodeRef.current;
    if (!node) return;
    if (hasFilters) node.cache({ pixelRatio: 1 });
    else node.clearCache();
  }, [
    image,
    background.brightness,
    background.contrast,
    background.grayscale,
    background.whiteRemoval,
    background.whiteThreshold,
    background.crop?.xPx,
    background.crop?.yPx,
    background.crop?.widthPx,
    background.crop?.heightPx,
    hasFilters,
  ]);

  const id = background.id;
  useEffect(() => {
    if (image) onLoaded(id);
  }, [image, id, onLoaded]);

  if (!image) return null;
  const anchor = worldToScreen({ xM: background.xM, yM: background.yM }, viewport);
  return (
    <KonvaImage
      ref={nodeRef}
      image={image}
      x={anchor.x}
      y={anchor.y}
      width={metersToPixels(background.widthM, viewport)}
      height={metersToPixels(background.heightM, viewport)}
      rotation={background.rotationDeg}
      opacity={background.opacity}
      filters={filters}
      brightness={background.brightness}
      contrast={background.contrast}
      crop={
        background.crop
          ? {
              x: background.crop.xPx,
              y: background.crop.yPx,
              width: background.crop.widthPx,
              height: background.crop.heightPx,
            }
          : undefined
      }
      listening={false}
    />
  );
}
