import { useCallback, useEffect, useMemo, useState, type Ref } from "react";
import { Layer as KonvaLayer, Line, Rect as KonvaRect, Circle as KonvaCircle, Stage, Text } from "react-konva";
import type Konva from "konva";
import { computeGridLines } from "../../rendering/grid";
import { metersToPixels, screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { ScreenPoint, Viewport } from "../../rendering/viewport";
import type { Background, Layer, PlanObject, PlanObjectPatch, PointM } from "../../domain/types";
import { boundsAreaM2, boundsFromCorners, getSelectionBoundsM, objectIdsWithinBounds } from "../../domain/selection";
import { BACKGROUND_NODE_NAME, BackgroundImageShape } from "./BackgroundImageShape";
import { PlanObjectShape } from "./PlanObjectShape";
import { MultiSelectionOutline, SelectionOverlay } from "./SelectionOverlay";
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
  background: Background;
  activeTool: ToolId;
  selectedIds: readonly string[];
  isBackgroundSelected: boolean;
  /** `additive` (Shift/Ctrl/Cmd) toggles the object in the selection instead of replacing it. */
  onSelectObject: (id: string, additive: boolean) => void;
  /** Result of a marquee: the ids it caught, to add to the selection (`additive`) or to become it. */
  onSelectMany: (ids: string[], additive: boolean) => void;
  onSelectBackground: () => void;
  onDeselectAll: () => void;
  onCreateObject: (spec: NewObjectSpec) => void;
  onBeginObjectEdit: () => void;
  /** Fired when a *shape* starts being dragged, so the editor can snapshot every selected object's position and move the whole group together. */
  onBeginObjectDrag: (id: string) => void;
  onObjectLiveUpdate: (id: string, patch: PlanObjectPatch) => void;
  /** Same as `onObjectLiveUpdate` but as its own undo step — for one-shot structural edits like adding or removing a vertex. */
  onObjectCommitUpdate: (id: string, patch: PlanObjectPatch) => void;
  /** A shape being dragged to a new anchor. Separate from `onObjectLiveUpdate` because the editor turns it into a *group* move when several objects are selected. */
  onObjectMoveLive: (id: string, xM: number, yM: number) => void;
  onBackgroundMoveLive: (xM: number, yM: number) => void;
  onBackgroundResizeLive: (widthM: number, heightM: number) => void;
  /** Fired once the second calibration point is clicked — App.tsx takes it from there (asks for the real distance, computes and commits the calibration). */
  onCalibrationMeasured: (pointA: PointM, pointB: PointM) => void;
  /** Fired on Escape while the calibrate tool is active, at any stage of the gesture. */
  onCancelCalibration: () => void;
}

/** Multiplicative zoom step applied per wheel notch. */
const ZOOM_FACTOR_PER_TICK = 1.06;
/** Below this size (in meters), a drag-created shape is discarded as an accidental click rather than a deliberate draw. */
const MIN_CREATE_SIZE_M = 0.2;

type Draft =
  | { tool: "rectangle"; startWorld: PointM; currentWorld: PointM }
  | { tool: "circle"; centerWorld: PointM; currentWorld: PointM }
  | { tool: "line"; startWorld: PointM; currentWorld: PointM }
  | { tool: "polygon"; anchorWorld: PointM; pointsM: PointM[]; previewWorld: PointM | null }
  | { tool: "calibrate"; pointsWorld: PointM[]; previewWorld: PointM | null }
  | { tool: "marquee"; startWorld: PointM; currentWorld: PointM };

