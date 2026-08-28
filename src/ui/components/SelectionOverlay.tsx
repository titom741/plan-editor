import { Circle as KonvaCircle, Line as KonvaLine, Rect as KonvaRect } from "react-konva";
import type Konva from "konva";
import {
  CIRCLE_HANDLE_IDS,
  computeRotationFromPointer,
  getLocalCenter,
  objectLocalToWorld,
  rotateObjectToDeg,
  getCircleHandleWorld,
  getRectangleHandleWorld,
  getRotateHandleWorld,
  getSegmentCount,
  getSegmentMidpointWorld,
  getVertexWorld,
  insertVertexAfter,
  MIN_LINE_POINTS,
  MIN_POLYGON_POINTS,
  moveVertexTo,
  normalizeAngleDeg,
  removeVertexAt,
  RESIZE_HANDLE_IDS,
  resizeCircleFromHandle,
  resizeRectangleFromHandle,
} from "../../domain/geometry";
import type { ResizeHandleId } from "../../domain/geometry";
import type { BoundsM } from "../../domain/bounds";
import type { PlanObject, PlanObjectPatch, PointM } from "../../domain/types";
import { screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";

interface SelectionOverlayProps {
  object: PlanObject;
  viewport: Viewport;
  onBeginEdit: () => void;
  /** Applies a partial geometry change to the selected object, live (no new undo step). */
  onLiveUpdate: (patch: PlanObjectPatch) => void;
  /** Applies a one-shot structural change — adding or removing a vertex — as its own undo step. */
  onCommit: (patch: PlanObjectPatch) => void;
  /** Pulls a pointer position onto a snap target (KL-007). Applied to resize and vertex handles; a rotation follows the pointer's angle, which has nothing to snap to. */
  snapWorld: (pointM: PointM) => PointM;
}

/** Screen-pixel gap between a shape and its rotate handle — constant on screen at any zoom, since it's converted to meters fresh from the current viewport. */
const ROTATE_HANDLE_GAP_PX = 28;
const HANDLE_RADIUS_PX = 6;
const RESIZE_HANDLE_SIZE_PX = 10;
/** Midpoint "add a vertex here" handles are drawn smaller and paler than real vertices, so the two are never confused. */
const INSERT_HANDLE_RADIUS_PX = 4.5;
const HANDLE_FILL = "#ffffff";
const HANDLE_STROKE = "#e0470f";
const VERTEX_FILL = "#e0470f";

/** The eight resize cursors, in the same clockwise order as a handle's compass angle. */
const RESIZE_CURSORS = [
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
  "ns-resize",
  "nesw-resize",
  "ew-resize",
  "nwse-resize",
];

const HANDLE_ANGLE_DEG: Record<ResizeHandleId, number> = {
  n: 0,
  ne: 45,
  e: 90,
  se: 135,
  s: 180,
  sw: 225,
  w: 270,
  nw: 315,
};

/**
 * The cursor for a resize handle, chosen from where the handle actually
 * sits *on screen* once the object's rotation is taken into account —
 * a "nwse-resize" arrow on the corner of a rectangle rotated 90° would
 * point the wrong way and quietly tell the user the wrong thing.
 */
function resizeCursorFor(handle: ResizeHandleId, rotationDeg: number): string {
  const index = Math.round(normalizeAngleDeg(HANDLE_ANGLE_DEG[handle] + rotationDeg) / 45) % 8;
  return RESIZE_CURSORS[index] ?? "nwse-resize";
}

interface OverlayHandle {
  key: string;
  worldPoint: PointM;
  shape: "square" | "circle" | "dot";
  cursor: string;
  onDragMove?: (pointerWorld: PointM, modifiers: { shiftKey: boolean }) => void;
  /** Whether this handle's pointer position goes through snapping. */
  snaps?: boolean;
  onClick?: () => void;
  onDoubleClick?: () => void;
}

/**
 * Draws the resize/rotate/vertex handles for the currently selected object
 * and turns their drags into geometry updates — the only place `ui/`
 * performs a resize, rotation or vertex edit, always by calling into
 * `domain/geometry.ts`'s pure solve functions with the pointer's current
 * *world* position, never by accumulating pixel deltas. That's what keeps
 * editing drift-free across zoom changes.
 */
export function SelectionOverlay({
  object,
  viewport,
  onBeginEdit,
  onLiveUpdate,
  onCommit,
  snapWorld,
}: SelectionOverlayProps) {
  const gapM = ROTATE_HANDLE_GAP_PX / (viewport.basePixelsPerMeter * viewport.zoom);
  const anchorWorld: PointM = { xM: object.xM, yM: object.yM };
  const handles: OverlayHandle[] = [];

  /**
   * The pivot is the object's own centre, not its anchor. The model still
   * stores rotation about the anchor — that is what keeps rendering,
   * bounds and PDF export on one convention — so the gesture measures the
   * angle from the centre and `rotateObjectToDeg` solves for the anchor
   * that keeps that centre still. Rotating a chapiteau about its top-left
   * corner would swing it across the plan, which is never what anyone
   * means by "rotate this".
   */
  const centerWorld = objectLocalToWorld(object, getLocalCenter(object));

  const rotateHandle = (localOffset?: { xM: number; yM: number }): OverlayHandle => ({
    key: "rotate",
    worldPoint: getRotateHandleWorld(anchorWorld, object.rotationDeg, gapM, localOffset),
    shape: "circle",
    cursor: "grab",
    onDragMove: (pointerWorld, modifiers) => {
      const rawRotation = computeRotationFromPointer(centerWorld, pointerWorld);
      const rotationDeg = modifiers.shiftKey
        ? (Math.round(rawRotation / 15) * 15) % 360
        : rawRotation;
      onLiveUpdate(rotateObjectToDeg(object, rotationDeg));
    },
  });

  if (object.type === "rectangle" || object.type === "image") {
    for (const handle of RESIZE_HANDLE_IDS) {
      handles.push({
        key: `resize-${handle}`,
        worldPoint: getRectangleHandleWorld(object, handle),
        shape: "square",
        snaps: true,
        cursor: resizeCursorFor(handle, object.rotationDeg),
        onDragMove: (pointerWorld, modifiers) =>
          onLiveUpdate(
            resizeRectangleFromHandle(object, handle, pointerWorld, {
              keepAspectRatio: modifiers.shiftKey,
            }),
          ),
      });
    }
    handles.push(rotateHandle({ xM: object.widthM / 2, yM: 0 }));
  } else if (object.type === "circle") {
    for (const handle of CIRCLE_HANDLE_IDS) {
      handles.push({
        key: `resize-${handle}`,
        worldPoint: getCircleHandleWorld(object, handle),
        shape: "square",
        snaps: true,
        // The handle sits at a fixed compass point; a circle's own rotation
        // doesn't move it, so the cursor doesn't rotate either.
        cursor: resizeCursorFor(handle, 0),
        onDragMove: (pointerWorld) => onLiveUpdate(resizeCircleFromHandle(object, pointerWorld)),
      });
    }
    // No rotate handle: a circle looks identical at every rotation.
  } else if (object.type === "line" || object.type === "polygon") {
    const closed = object.type === "polygon";
    const minimumPoints = closed ? MIN_POLYGON_POINTS : MIN_LINE_POINTS;

    object.pointsM.forEach((_, index) => {
      const worldPoint = getVertexWorld(object, index);
      if (!worldPoint) return;
      handles.push({
        key: `vertex-${index}`,
        worldPoint,
        shape: "circle",
        snaps: true,
        cursor: "move",
        onDragMove: (pointerWorld) => {
          const moved = moveVertexTo(object, index, pointerWorld);
          if (moved) onLiveUpdate(moved);
        },
        onDoubleClick: () => {
          // Refused rather than silently ignored further down: a polygon
          // with two points isn't a polygon.
          const removed = removeVertexAt(object, index, minimumPoints);
          if (removed) onCommit(removed);
        },
      });
    });

    for (let index = 0; index < getSegmentCount(object, closed); index += 1) {
      const worldPoint = getSegmentMidpointWorld(object, index, closed);
      if (!worldPoint) continue;
      handles.push({
        key: `insert-${index}`,
        worldPoint,
        shape: "dot",
        cursor: "copy",
        onClick: () => onCommit(insertVertexAfter(object, index, worldPoint)),
      });
    }

    handles.push(rotateHandle());
  } else {
    // text: rotate around its own anchor, nothing to resize.
    handles.push(rotateHandle());
  }

  const anchorScreen = worldToScreen(anchorWorld, viewport);
  const rotate = handles.find((handle) => handle.key === "rotate");
  const rotateScreen = rotate ? worldToScreen(rotate.worldPoint, viewport) : null;

  return (
    <>
      {rotateScreen && (
        <KonvaLine
          points={[anchorScreen.x, anchorScreen.y, rotateScreen.x, rotateScreen.y]}
          stroke={HANDLE_STROKE}
          strokeWidth={1}
          dash={[4, 4]}
          listening={false}
        />
      )}
      {handles.map((handle) => {
        const screenPoint = worldToScreen(handle.worldPoint, viewport);
        const commonProps = {
          draggable: handle.onDragMove !== undefined,
          onDragStart: (e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            onBeginEdit();
          },
          onDragMove: (e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            if (!handle.onDragMove) return;
            const node = e.target;
            // A square handle is drawn from its top-left, so its own
            // position isn't where the user is pointing — read the pointer
            // from the stage instead of the node for both shapes, and the
            // two behave identically.
            const pointer = node.getStage()?.getPointerPosition();
            const rawWorld = screenToWorld(pointer ?? { x: node.x(), y: node.y() }, viewport);
            const pointerWorld = handle.snaps ? snapWorld(rawWorld) : rawWorld;
            handle.onDragMove(pointerWorld, { shiftKey: e.evt.shiftKey });
          },
          onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => {
            e.cancelBubble = true;
            // The handle node has been dragged away from where the shape's
            // geometry now says it belongs. Nothing reconciles the two, so
            // snap it back and let the next render place it.
            e.target.position({ x: screenPoint.x, y: screenPoint.y });
          },
          onClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
            handle.onClick?.();
          },
          onDblClick: (e: Konva.KonvaEventObject<MouseEvent>) => {
            e.cancelBubble = true;
            handle.onDoubleClick?.();
          },
          onMouseEnter: (e: Konva.KonvaEventObject<MouseEvent>) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = handle.cursor;
          },
          onMouseLeave: (e: Konva.KonvaEventObject<MouseEvent>) => {
            const container = e.target.getStage()?.container();
            if (container) container.style.cursor = "";
          },
        };

        if (handle.shape === "square") {
          return (
            <KonvaRect
              key={handle.key}
              x={screenPoint.x}
              y={screenPoint.y}
              offsetX={RESIZE_HANDLE_SIZE_PX / 2}
              offsetY={RESIZE_HANDLE_SIZE_PX / 2}
              width={RESIZE_HANDLE_SIZE_PX}
              height={RESIZE_HANDLE_SIZE_PX}
              fill={HANDLE_FILL}
              stroke={HANDLE_STROKE}
              strokeWidth={2}
              {...commonProps}
            />
          );
        }

        return (
          <KonvaCircle
            key={handle.key}
            x={screenPoint.x}
            y={screenPoint.y}
            radius={handle.shape === "dot" ? INSERT_HANDLE_RADIUS_PX : HANDLE_RADIUS_PX}
            fill={handle.shape === "dot" ? "rgba(255, 255, 255, 0.85)" : HANDLE_FILL}
            stroke={handle.key.startsWith("vertex-") ? VERTEX_FILL : HANDLE_STROKE}
            strokeWidth={handle.shape === "dot" ? 1.5 : 2}
            dash={handle.shape === "dot" ? [2, 2] : undefined}
            {...commonProps}
          />
        );
      })}
    </>
  );
}

/**
 * The dashed box around a multi-selection.
 *
 * Handles are deliberately absent: resizing several objects at once means
 * deciding what "resize" does to a circle and a text label in the same
 * gesture, and that is a design question, not a missing feature. Moving,
 * nudging, duplicating and deleting all work on the group; scaling one is
 * left for a later mission rather than guessed at here.
 */
export function MultiSelectionOutline({
  bounds,
  viewport,
}: {
  bounds: BoundsM;
  viewport: Viewport;
}) {
  const topLeft = worldToScreen({ xM: bounds.minXM, yM: bounds.minYM }, viewport);
  const bottomRight = worldToScreen({ xM: bounds.maxXM, yM: bounds.maxYM }, viewport);
  return (
    <KonvaRect
      x={topLeft.x}
      y={topLeft.y}
      width={bottomRight.x - topLeft.x}
      height={bottomRight.y - topLeft.y}
      stroke={HANDLE_STROKE}
      strokeWidth={1.5}
      dash={[6, 4]}
      listening={false}
    />
  );
}
