import { useCallback, useEffect, useState, type Ref } from "react";
import { Layer as KonvaLayer, Line, Rect as KonvaRect, Circle as KonvaCircle, Stage } from "react-konva";
import type Konva from "konva";
import { computeGridLines } from "../../rendering/grid";
import { metersToPixels, screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { ScreenPoint, Viewport } from "../../rendering/viewport";
import type { Layer, PlanObject, PlanObjectPatch, PointM } from "../../domain/types";
import { PlanObjectShape } from "./PlanObjectShape";
import { SelectionOverlay } from "./SelectionOverlay";
import type { StageSize } from "../hooks/useViewport";
import type { ToolId } from "../tools";

/** Describes a freshly-drawn shape in world units — App.tsx turns this into an actual `PlanObject` via the domain factories (naming, layer assignment). PlanCanvas only knows about the *gesture*, not domain construction policy. */
export type NewObjectSpec =
  | { type: "rectangle"; xM: number; yM: number; widthM: number; heightM: number }
  | { type: "circle"; xM: number; yM: number; radiusM: number }
  | { type: "line"; xM: number; yM: number; pointsM: PointM[] }
  | { type: "polygon"; xM: number; yM: number; pointsM: PointM[] }
  | { type: "text"; xM: number; yM: number };

interface PlanCanvasProps {
  containerRef: Ref<HTMLDivElement>;
  stageSize: StageSize;
  viewport: Viewport;
  onZoomAt: (point: ScreenPoint, factor: number) => void;
  onPan: (deltaXPx: number, deltaYPx: number) => void;
  objects: PlanObject[];
  layers: Layer[];
  activeTool: ToolId;
  selectedObjectId: string | null;
  onSelectObject: (id: string | null) => void;
  onCreateObject: (spec: NewObjectSpec) => void;
  onBeginObjectEdit: () => void;
  onObjectLiveUpdate: (id: string, patch: PlanObjectPatch) => void;
}

/** Multiplicative zoom step applied per wheel notch. */
const ZOOM_FACTOR_PER_TICK = 1.06;
/** Below this size (in meters), a drag-created shape is discarded as an accidental click rather than a deliberate draw. */
const MIN_CREATE_SIZE_M = 0.2;

type Draft =
  | { tool: "rectangle"; startWorld: PointM; currentWorld: PointM }
  | { tool: "circle"; centerWorld: PointM; currentWorld: PointM }
  | { tool: "line"; startWorld: PointM; currentWorld: PointM }
  | { tool: "polygon"; anchorWorld: PointM; pointsM: PointM[]; previewWorld: PointM | null };

export function PlanCanvas({
  containerRef,
  stageSize,
  viewport,
  onZoomAt,
  onPan,
  objects,
  layers,
  activeTool,
  selectedObjectId,
  onSelectObject,
  onCreateObject,
  onBeginObjectEdit,
  onObjectLiveUpdate,
}: PlanCanvasProps) {
  const [draft, setDraft] = useState<Draft | null>(null);

  const grid = computeGridLines(viewport, stageSize.widthPx || 1, stageSize.heightPx || 1);
  const layersById = new Map(layers.map((layer) => [layer.id, layer]));
  const visibleLayerIds = new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id));
  const selectedObject = objects.find((object) => object.id === selectedObjectId) ?? null;
  const selectedLayer = selectedObject ? layersById.get(selectedObject.layerId) : undefined;
  const canEditSelection = activeTool === "select" && selectedObject !== null && selectedLayer?.locked !== true;

  const getPointerWorld = useCallback(
    (stage: Konva.Stage | null): PointM | null => {
      const pointer = stage?.getPointerPosition();
      if (!pointer) return null;
      return screenToWorld(pointer, viewport);
    },
    [viewport],
  );

  // Cancel/finish an in-progress polygon draft from the keyboard: Escape
  // discards it, Enter finalizes it (if it already has enough points).
  useEffect(() => {
    if (!draft || draft.tool !== "polygon") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setDraft(null);
      } else if (event.key === "Enter" && draft.pointsM.length >= 3) {
        onCreateObject({ type: "polygon", xM: draft.anchorWorld.xM, yM: draft.anchorWorld.yM, pointsM: draft.pointsM });
        setDraft(null);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, onCreateObject]);

  const handleWheel = useCallback(
    (e: Konva.KonvaEventObject<WheelEvent>) => {
      e.evt.preventDefault();
      const pointer = e.target.getStage()?.getPointerPosition();
      if (!pointer) return;
      const factor = e.evt.deltaY < 0 ? ZOOM_FACTOR_PER_TICK : 1 / ZOOM_FACTOR_PER_TICK;
      onZoomAt(pointer, factor);
    },
    [onZoomAt],
  );

  // The Stage's own x/y is used purely as a drag handle: every dragmove we
  // fold its displacement into the viewport's offset (the single source of
  // truth for pan) and snap the node back to (0, 0), so world→screen
  // conversion is never applied twice.
  const handleStageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      const node = e.target;
      onPan(node.x(), node.y());
      node.position({ x: 0, y: 0 });
    },
    [onPan],
  );

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (activeTool === "select") {
        if (e.target === e.target.getStage()) onSelectObject(null);
        return;
      }
      if (activeTool === "rectangle" || activeTool === "circle" || activeTool === "line") {
        const world = getPointerWorld(e.target.getStage());
        if (!world) return;
        if (activeTool === "rectangle") setDraft({ tool: "rectangle", startWorld: world, currentWorld: world });
        else if (activeTool === "circle") setDraft({ tool: "circle", centerWorld: world, currentWorld: world });
        else setDraft({ tool: "line", startWorld: world, currentWorld: world });
      }
    },
    [activeTool, onSelectObject, getPointerWorld],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!draft) return;
      const world = getPointerWorld(e.target.getStage());
      if (!world) return;
      if (draft.tool === "polygon") {
        setDraft({ ...draft, previewWorld: world });
      } else {
        setDraft({ ...draft, currentWorld: world } as Draft);
      }
    },
    [draft, getPointerWorld],
  );

  const handleMouseUp = useCallback(() => {
    if (!draft) return;
    if (draft.tool === "rectangle") {
      const widthM = Math.abs(draft.currentWorld.xM - draft.startWorld.xM);
      const heightM = Math.abs(draft.currentWorld.yM - draft.startWorld.yM);
      if (widthM >= MIN_CREATE_SIZE_M && heightM >= MIN_CREATE_SIZE_M) {
        onCreateObject({
          type: "rectangle",
          xM: Math.min(draft.startWorld.xM, draft.currentWorld.xM),
          yM: Math.min(draft.startWorld.yM, draft.currentWorld.yM),
          widthM,
          heightM,
        });
      }
      setDraft(null);
    } else if (draft.tool === "circle") {
      const radiusM = Math.hypot(
        draft.currentWorld.xM - draft.centerWorld.xM,
        draft.currentWorld.yM - draft.centerWorld.yM,
      );
      if (radiusM >= MIN_CREATE_SIZE_M / 2) {
        onCreateObject({ type: "circle", xM: draft.centerWorld.xM, yM: draft.centerWorld.yM, radiusM });
      }
      setDraft(null);
    } else if (draft.tool === "line") {
      const dxM = draft.currentWorld.xM - draft.startWorld.xM;
      const dyM = draft.currentWorld.yM - draft.startWorld.yM;
      if (Math.hypot(dxM, dyM) >= MIN_CREATE_SIZE_M) {
        onCreateObject({
          type: "line",
          xM: draft.startWorld.xM,
          yM: draft.startWorld.yM,
          pointsM: [
            { xM: 0, yM: 0 },
            { xM: dxM, yM: dyM },
          ],
        });
      }
      setDraft(null);
    }
    // Polygon isn't finalized on mouseup — it's click-to-add-point, handled in handleClick.
  }, [draft, onCreateObject]);

  const handleClick = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (activeTool === "text") {
        const world = getPointerWorld(e.target.getStage());
        if (!world) return;
        onCreateObject({ type: "text", xM: world.xM, yM: world.yM });
        return;
      }
      if (activeTool === "polygon") {
        const world = getPointerWorld(e.target.getStage());
        if (!world) return;
        if (!draft || draft.tool !== "polygon") {
          setDraft({ tool: "polygon", anchorWorld: world, pointsM: [{ xM: 0, yM: 0 }], previewWorld: world });
        } else {
          setDraft({
            ...draft,
            pointsM: [...draft.pointsM, { xM: world.xM - draft.anchorWorld.xM, yM: world.yM - draft.anchorWorld.yM }],
          });
        }
      }
    },
    [activeTool, draft, getPointerWorld, onCreateObject],
  );

  return (
    <div className="plan-canvas" data-tool={activeTool} ref={containerRef}>
      {stageSize.widthPx > 0 && stageSize.heightPx > 0 && (
        <Stage
          width={stageSize.widthPx}
          height={stageSize.heightPx}
          x={0}
          y={0}
          draggable={activeTool === "select"}
          onWheel={handleWheel}
          onDragMove={handleStageDragMove}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        >
          <KonvaLayer listening={false}>
            {grid.vertical.map((line) => (
              <Line
                key={`v-${line.points[0]}`}
                points={line.points}
                stroke={line.isAxis ? "#94a3b8" : "#e2e8f0"}
                strokeWidth={line.isAxis ? 1.5 : 1}
              />
            ))}
            {grid.horizontal.map((line) => (
              <Line
                key={`h-${line.points[1]}`}
                points={line.points}
                stroke={line.isAxis ? "#94a3b8" : "#e2e8f0"}
                strokeWidth={line.isAxis ? 1.5 : 1}
              />
            ))}
          </KonvaLayer>
          <KonvaLayer>
            {objects
              .filter((object) => visibleLayerIds.has(object.layerId))
              .map((object) => {
                const layer = layersById.get(object.layerId);
                return (
                  <PlanObjectShape
                    key={object.id}
                    object={object}
                    viewport={viewport}
                    selected={object.id === selectedObjectId}
                    draggable={activeTool === "select" && layer?.locked !== true}
                    onSelect={() => onSelectObject(object.id)}
                    onBeginEdit={onBeginObjectEdit}
                    onMoveLive={(xM, yM) => onObjectLiveUpdate(object.id, { xM, yM })}
                  />
                );
              })}
            {canEditSelection && selectedObject && (
              <SelectionOverlay
                object={selectedObject}
                viewport={viewport}
                onBeginEdit={onBeginObjectEdit}
                onLiveUpdate={(patch) => onObjectLiveUpdate(selectedObject.id, patch)}
              />
            )}
          </KonvaLayer>
          <KonvaLayer listening={false}>
            <DraftPreview draft={draft} viewport={viewport} />
          </KonvaLayer>
        </Stage>
      )}
    </div>
  );
}

