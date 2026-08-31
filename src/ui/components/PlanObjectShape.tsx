import { Arrow, Circle, Group, Image as KonvaImage, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import { getObjectDisplayLabel } from "../../domain/labels";
import { labelledStandCells, standGridToDraw } from "../../domain/stands";
import {
  DEFAULT_LABEL_DISPLAY,
  resolveLabelDisplay,
  type LabelDisplay,
} from "../../domain/display";
import type { PlanObject, RectangleObject, StandGrid } from "../../domain/types";
import { metersToPixels, screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { Viewport } from "../../rendering/viewport";
import { useHtmlImage } from "../hooks/useHtmlImage";

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
  /** The project's default label settings; the object's own `display` override wins over it. */
  labelDisplay?: LabelDisplay;
  /** `additive` is true when Shift (or Ctrl/Cmd) was held — the caller then toggles this object in the selection instead of replacing it. */
  onSelect: (additive: boolean) => void;
  /** Snapshots undo history once, at the start of a drag gesture. */
  onBeginEdit: () => void;
  /** Called continuously while dragging, with the object's new anchor in world coordinates. */
  onMoveLive: (xM: number, yM: number) => void;
  simplified?: boolean;
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
  labelDisplay = DEFAULT_LABEL_DISPLAY,
  onSelect,
  onBeginEdit,
  onMoveLive,
  simplified = false,
}: PlanObjectShapeProps) {
  const objectImage = useHtmlImage(object.type === "image" ? object.url : null);
  // Composed once per render: what this object writes on the plan, and
  // whether it writes anything at all (see `domain/display.ts`).
  const display = resolveLabelDisplay(object, labelDisplay);
  const labelText = getObjectDisplayLabel(object, display);
  const showLabel = !simplified && labelText.length > 0;
  // The stands written inside a marquee (KL-038). Text only — there is no
  // shape to draw, which is the whole point of the feature.
  const standGrid = simplified ? null : standGridToDraw(object, display);
  const anchor = worldToScreen({ xM: object.xM, yM: object.yM }, viewport);
  /** A width given in screen pixels, converted to this render target's pixels. */
  const px = (screenPx: number) => screenPx * renderScale;
  const dash =
    object.style?.dash === "dashed"
      ? [px(10), px(6)]
      : object.style?.dash === "dotted"
        ? [px(2), px(5)]
        : undefined;

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
            dash={dash}
          />
          {standGrid && (
            <StandLabels object={object} grid={standGrid} viewport={viewport} px={px} />
          )}
          {showLabel && (
            <Text
              text={labelText}
              width={widthPx}
              /* A marquee full of stand names has no room left in the
                 middle for its own, so it moves above its top edge —
                 where it reads as the title of what is under it. */
              y={standGrid ? -px(6) - px(14) * labelText.split("\n").length : 0}
              height={standGrid ? undefined : heightPx}
              align="center"
              verticalAlign={standGrid ? undefined : "middle"}
              fontSize={px(14)}
              fill="#0f172a"
              listening={false}
            />
          )}
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
            dash={dash}
          />
          {showLabel && (
            <Text
              text={labelText}
              x={-radiusPx}
              y={px(-8)}
              width={radiusPx * 2}
              align="center"
              fontSize={px(13)}
              fill="#0f172a"
              listening={false}
            />
          )}
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
          {object.style?.arrowStart || object.style?.arrowEnd ? (
            <Arrow
              points={points}
              stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#0f172a")}
              strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
              hitStrokeWidth={Math.max(12, object.style?.strokeWidth ?? 2)}
              opacity={object.style?.opacity ?? 1}
              dash={dash}
              pointerAtBeginning={object.style?.arrowStart}
              pointerAtEnding={object.style?.arrowEnd}
              pointerLength={px(10)}
              pointerWidth={px(9)}
              fill={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#0f172a")}
            />
          ) : (
            <Line
              points={points}
              stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#0f172a")}
              strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
              hitStrokeWidth={Math.max(12, object.style?.strokeWidth ?? 2)}
              opacity={object.style?.opacity ?? 1}
              dash={dash}
            />
          )}
          {showLabel && (
            <Text
              text={labelText}
              x={points.length >= 2 ? points[0] : 0}
              y={-px(18)}
              fontSize={px(12)}
              fill={object.style?.fill ?? "#0f172a"}
              opacity={object.style?.opacity ?? 1}
              listening={false}
            />
          )}
        </Group>
      );
    }
    case "polygon": {
      const points = object.pointsM.flatMap((p) => [
        metersToPixels(p.xM, viewport),
        metersToPixels(p.yM, viewport),
      ]);
      const xValues = object.pointsM.map((point) => metersToPixels(point.xM, viewport));
      const yValues = object.pointsM.map((point) => metersToPixels(point.yM, viewport));
      const minX = Math.min(...xValues, 0);
      const maxX = Math.max(...xValues, 0);
      const minY = Math.min(...yValues, 0);
      return (
        <Group {...commonGroupProps}>
          <Line
            points={points}
            closed
            fill={object.style?.fill ?? "#fef9c3"}
            stroke={selected ? SELECTED_STROKE : (object.style?.stroke ?? "#ca8a04")}
            strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 2))}
            opacity={object.style?.opacity ?? 1}
            dash={dash}
          />
          {showLabel && (
            <Text
              text={labelText}
              x={minX}
              y={minY + px(6)}
              width={Math.max(maxX - minX, px(80))}
              align="center"
              fontSize={px(12)}
              fill="#0f172a"
              opacity={object.style?.opacity ?? 1}
              listening={false}
            />
          )}
        </Group>
      );
    }
    case "text": {
      return (
        <Group {...commonGroupProps}>
          <Text
            text={object.text}
            fontSize={metersToPixels(object.fontSizeM, viewport)}
            fontFamily={object.style?.fontFamily ?? "Arial"}
            fontStyle={
              [
                object.style?.fontWeight === "bold" ? "bold" : "",
                object.style?.fontStyle === "italic" ? "italic" : "",
              ]
                .filter(Boolean)
                .join(" ") || "normal"
            }
            align={object.style?.textAlign ?? "left"}
            fill={selected ? SELECTED_STROKE : (object.style?.fill ?? "#0f172a")}
            opacity={object.style?.opacity ?? 1}
          />
        </Group>
      );
    }
    case "image": {
      if (!objectImage) return null;
      return (
        <Group {...commonGroupProps}>
          <KonvaImage
            image={objectImage}
            width={metersToPixels(object.widthM, viewport)}
            height={metersToPixels(object.heightM, viewport)}
            opacity={object.style?.opacity ?? 1}
            stroke={selected ? SELECTED_STROKE : object.style?.stroke}
            strokeWidth={px(selected ? 3 : (object.style?.strokeWidth ?? 0))}
          />
        </Group>
      );
    }
  }
}

