import { Circle as KonvaCircle, Line as KonvaLine } from "react-konva";
import type Konva from "konva";
import {
  computeRotationFromPointer,
  getCircleResizeHandleWorld,
  getRectangleResizeHandleWorld,
  getRotateHandleWorld,
  resizeCircleFromHandle,
  resizeRectangleFromCorner,
} from "../../domain/geometry";
import type { PlanObject, PlanObjectPatch } from "../../domain/types";
import { screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";

interface SelectionOverlayProps {
  object: PlanObject;
  viewport: Viewport;
  onBeginEdit: () => void;
  /** Applies a partial geometry change to the selected object, live (no new undo step). */
  onLiveUpdate: (patch: PlanObjectPatch) => void;
}

/** Screen-pixel gap between a shape and its rotate handle — constant on screen at any zoom, since it's converted to meters fresh from the current viewport. */
const ROTATE_HANDLE_GAP_PX = 28;
const HANDLE_RADIUS_PX = 6;
const HANDLE_FILL = "#ffffff";
const HANDLE_STROKE = "#e0470f";

/**
 * Draws the resize/rotate handles for the currently selected object and
 * turns their drags into geometry updates — the only place `ui/` performs
 * a resize or rotation, always by calling into `domain/geometry.ts`'s pure
 * solve functions with the pointer's current *world* position, never by
 * accumulating pixel deltas. That's what keeps a resize or rotation
 * drift-free across zoom changes.
 */
export function SelectionOverlay({ object, viewport, onBeginEdit, onLiveUpdate }: SelectionOverlayProps) {
  const gapM = ROTATE_HANDLE_GAP_PX / (viewport.basePixelsPerMeter * viewport.zoom);
  const anchorWorld = { xM: object.xM, yM: object.yM };

  const handles: {
    key: string;
    worldPoint: { xM: number; yM: number };
    onDragMove: (pointerWorld: { xM: number; yM: number }) => void;
  }[] = [];

  if (object.type === "rectangle") {
    handles.push({
      key: "resize",
      worldPoint: getRectangleResizeHandleWorld(object),
      onDragMove: (pointerWorld) => onLiveUpdate(resizeRectangleFromCorner(object, pointerWorld)),
    });
    handles.push({
      key: "rotate",
      worldPoint: getRotateHandleWorld(anchorWorld, object.rotationDeg, gapM, {
        xM: object.widthM / 2,
        yM: 0,
      }),
      onDragMove: (pointerWorld) =>
        onLiveUpdate({ rotationDeg: computeRotationFromPointer(anchorWorld, pointerWorld) }),
    });
  } else if (object.type === "circle") {
    handles.push({
      key: "resize",
      worldPoint: getCircleResizeHandleWorld(object),
      onDragMove: (pointerWorld) => onLiveUpdate(resizeCircleFromHandle(object, pointerWorld)),
    });
    // No rotate handle: a circle looks identical at every rotation.
  } else {
    // line, polygon, text: rotate around their own anchor.
    handles.push({
      key: "rotate",
      worldPoint: getRotateHandleWorld(anchorWorld, object.rotationDeg, gapM),
      onDragMove: (pointerWorld) =>
        onLiveUpdate({ rotationDeg: computeRotationFromPointer(anchorWorld, pointerWorld) }),
    });
  }

  const anchorScreen = worldToScreen(anchorWorld, viewport);
  const rotateHandle = handles.find((h) => h.key === "rotate");
  const rotateHandleScreen = rotateHandle ? worldToScreen(rotateHandle.worldPoint, viewport) : null;

  return (
    <>
      {rotateHandleScreen && (
        <KonvaLine
          points={[anchorScreen.x, anchorScreen.y, rotateHandleScreen.x, rotateHandleScreen.y]}
          stroke={HANDLE_STROKE}
          strokeWidth={1}
          dash={[4, 4]}
          listening={false}
        />
      )}
      {handles.map((handle) => {
        const screenPoint = worldToScreen(handle.worldPoint, viewport);
        return (
          <KonvaCircle
            key={handle.key}
            x={screenPoint.x}
            y={screenPoint.y}
            radius={HANDLE_RADIUS_PX}
            fill={HANDLE_FILL}
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
              handle.onDragMove(pointerWorld);
            }}
            onMouseEnter={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = handle.key === "rotate" ? "grab" : "nwse-resize";
            }}
            onMouseLeave={(e: Konva.KonvaEventObject<MouseEvent>) => {
              const container = e.target.getStage()?.container();
              if (container) container.style.cursor = "";
            }}
          />
        );
      })}
    </>
  );
}
