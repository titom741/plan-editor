import { useEffect, type Ref } from "react";
import { Image as KonvaImage, Layer as KonvaLayer, Line, Rect, Stage } from "react-konva";
import type Konva from "konva";
import { computeGridLines } from "../../rendering/grid";
import { metersToPixels, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";
import type { Background, Layer, PlanObject } from "../../domain/types";
import { PlanObjectShape } from "./PlanObjectShape";
import { useHtmlImage } from "../hooks/useHtmlImage";

interface PrintCanvasProps {
  stageRef: Ref<Konva.Stage>;
  pixelWidth: number;
  pixelHeight: number;
  viewport: Viewport;
  objects: PlanObject[];
  layers: Layer[];
  background: Background;
  showGrid: boolean;
  /** Screen-pixel sizes (strokes, labels) are multiplied by this so they come out the right physical size at print resolution. */
  renderScale: number;
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
  background,
  showGrid,
  renderScale,
  onReady,
}: PrintCanvasProps) {
  const backgroundVisible = background?.visible === true;
  const image = useHtmlImage(backgroundVisible ? background.url : null);
  const waitingForImage = backgroundVisible && image === null;

  // Rasterising before the background has decoded would silently produce a
  // plan with a blank backdrop, so the caller is told only once there is
  // nothing left to wait for.
  useEffect(() => {
    if (waitingForImage) return;
    onReady();
  }, [waitingForImage, onReady]);

  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const grid = showGrid ? computeGridLines(viewport, pixelWidth, pixelHeight) : null;

  const backgroundAnchor = background ? worldToScreen({ xM: background.xM, yM: background.yM }, viewport) : null;

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
        <Rect x={0} y={0} width={pixelWidth} height={pixelHeight} fill="#ffffff" listening={false} />
        {backgroundVisible && image && backgroundAnchor && (
          <KonvaImage
            image={image}
            x={backgroundAnchor.x}
            y={backgroundAnchor.y}
            width={metersToPixels(background.widthM, viewport)}
            height={metersToPixels(background.heightM, viewport)}
            opacity={background.opacity}
            listening={false}
          />
        )}
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
              object={object}
              viewport={viewport}
              selected={false}
              draggable={false}
              selectable={false}
              renderScale={renderScale}
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
