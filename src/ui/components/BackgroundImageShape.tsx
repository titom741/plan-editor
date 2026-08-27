import { Circle as KonvaCircle, Image as KonvaImage } from "react-konva";
import type Konva from "konva";
import { getRectangleResizeHandleWorld } from "../../domain/geometry";
import { resizeBackgroundFromCorner } from "../../domain/background";
import type { BackgroundImage } from "../../domain/types";
import { metersToPixels, screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";
import { useHtmlImage } from "../hooks/useHtmlImage";

interface BackgroundImageShapeProps {
  background: BackgroundImage;
  viewport: Viewport;
  selected: boolean;
  /** True only when the select tool is active and the background isn't locked. */
  draggable: boolean;
  /** True only when the select tool is active — regardless of lock state, unlike `draggable` (a locked background is still selectable, just read-only). Gates whether a click here claims the event or lets it bubble to the Stage for another tool (e.g. calibration) to handle. */
  selectable: boolean;
  onSelect: () => void;
  onBeginEdit: () => void;
  onMoveLive: (xM: number, yM: number) => void;
  onResizeLive: (widthM: number, heightM: number) => void;
}

const HANDLE_RADIUS_PX = 6;
const HANDLE_STROKE = "#e0470f";

/**
 * Renders the project's background image, converting its metric placement
 * through `rendering/viewport.ts` exactly like `PlanObjectShape` does for
 * business objects — a background is not a `PlanObject`, but it shares
 * the same "anchor + size in meters" shape, so it reuses the same
 * conversion pipeline rather than inventing a parallel one.
 */
export function BackgroundImageShape({
  background,
  viewport,
  selected,
  draggable,
  selectable,
  onSelect,
  onBeginEdit,
  onMoveLive,
  onResizeLive,
}: BackgroundImageShapeProps) {
  const image = useHtmlImage(background.url);
  const anchor = worldToScreen({ xM: background.xM, yM: background.yM }, viewport);
  const widthPx = metersToPixels(background.widthM, viewport);
  const heightPx = metersToPixels(background.heightM, viewport);

  const handleSelect = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Outside the select tool (e.g. calibrating), let the click bubble up
    // to the Stage so the active tool can handle it — the background
    // isn't the only thing that can sit under a click.
    if (!selectable) return;
    e.cancelBubble = true;
    onSelect();
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    onSelect();
    onBeginEdit();
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    const node = e.target;
    const world = screenToWorld({ x: node.x(), y: node.y() }, viewport);
    onMoveLive(world.xM, world.yM);
  };

  const handleMouseEnter = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!draggable) return;
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = "move";
  };

  const handleMouseLeave = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const container = e.target.getStage()?.container();
    if (container) container.style.cursor = "";
  };

  const resizeHandleWorld = getRectangleResizeHandleWorld({
    xM: background.xM,
    yM: background.yM,
    widthM: background.widthM,
    heightM: background.heightM,
    rotationDeg: 0,
  });
  const resizeHandleScreen = worldToScreen(resizeHandleWorld, viewport);

  if (!image) return null;

  return (
    <>
      <KonvaImage
        image={image}
        x={anchor.x}
        y={anchor.y}
        width={widthPx}
        height={heightPx}
        opacity={background.opacity}
        stroke={selected ? HANDLE_STROKE : undefined}
        strokeWidth={selected ? 2 : 0}
        draggable={draggable}
        onClick={handleSelect}
        onTap={handleSelect}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
      />
      {selected && draggable && (
        <KonvaCircle
          x={resizeHandleScreen.x}
          y={resizeHandleScreen.y}
          radius={HANDLE_RADIUS_PX}
          fill="#ffffff"
          stroke={HANDLE_STROKE}
          strokeWidth={2}
          draggable
          onDragStart={(e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            onBeginEdit();
          }}
          onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            const node = e.target;
            const pointerWorld = screenToWorld({ x: node.x(), y: node.y() }, viewport);
            const { widthM, heightM } = resizeBackgroundFromCorner(background, pointerWorld);
            onResizeLive(widthM, heightM);
          }}
          onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "nwse-resize";
          }}
          onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "";
          }}
        />
      )}
    </>
  );
}
