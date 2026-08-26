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
  onSelect: () => void;
  /** Snapshots undo history once, at the start of a drag gesture. */
  onBeginEdit: () => void;
  /** Called continuously while dragging, with the object's new anchor in world coordinates. */
  onMoveLive: (xM: number, yM: number) => void;
}

const SELECTED_STROKE = "#e0470f";

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
  onSelect,
  onBeginEdit,
  onMoveLive,
}: PlanObjectShapeProps) {
  const anchor = worldToScreen({ xM: object.xM, yM: object.yM }, viewport);

  const handleSelect = (e: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    e.cancelBubble = true;
    onSelect();
  };

  const handleDragStart = (e: Konva.KonvaEventObject<DragEvent>) => {
    e.cancelBubble = true;
    onSelect();
    onBeginEdit();
  };

  const handleDragMove = (e: Konva.KonvaEventObject<DragEvent>) => {
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
            strokeWidth={selected ? 3 : (object.style?.strokeWidth ?? 2)}
            opacity={object.style?.opacity ?? 1}
          />
          <Text
            text={getObjectDisplayLabel(object)}
            width={widthPx}
            height={heightPx}
            align="center"
            verticalAlign="middle"
            fontSize={14}
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
            strokeWidth={selected ? 3 : (object.style?.strokeWidth ?? 2)}
            opacity={object.style?.opacity ?? 1}
          />
          <Text
            text={getObjectDisplayLabel(object)}
            x={-radiusPx}
            y={-8}
            width={radiusPx * 2}
            align="center"
            fontSize={13}
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
            strokeWidth={selected ? 3 : (object.style?.strokeWidth ?? 2)}
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
            strokeWidth={selected ? 3 : (object.style?.strokeWidth ?? 2)}
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
