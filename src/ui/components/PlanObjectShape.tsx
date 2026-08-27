import { Circle, Group, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import { getObjectDisplayLabel } from "../../domain/labels";
import type { PlanObject } from "../../domain/types";
import { metersToPixels, screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";

interface PlanObjectShapeProps {
  object: PlanObject;
  viewport: Viewport;
  selected: boolean;
  /** True only when the select tool is active and the object's layer isn't locked. */
  draggable: boolean;
  /** True only when the select tool is active — regardless of lock state, unlike `draggable`. Gates whether a click here claims the event or lets it bubble to the Stage for another tool (e.g. polygon point-picking, calibration) to handle — an object can sit under a click made with any tool, not just Selection. */
  selectable: boolean;
  /**
   * Multiplier for sizes that are in *screen* pixels rather than metres —
   * label text and stroke widths. 1 on screen; on a print raster it's the
   * ratio of print resolution to screen resolution, so a line that reads
   * as one pixel on a monitor comes out the same physical thickness on
   * paper instead of a hairline (see `PrintCanvas`).
   */
  renderScale?: number;
  /** `additive` is true when Shift (or Ctrl/Cmd) was held — the caller then toggles this object in the selection instead of replacing it. */
  onSelect: (additive: boolean) => void;
  /** Snapshots undo history once, at the start of a drag gesture. */
  onBeginEdit: () => void;
  /** Called continuously while dragging, with the object's new anchor in world coordinates. */
  onMoveLive: (xM: number, yM: number) => void;
}

const SELECTED_STROKE = "#e0470f";

/** Shift (or Ctrl/Cmd, for the platform habits people arrive with) means "add to / remove from the selection" rather than "replace it". */
function isAdditive(event: MouseEvent | TouchEvent): boolean {
  return event.shiftKey || event.metaKey || event.ctrlKey;
}

/**
 * Renders one `PlanObject` as a Konva shape. This is the only place that
 * converts a business object's real-world geometry into pixels — every
 * value is derived through `metersToPixels` / `worldToScreen`, never
 * hardcoded, so the same object renders correctly at any zoom level. It's
 * also the only place a shape's *own* dragging (moving it) is handled;
 * resize/rotate handles live in `SelectionOverlay`.
 */
export function PlanObjectShape({
  object,
  viewport,
  selected,
  draggable,
  selectable,
  renderScale = 1,
  onSelect,
  onBeginEdit,
  onMoveLive,
}: PlanObjectShapeProps) {
  const anchor = worldToScreen({ xM: object.xM, yM: object.yM }, viewport);
  /** A width given in screen pixels, converted to this render target's pixels. */
  const px = (screenPx: number) => screenPx * renderScale;

  const handleSelect = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    // Outside the select tool, let the click bubble up to the Stage so
    // the active tool can handle it instead (e.g. adding a polygon point,
    // or picking a calibration point, on top of an existing object).
    if (!selectable) return;
    e.cancelBubble = true;
    onSelect(isAdditive(e.evt));
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    // Dragging an object that is already part of a multi-selection must
    // move the whole group, so only an unselected object claims the
    // selection for itself here.
    if (!selected) onSelect(false);
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

  const commonGroupProps = {
    x: anchor.x,
    y: anchor.y,
    rotation: object.rotationDeg,
    draggable,
    onClick: handleSelect,
    onTap: handleSelect,
    onDragStart: handleDragStart,
    onDragMove: handleDragMove,
    onMouseEnter: handleMouseEnter,
    onMouseLeave: handleMouseLeave,
  };

  switch (object.type) {
    case "rectangle": {
      const widthPx = metersToPixels(object.widthM, viewport);
      const heightPx = metersToPixels(object.heightM, viewport);
      return (
        <Group {...commonGroupProps}>
          <Rect
            width={widthPx}
            height={heightPx}
            fill={object.style?.fill ?? "#dbeafe"}
            stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#2563eb")}
            strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
            opacity={object.style?.opacity ?? 1}
          />
          <Text
            text={getObjectDisplayLabel(object)}
            width={widthPx}
            height={heightPx}
            align="center"
            verticalAlign="middle"
            fontSize={px(14)}
            fill="#0f172a"
            listening={false}
          />
        </Group>
      );
    }
    case "circle": {
      const radiusPx = metersToPixels(object.radiusM, viewport);
      return (
        <Group {...commonGroupProps}>
          <Circle
            radius={radiusPx}
            fill={object.style?.fill ?? "#dcfce7"}
            stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#16a34a")}
            strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
            opacity={object.style?.opacity ?? 1}
          />
          <Text
            text={getObjectDisplayLabel(object)}
            x={-radiusPx}
            y={px(-8)}
            width={radiusPx * 2}
            align="center"
            fontSize={px(13)}
            fill="#0f172a"
            listening={false}
          />
        </Group>
      );
    }
    case "line": {
      const points = object.pointsM.flatMap((p) => [
        metersToPixels(p.xM, viewport),
        metersToPixels(p.yM, viewport),
      ]);
      return (
        <Group {...commonGroupProps}>
          <Line
            points={points}
            stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#0f172a")}
            strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
            hitStrokeWidth={Math.max(12, object.style?.strokeWidth ?? 2)}
          />
        </Group>
      );
    }
    case "polygon": {
      const points = object.pointsM.flatMap((p) => [
        metersToPixels(p.xM, viewport),
        metersToPixels(p.yM, viewport),
      ]);
      return (
        <Group {...commonGroupProps}>
          <Line
            points={points}
            closed
            fill={object.style?.fill ?? "#fef9c3"}
            stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#ca8a04")}
            strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
          />
        </Group>
      );
    }
    case "text": {
      return (
        <Group {...commonGroupProps}>
          <Text
            text={object.text}
            fontSize={metersToPixels(object.fontSizeM, viewport)}
            fill={selected ? SELECTED_STROKE : (object.style?.fill ?? "#0f172a")}
          />
        </Group>
      );
    }
  }
}