/** Smallest cell, in screen pixels, still worth writing a stand name in. Below it the grid is a smudge, not a plan. */
const MIN_READABLE_CELL_PX = 26;

/**
 * The stand names inside a marquee.
 *
 * Drawn at a fixed *screen* size like every other label, so zooming out
 * does not shrink the text into a line of dots — and hidden entirely once
 * a cell is too small to hold it, which is the same thing said the other
 * way round. Each name is centred in its own cell, so it lands where the
 * stand will be rather than in a list.
 */
function StandLabels({
  object,
  grid,
  viewport,
  px,
}: {
  object: RectangleObject;
  grid: StandGrid;
  viewport: Viewport;
  px: (screenPx: number) => number;
}) {
  const cells = labelledStandCells(object, grid);
  if (cells.length === 0) return null;

  const firstCell = cells[0];
  if (!firstCell) return null;
  const cellWidthPx = metersToPixels(firstCell.widthM, viewport);
  const cellHeightPx = metersToPixels(firstCell.heightM, viewport);
  if (cellWidthPx < MIN_READABLE_CELL_PX || cellHeightPx < MIN_READABLE_CELL_PX / 2) return null;

  return (
    <>
      {cells.map((cell) => (
        <Text
          key={`${cell.rowIndex}-${cell.columnIndex}`}
          text={cell.text}
          x={metersToPixels(cell.xM, viewport)}
          y={metersToPixels(cell.yM, viewport)}
          width={cellWidthPx}
          height={cellHeightPx}
          align="center"
          verticalAlign="middle"
          fontSize={px(12)}
          fill="#0f172a"
          listening={false}
        />
      ))}
    </>
  );
}