export function PlanCanvas({
  containerRef,
  stageSize,
  viewport,
  onZoomAt,
  onPan,
  objects,
  layers,
  background,
  activeTool,
  selectedIds,
  isBackgroundSelected,
  onSelectObject,
  onSelectMany,
  onSelectBackground,
  onDeselectAll,
  onCreateObject,
  onBeginObjectEdit,
  onBeginObjectDrag,
  onObjectLiveUpdate,
  onObjectCommitUpdate,
  onObjectMoveLive,
  onBackgroundMoveLive,
  onBackgroundResizeLive,
  onCalibrationMeasured,
  onCancelCalibration,
}: PlanCanvasProps) {
  const [draft, setDraft] = useState<Draft | null>(null);
  /**
   * Whether Shift is currently held, tracked globally because the Stage's
   * `draggable` prop has to be right *before* the mouse goes down: Konva
   * decides a node is being dragged inside the same pointerdown dispatch,
   * and a Stage that is still draggable at that instant pans instead of
   * letting the marquee run — and then stops sending plain mousemove
   * events at all, so the rubber band would never even follow the pointer.
   */
  const [isShiftHeld, setIsShiftHeld] = useState(false);
  useEffect(() => {
    const syncShift = (event: KeyboardEvent) => setIsShiftHeld(event.shiftKey);
    // Releasing Shift outside the window (Cmd+Tab and back) never reaches
    // keyup, which would leave panning disabled with nothing to explain it.
    const clearShift = () => setIsShiftHeld(false);
    window.addEventListener("keydown", syncShift);
    window.addEventListener("keyup", syncShift);
    window.addEventListener("blur", clearShift);
    return () => {
      window.removeEventListener("keydown", syncShift);
      window.removeEventListener("keyup", syncShift);
      window.removeEventListener("blur", clearShift);
    };
  }, []);

  // Whenever the tool switches away from "calibrate" — confirmed,
  // cancelled, or another tool picked directly — drop any leftover local
  // draft so a stale marker/line can't linger on screen. Adjusted
  // synchronously during render (comparing `activeTool` to the last value
  // seen) rather than in a `useEffect`, matching this app's usual pattern
  // for "derive state from a changed prop" (see `NumberField` in
  // `PropertiesPanel.tsx`) instead of causing an extra render.
  const [lastActiveTool, setLastActiveTool] = useState(activeTool);
  if (activeTool !== lastActiveTool) {
    setLastActiveTool(activeTool);
    if (activeTool !== "calibrate" && draft?.tool === "calibrate") setDraft(null);
  }

  const grid = computeGridLines(viewport, stageSize.widthPx || 1, stageSize.heightPx || 1);
  const layersById = useMemo(() => new Map(layers.map((layer) => [layer.id, layer])), [layers]);
  // Memoised because the marquee's mouse-up handler closes over it: a set
  // rebuilt every render would make that callback a new function every
  // render too.
  const visibleLayerIds = useMemo(
    () => new Set(layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [layers],
  );
  const selectedIdSet = new Set(selectedIds);
  const selectedObjects = objects.filter((object) => selectedIdSet.has(object.id));
  // Handles are only shown for a selection of exactly one: see
  // `MultiSelectionOutline` for why a group gets an outline instead.
  const selectedObject = selectedObjects.length === 1 ? (selectedObjects[0] ?? null) : null;
  const selectedLayer = selectedObject ? layersById.get(selectedObject.layerId) : undefined;
  const canEditSelection = activeTool === "select" && selectedObject !== null && selectedLayer?.locked !== true;
  const multiSelectionBounds = selectedObjects.length > 1 ? getSelectionBoundsM(selectedObjects) : null;

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

  // Escape cancels calibration at any stage — before either point is
  // picked, between the two clicks, or while App.tsx's "real distance"
  // dialog is open (the tool stays "calibrate" throughout that dialog, so
  // this listener covers it too). Keyed on `activeTool` rather than
  // `draft` so it's live even before the first point creates a draft.
  useEffect(() => {
    if (activeTool !== "calibrate") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancelCalibration();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeTool, onCancelCalibration]);

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
  //
  // Konva's drag events bubble like any other Konva event, so dragging a
  // *child* node (an object, the background) also fires this handler —
  // with `e.target` set to that child, not the Stage. Without the guard
  // below, `node.x()/y()` would read the child's own position (which has
  // nothing to do with panning) and `node.position({x:0,y:0})` would
  // fight the child's own drag by resetting it every frame. Only treat
  // this as a pan when the Stage itself is what's actually being dragged.
  const handleStageDragMove = useCallback(
    (e: Konva.KonvaEventObject<DragEvent>) => {
      if (e.target !== e.target.getStage()) return;
      const node = e.target;
      // A marquee and a pan are the same gesture with a different modifier,
      // and Konva has already decided it is a drag by the time the marquee
      // draft exists — the `draggable` prop goes false a render too late.
      // Refusing to pan here is what actually stops the view sliding out
      // from under the rubber band.
      if (draft?.tool === "marquee") {
        node.position({ x: 0, y: 0 });
        return;
      }
      onPan(node.x(), node.y());
      node.position({ x: 0, y: 0 });
    },
    [draft, onPan],
  );

  const handleMouseDown = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (activeTool === "select") {
        const stage = e.target.getStage();
        // "Empty canvas" means the bare Stage *or* the background image:
        // once a plan is imported it covers everything, and a marquee that
        // only worked on the few bare pixels around it would be useless
        // exactly when it's needed.
        const isEmptySpace = e.target === stage || e.target.name() === BACKGROUND_NODE_NAME;
        // Shift on empty canvas starts a marquee; a plain drag keeps
        // panning (or moving the background), which is what this app is
        // used for minute to minute. Overloading the plain drag onto
        // selection would have been the more fashionable choice and a
        // daily regression for the user.
        if (e.evt.shiftKey && isEmptySpace) {
          const world = getPointerWorld(stage);
          if (!world) return;
          setDraft({ tool: "marquee", startWorld: world, currentWorld: world });
          return;
        }
        if (e.target !== stage) return;
        onDeselectAll();
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
    [activeTool, onDeselectAll, getPointerWorld],
  );

  const handleMouseMove = useCallback(
    (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!draft) return;
      const world = getPointerWorld(e.target.getStage());
      if (!world) return;
      if (draft.tool === "polygon") {
        setDraft({ ...draft, previewWorld: world });
      } else if (draft.tool === "marquee") {
        setDraft({ ...draft, currentWorld: world });
      } else if (draft.tool === "calibrate") {
        // Once both points are picked, the segment is frozen — stop
        // following the pointer while App.tsx's distance dialog is open.
        if (draft.pointsWorld.length < 2) setDraft({ ...draft, previewWorld: world });
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
    } else if (draft.tool === "marquee") {
      const marquee = boundsFromCorners(draft.startWorld, draft.currentWorld);
      // A zero-area marquee is a Shift-click on empty canvas, not a
      // gesture — selecting nothing (and wiping the selection) would be a
      // surprising thing to do with a modifier held down.
      if (boundsAreaM2(marquee) > 0) {
        onSelectMany(
          objectIdsWithinBounds(objects, marquee, {
            isEligible: (object) => visibleLayerIds.has(object.layerId),
          }),
          true,
        );
      }
      setDraft(null);
    }
    // Polygon isn't finalized on mouseup — it's click-to-add-point, handled in handleClick.
  }, [draft, objects, visibleLayerIds, onCreateObject, onSelectMany]);

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
      if (activeTool === "calibrate") {
        const world = getPointerWorld(e.target.getStage());
        if (!world) return;
        if (!draft || draft.tool !== "calibrate") {
          setDraft({ tool: "calibrate", pointsWorld: [world], previewWorld: world });
          return;
        }
        if (draft.pointsWorld.length >= 2) return; // segment already picked — waiting on the dialog
        const pointA = draft.pointsWorld[0];
        if (!pointA) return;
        const distanceM = Math.hypot(world.xM - pointA.xM, world.yM - pointA.yM);
        if (distanceM < MIN_CREATE_SIZE_M) return; // treat as an accidental near-duplicate click
        setDraft({ tool: "calibrate", pointsWorld: [pointA, world], previewWorld: null });
        onCalibrationMeasured(pointA, world);
      }
    },
    [activeTool, draft, getPointerWorld, onCreateObject, onCalibrationMeasured],
  );

  return (
    <div className="plan-canvas" data-tool={activeTool} ref={containerRef}>
      {stageSize.widthPx > 0 && stageSize.heightPx > 0 && (
        <Stage
          width={stageSize.widthPx}
          height={stageSize.heightPx}
          x={0}
          y={0}
          draggable={activeTool === "select" && !isShiftHeld && draft?.tool !== "marquee"}
          onWheel={handleWheel}
          onDragMove={handleStageDragMove}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onClick={handleClick}
        >
          <KonvaLayer>
            {background?.visible && (
              <BackgroundImageShape
                background={background}
                viewport={viewport}
                selected={isBackgroundSelected}
                draggable={activeTool === "select" && !background.locked}
                selectable={activeTool === "select"}
                onSelect={onSelectBackground}
                onBeginEdit={onBeginObjectEdit}
                onMoveLive={onBackgroundMoveLive}
                onResizeLive={onBackgroundResizeLive}
              />
            )}
          </KonvaLayer>
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
                    selected={selectedIdSet.has(object.id)}
                    draggable={activeTool === "select" && layer?.locked !== true}
                    selectable={activeTool === "select"}
                    onSelect={(additive) => onSelectObject(object.id, additive)}
                    onBeginEdit={() => onBeginObjectDrag(object.id)}
                    onMoveLive={(xM, yM) => onObjectMoveLive(object.id, xM, yM)}
                  />
                );
              })}
            {canEditSelection && selectedObject && (
              <SelectionOverlay
                object={selectedObject}
                viewport={viewport}
                onBeginEdit={onBeginObjectEdit}
                onLiveUpdate={(patch) => onObjectLiveUpdate(selectedObject.id, patch)}
                onCommit={(patch) => onObjectCommitUpdate(selectedObject.id, patch)}
              />
            )}
            {multiSelectionBounds && <MultiSelectionOutline bounds={multiSelectionBounds} viewport={viewport} />}
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

  if (draft.tool === "marquee") {
    const topLeft = worldToScreen(
      {
        xM: Math.min(draft.startWorld.xM, draft.currentWorld.xM),
        yM: Math.min(draft.startWorld.yM, draft.currentWorld.yM),
      },
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
        fill="rgba(224, 71, 15, 0.10)"
        stroke="#e0470f"
        strokeWidth={1}
        dash={[4, 3]}
      />
    );
  }

  if (draft.tool === "calibrate") {
    const pointsScreen = draft.pointsWorld.map((p) => worldToScreen(p, viewport));
    const previewScreen = draft.previewWorld ? worldToScreen(draft.previewWorld, viewport) : null;
    const endWorld = draft.pointsWorld[1] ?? draft.previewWorld;
    const endScreen = pointsScreen[1] ?? previewScreen;
    const distanceM = draft.pointsWorld[0] && endWorld ? Math.hypot(endWorld.xM - draft.pointsWorld[0].xM, endWorld.yM - draft.pointsWorld[0].yM) : null;
    return (
      <>
        {pointsScreen[0] && endScreen && (
          <Line points={[pointsScreen[0].x, pointsScreen[0].y, endScreen.x, endScreen.y]} stroke="#9333ea" strokeWidth={2} dash={[6, 4]} />
        )}
        {pointsScreen.map((p, i) => (
          <KonvaCircle key={`${i}-${p.x}-${p.y}`} x={p.x} y={p.y} radius={5} fill="#9333ea" />
        ))}
        {pointsScreen[0] && endScreen && distanceM !== null && (
          <Text
            x={(pointsScreen[0].x + endScreen.x) / 2 + 8}
            y={(pointsScreen[0].y + endScreen.y) / 2 - 18}
            text={`${distanceM.toFixed(2)} m`}
            fontSize={13}
            fill="#9333ea"
          />
        )}
      </>
    );
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