function DraftPreview({ draft, viewport }: { draft: Draft | null; viewport: Viewport }) {
  if (!draft) return null;

  if (draft.tool === "rectangle") {
    const topLeft = worldToScreen(
      { xM: Math.min(draft.startWorld.xM, draft.currentWorld.xM), yM: Math.min(draft.startWorld.yM, draft.currentWorld.yM) },
      viewport,
    );
    const widthPx = metersToPixels(Math.abs(draft.currentWorld.xM - draft.startWorld.xM), viewport);
    const heightPx = metersToPixels(Math.abs(draft.currentWorld.yM - draft.startWorld.yM), viewport);
    return (
      <KonvaRect
        x={topLeft.x}
        y={topLeft.y}
        width={widthPx}
        height={heightPx}
        fill="rgba(37, 99, 235, 0.15)"
        stroke="#2563eb"
        strokeWidth={1.5}
        dash={[6, 4]}
      />
    );
  }

  if (draft.tool === "circle") {
    const center = worldToScreen(draft.centerWorld, viewport);
    const radiusPx = metersToPixels(
      Math.hypot(draft.currentWorld.xM - draft.centerWorld.xM, draft.currentWorld.yM - draft.centerWorld.yM),
      viewport,
    );
    return (
      <KonvaCircle
        x={center.x}
        y={center.y}
        radius={radiusPx}
        fill="rgba(22, 163, 74, 0.15)"
        stroke="#16a34a"
        strokeWidth={1.5}
        dash={[6, 4]}
      />
    );
  }

  if (draft.tool === "line") {
    const start = worldToScreen(draft.startWorld, viewport);
    const end = worldToScreen(draft.currentWorld, viewport);
    return <Line points={[start.x, start.y, end.x, end.y]} stroke="#0f172a" strokeWidth={2} dash={[6, 4]} />;
  }

  // polygon
  const points = draft.pointsM.map((p) => worldToScreen({ xM: draft.anchorWorld.xM + p.xM, yM: draft.anchorWorld.yM + p.yM }, viewport));
  const preview = draft.previewWorld ? worldToScreen(draft.previewWorld, viewport) : null;
  const flatPoints = points.flatMap((p) => [p.x, p.y]);
  if (preview) flatPoints.push(preview.x, preview.y);
  return (
    <>
      <Line points={flatPoints} stroke="#ca8a04" strokeWidth={2} dash={[6, 4]} />
      {points.map((p, i) => (
        <KonvaCircle key={`${i}-${p.x}-${p.y}`} x={p.x} y={p.y} radius={4} fill="#ca8a04" />
      ))}
    </>
  );
}
