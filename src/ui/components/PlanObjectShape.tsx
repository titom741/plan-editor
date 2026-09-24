import { Arrow, Circle, Group, Image as KonvaImage, Line, Rect, Text } from "react-konva";
import type Konva from "konva";
import { getObjectDisplayLabel } from "../../domain/labels";
import { labelledStandCells, standGridToDraw } from "../../domain/stands";
import {
  DEFAULT_LABEL_DISPLAY,
  resolveLabelDisplay,
  resolveLabelFontSizePx,
  type LabelDisplay,
} from "../../domain/display";
import { polylineMidpointM } from "../../domain/measure";
import { deviceCaptionAnchorLocal, isDevice } from "../../domain/electrical";
import { LABEL_LINE_HEIGHT, fitLabelsToBox } from "../../rendering/labelFit";
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
  /**
   * The smallest a text may be drawn, in *this target's* pixels, with
   * anything below it raised to this size even where it then overflows
   * what it names (KL-043).
   *
   * 0 on screen — a plan zoomed out wants empty cells, not a grey wash,
   * and the reader can always zoom. It is a print concern: paper has no
   * zoom, so a caption that comes out below the readable floor is simply
   * lost, and `PrintCanvas` passes the floor here when the export
   * dialogue's "agrandir les textes" is on.
   */
  minTextPx?: number;
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

/** Width of the invisible box a line's caption is centred in, in screen pixels. Only its centre matters; the text is free to overflow it. */
const LINE_LABEL_BOX_PX = 400;

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
  minTextPx = 0,
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
  /** The size this object's caption is drawn at, in this target's pixels — its own setting, or its type's default, never below the target's floor. */
  const labelFontSizePx = Math.max(minTextPx, px(resolveLabelFontSizePx(object)));
  /** How many lines the caption occupies, which is what places it relative to the shape. */
  const labelLineCount = labelText.split("\n").length;

  // An electrical device writes its caption under itself rather than
  // inside (KL-045): it is a few decimetres wide, and its name and rating
  // squeezed into that would be cut to a couple of letters. Same anchor
  // as the PDF's, so the two halves agree.
  const captionAnchor = isDevice(object) ? deviceCaptionAnchorLocal(object) : null;
  const hangingCaption = captionAnchor ? (
    <Text
      text={labelText}
      x={metersToPixels(captionAnchor.xM, viewport) - px(LINE_LABEL_BOX_PX) / 2}
      y={metersToPixels(captionAnchor.yM, viewport) + px(4)}
      width={px(LINE_LABEL_BOX_PX)}
      align="center"
      wrap="none"
      fontSize={labelFontSizePx}
      lineHeight={LABEL_LINE_HEIGHT}
      fill="#0f172a"
      listening={false}
    />
  ) : null;

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
            <StandLabels
              object={object}
              grid={standGrid}
              viewport={viewport}
              px={px}
              minTextPx={minTextPx}
              ownFontSizePx={object.style?.labelFontSize}
            />
          )}
          {showLabel && hangingCaption}
          {showLabel && !hangingCaption && (
            <Text
              text={labelText}
              width={widthPx}
              /* A marquee full of stand names has no room left in the
                 middle for its own, so it moves above its top edge —
                 where it reads as the title of what is under it. */
              y={standGrid ? -px(6) - labelFontSizePx * LABEL_LINE_HEIGHT * labelLineCount : 0}
              height={standGrid ? undefined : heightPx}
              align="center"
              verticalAlign={standGrid ? undefined : "middle"}
              fontSize={labelFontSizePx}
              lineHeight={LABEL_LINE_HEIGHT}
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
          {showLabel && hangingCaption}
          {showLabel && !hangingCaption && (
            <Text
              text={labelText}
              x={-radiusPx}
              /* Centred on the circle's own centre by measuring the text
                 block rather than by a fixed nudge, which only held at
                 one font size and one line. */
              y={-(labelFontSizePx * LABEL_LINE_HEIGHT * labelLineCount) / 2}
              width={radiusPx * 2}
              align="center"
              fontSize={labelFontSizePx}
              lineHeight={LABEL_LINE_HEIGHT}
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
      // The caption — a length, most often — belongs half-way along the
      // line it describes, not at the end the drawing happened to start
      // from. On a polyline that is half its *length*, so the text lands
      // on the stroke even when the run bends (`polylineMidpointM`).
      const midpointM = polylineMidpointM(object.pointsM);
      const midpoint = midpointM
        ? { x: metersToPixels(midpointM.xM, viewport), y: metersToPixels(midpointM.yM, viewport) }
        : { x: 0, y: 0 };
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
              /* Centred on the midpoint through a box wide enough for the
                 text to overflow symmetrically — Konva has no "centre on
                 this point" for text, but an over-wide box with
                 `align="center"` and no wrapping is exactly that. */
              x={midpoint.x - LINE_LABEL_BOX_PX / 2}
              width={LINE_LABEL_BOX_PX}
              align="center"
              wrap="none"
              y={midpoint.y - px(6) - labelFontSizePx * LABEL_LINE_HEIGHT * labelLineCount}
              fontSize={labelFontSizePx}
              lineHeight={LABEL_LINE_HEIGHT}
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
              fontSize={labelFontSizePx}
              lineHeight={LABEL_LINE_HEIGHT}
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
            /* Measured in metres of ground, so it is the one caption
               that shrinks with the scale rather than staying an
               annotation: on paper it is the first to disappear. */
            fontSize={Math.max(minTextPx, metersToPixels(object.fontSizeM, viewport))}
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
    case "symbol": {
      // Measured in metres of ground like a `text` object, so it keeps its
      // real size as the plan is zoomed; centred on its anchor, unlike
      // one, because a symbol marks the point it is placed on.
      const sizePx = Math.max(minTextPx, metersToPixels(object.sizeM, viewport));
      return (
        <Group {...commonGroupProps}>
          <Text
            text={object.character}
            /* Konva has no "centre on this point" for text: a box of
               known size placed half of it up and to the left is one. */
            x={-sizePx}
            y={-sizePx * 0.6}
            width={sizePx * 2}
            height={sizePx * 1.2}
            align="center"
            verticalAlign="middle"
            wrap="none"
            fontSize={sizePx}
            fill={selected ? SELECTED_STROKE : (object.style?.fill ?? "#0f172a")}
            opacity={object.style?.opacity ?? 1}
            listening={false}
          />
          {/* A hit area of its own: the glyph itself is mostly holes, and
              a symbol you can only grab by its ink is a symbol you cannot
              grab. */}
          <Rect x={-sizePx / 2} y={-sizePx / 2} width={sizePx} height={sizePx} fill="transparent" />
          {showLabel && (
            <Text
              text={labelText}
              x={-sizePx}
              /* Clear of the glyph's lower edge, so the name reads as a
                 caption under the mark rather than across it. */
              y={sizePx / 2 + px(4)}
              width={sizePx * 2}
              align="center"
              fontSize={labelFontSizePx}
              lineHeight={LABEL_LINE_HEIGHT}
              fill="#0f172a"
              opacity={object.style?.opacity ?? 1}
              listening={false}
            />
          )}
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

/** Below this, in this target's pixels, a stand name is a smudge rather than a name — the cell is left empty instead. */
const MIN_STAND_FONT_SIZE_PX = 7;

/** How big a stand name may grow when the cell has room to spare, unless the marquee carries a size of its own. */
const MAX_STAND_FONT_SIZE_PX = 20;

/** Breathing room kept between a name and its cell's edges, in screen pixels — a name touching the aisle reads as belonging to both. */
const STAND_LABEL_PADDING_PX = 4;

/**
 * The stand names inside a marquee.
 *
 * Sized to the cell rather than fixed (KL-040). A fixed size cannot be
 * right for both a tent split in two and the same tent split in six: it
 * is either unreadable in the narrow case or timid in the wide one. So
 * the size is derived from the cell, and a name is allowed to break in
 * two — which is usually what *buys* the bigger size, because a cell that
 * is narrow is rarely short.
 *
 * One size for the whole grid, set by the longest name: identical cells
 * printing their names at different sizes would read as a mistake. And
 * when even the smallest allowed size will not fit — zoomed out, or a
 * grid too fine for the tent — nothing is drawn at all, which is what
 * makes a plan at low zoom a plan rather than a grey wash.
 */
function StandLabels({
  object,
  grid,
  viewport,
  px,
  minTextPx,
  ownFontSizePx,
}: {
  object: RectangleObject;
  grid: StandGrid;
  viewport: Viewport;
  px: (screenPx: number) => number;
  /** The floor this target holds every text to, in its own pixels; 0 leaves an unfittable cell empty. */
  minTextPx: number;
  /** The marquee's own label size in screen pixels, when it carries one: it then caps its stands too, up or down. Undefined leaves them the default ceiling. */
  ownFontSizePx: number | undefined;
}) {
  const cells = labelledStandCells(object, grid);
  const firstCell = cells[0];
  if (!firstCell) return null;

  const cellWidthPx = metersToPixels(firstCell.widthM, viewport);
  const cellHeightPx = metersToPixels(firstCell.heightM, viewport);
  const fitted = fitLabelsToBox(
    cells.map((cell) => cell.text),
    {
      widthPx: cellWidthPx - px(STAND_LABEL_PADDING_PX) * 2,
      heightPx: cellHeightPx - px(STAND_LABEL_PADDING_PX) * 2,
    },
    {
      maxFontSizePx: px(ownFontSizePx ?? MAX_STAND_FONT_SIZE_PX),
      // A target holding a floor replaces the screen's rule rather than
      // adding to it, so the raster and the PDF pick the same size for
      // the same cell — the two halves of one export must not disagree.
      // On screen (no floor) an unfittable cell stays empty, as always.
      minFontSizePx: minTextPx > 0 ? minTextPx : px(MIN_STAND_FONT_SIZE_PX),
      enlargeToMin: minTextPx > 0,
    },
  );
  if (!fitted) return null;

  return (
    <>
      {cells.map((cell, index) => (
        <Text
          key={`${cell.rowIndex}-${cell.columnIndex}`}
          /* The lines were chosen here, at the size that made them fit, so
             Konva is told not to have opinions of its own about wrapping. */
          text={(fitted.lines[index] ?? [cell.text]).join("\n")}
          wrap="none"
          x={metersToPixels(cell.xM, viewport)}
          y={metersToPixels(cell.yM, viewport)}
          width={cellWidthPx}
          height={cellHeightPx}
          align="center"
          verticalAlign="middle"
          fontSize={fitted.fontSizePx}
          lineHeight={LABEL_LINE_HEIGHT}
          fill="#0f172a"
          listening={false}
        />
      ))}
    </>
  );
}
