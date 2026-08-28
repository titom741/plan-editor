import { useCallback, useEffect, useMemo, useRef, useState, type Ref } from "react";
import { Group, Layer as KonvaLayer, Line, Rect as KonvaRect, Circle as KonvaCircle, Stage, Text } from "react-konva";
import type Konva from "konva";
import { computeGridLines } from "../../rendering/grid";
import { getEffectivePixelsPerMeter, metersToPixels, screenToWorld, worldToScreen } from "../../rendering/viewport";
import type { ScreenPoint, Viewport } from "../../rendering/viewport";
import type { BackgroundImage, Layer, PlanObject, PlanObjectPatch, PointM } from "../../domain/types";
import { boundsAreaM2, boundsFromCorners, getSelectionBoundsM, objectIdsWithinBounds } from "../../domain/selection";
import { formatAngleDeg, formatAreaM2, formatLengthM, polygonAreaM2, polylineLengthM, segmentLengthsM } from "../../domain/measure";
import { collectSnapTargets, snapPointM } from "../../domain/snapping";
import type { SnapTarget } from "../../domain/snapping";
import { MIN_LINE_POINTS, constrainPointAngleM, objectLocalToWorld, tangentPointsToCircleM, worldToObjectLocal } from "../../domain/geometry";
import { BACKGROUND_NODE_NAME, BackgroundImageShape } from "./BackgroundImageShape";
import { SpatialPointIndex } from "../../domain/spatialIndex";
import { simplifyPolylineM } from "../../domain/polyline";
import { getObjectBoundsM } from "../../domain/bounds";
import { PlanObjectShape } from "./PlanObjectShape";
import type { LabelDisplay } from "../../domain/display";
import { MultiSelectionOutline, SelectionOverlay } from "./SelectionOverlay";
import type { StageSize } from "../hooks/useViewport";
import type { ToolId } from "../tools";

/** Describes a freshly-drawn shape in world units — App.tsx turns this into an actual `PlanObject` via the domain factories (naming, layer assignment). PlanCanvas only knows about the *gesture*, not domain construction policy. */
export type NewObjectSpec =
  | { type: "rectangle"; xM: number; yM: number; widthM: number; heightM: number }
  | { type: "circle"; xM: number; yM: number; radiusM: number }
  | { type: "line"; xM: number; yM: number; pointsM: PointM[]; measurement?: { kind: "length" | "angle"; showSegments?: boolean } }
  | { type: "polygon"; xM: number; yM: number; pointsM: PointM[]; measurement?: { kind: "area"; showSegments?: boolean } }
  | { type: "text"; xM: number; yM: number };

interface PlanCanvasProps {
  containerRef: Ref<HTMLDivElement>;
  stageSize: StageSize;
  viewport: Viewport;
  onZoomAt: (point: ScreenPoint, factor: number) => void;
  onPan: (deltaXPx: number, deltaYPx: number) => void;
  objects: PlanObject[];
  layers: Layer[];
  /** The backdrop stack, bottom first — drawn in order, so the last one covers. */
  backgrounds: readonly BackgroundImage[];
  activeTool: ToolId;
  /** Whether the pointer is pulled onto grid intersections and object corners (KL-007). Hold Alt to bypass it for one gesture. */
  snapEnabled: boolean;
  /** Project-wide default for what object labels show. */
  labelDisplay: LabelDisplay;
  gridVisible: boolean;
  gridLimited: boolean;
  selectedIds: readonly string[];
  selectedBackgroundId: string | null;
  /** `additive` (Shift/Ctrl/Cmd) toggles the object in the selection instead of replacing it. */
  onSelectObject: (id: string, additive: boolean) => void;
  /** Result of a marquee: the ids it caught, to add to the selection (`additive`) or to become it. */
  onSelectMany: (ids: string[], additive: boolean) => void;
  onSelectBackground: (backgroundId: string) => void;
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
/** How close, in screen pixels, the pointer must come before it is pulled onto a snap target. Converted to meters per gesture, so it feels identical at every zoom. */
/**
 * How far the pointer must travel with the button down before a polyline
 * press is read as a freehand stroke rather than a click. Below this, a
 * click that wobbles by a pixel would start drawing by hand.
 */
const FREEHAND_THRESHOLD_PX = 4;
/** Minimum spacing between recorded freehand points, in screen pixels — one point per pixel would be noise. */
const FREEHAND_SPACING_PX = 3;
/** Douglas–Peucker tolerance applied when a freehand stroke is committed, in screen pixels. */
const FREEHAND_SIMPLIFY_PX = 2;

const SNAP_TOLERANCE_PX = 10;
const MEASURE_COLOR = "#0f766e";

type Draft =
  | { tool: "rectangle"; startWorld: PointM; currentWorld: PointM }
  | { tool: "circle"; centerWorld: PointM; currentWorld: PointM }
  | { tool: "line"; startWorld: PointM; currentWorld: PointM }
  | { tool: "polygon"; anchorWorld: PointM; pointsM: PointM[]; previewWorld: PointM | null }
  /**
   * The polyline tool, which is two gestures in one shape: a click adds a
   * straight-segment point, and pressing and dragging draws freehand.
   * `pressing` distinguishes them — it becomes `"freehand"` the moment the
   * pointer moves far enough while the button is down, and a `"click"`
   * that never moved is committed as a single point on release.
   */
  | {
      tool: "polyline";
      anchorWorld: PointM;
      pointsM: PointM[];
      previewWorld: PointM | null;
      pressing: "click" | "freehand" | null;
      pressStartWorld: PointM | null;
    }
  | { tool: "calibrate"; pointsWorld: PointM[]; previewWorld: PointM | null }
  | { tool: "marquee"; startWorld: PointM; currentWorld: PointM }
  | { tool: "measure"; pointsWorld: PointM[]; previewWorld: PointM | null };

export function PlanCanvas({
  containerRef,
  stageSize,
  viewport,
  onZoomAt,
  onPan,
  objects,
  layers,
  backgrounds,
  activeTool,
  snapEnabled,
  labelDisplay,
  gridVisible,
  gridLimited,
  selectedIds,
  selectedBackgroundId,
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
  /**
   * Alt bypasses snapping for as long as it is held. Kept in a ref, not
   * state: it is read inside pointer handlers and must never cause a
   * re-render of its own.
   */
  const isAltHeldRef = useRef(false);
  const pinchDistanceRef = useRef<number | null>(null);
  /** Where the pointer was last pulled to, for the on-canvas marker. `null` when nothing snapped. */
  const [snapMarker, setSnapMarker] = useState<SnapTarget | null>(null);
  useEffect(() => {
    const syncShift = (event: KeyboardEvent) => {
      isAltHeldRef.current = event.altKey;
      setIsShiftHeld(event.shiftKey);
    };
    // Releasing Shift outside the window (Cmd+Tab and back) never reaches
    // keyup, which would leave panning disabled with nothing to explain it.
    const clearShift = () => {
      isAltHeldRef.current = false;
      setIsShiftHeld(false);
    };
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
    if (activeTool !== "measure" && draft?.tool === "measure") setDraft(null);
  }

  const grid = computeGridLines(viewport, stageSize.widthPx || 1, stageSize.heightPx || 1);
  // The grid and its snapping are bounded by the *bottom* visible
  // backdrop — the surveyed plan the site is set out against, not
  // whatever image happens to be laid over it.
  const boundingBackground = backgrounds.find((candidate) => candidate.visible) ?? null;
  const gridClipPoints = gridLimited && boundingBackground?.visible
    ? [
        { xM: 0, yM: 0 },
        { xM: boundingBackground.widthM, yM: 0 },
        { xM: boundingBackground.widthM, yM: boundingBackground.heightM },
        { xM: 0, yM: boundingBackground.heightM },
      ].map((point) => worldToScreen(objectLocalToWorld(boundingBackground, point), viewport))
    : null;
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

  // Snap targets are the corners, midpoints and centres of everything on a
  // visible layer. Rebuilt only when the objects or layer visibility
  // change — not per pointer move.
  const snapTargets = useMemo(
    () =>
      snapEnabled
        ? collectSnapTargets(objects, { isEligible: (object) => visibleLayerIds.has(object.layerId) })
        : [],
    [snapEnabled, objects, visibleLayerIds],
  );
  const snapIndex = useMemo(() => new SpatialPointIndex(snapTargets, 10), [snapTargets]);
  const visibleWorldTopLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const visibleWorldBottomRight = screenToWorld({ x: stageSize.widthPx, y: stageSize.heightPx }, viewport);
  const renderObjects = objects.filter((object) => {
    if (!visibleLayerIds.has(object.layerId)) return false;
    const bounds = getObjectBoundsM(object);
    if (!bounds) return true;
    return bounds.maxXM >= visibleWorldTopLeft.xM && bounds.minXM <= visibleWorldBottomRight.xM && bounds.maxYM >= visibleWorldTopLeft.yM && bounds.minYM <= visibleWorldBottomRight.yM;
  });
  const simplifiedRendering = objects.length > 2000;

  /**
   * Pulls a world point onto a snap target. The tolerance is a fixed
   * distance *on screen* converted to metres through the current viewport,
   * so snapping feels the same at every zoom instead of grabbing half a
   * field when zoomed out.
   */
  const snapWorld = useCallback(
    (pointM: PointM, excludeIds?: ReadonlySet<string>): PointM => {
      if (!snapEnabled || isAltHeldRef.current) {
        setSnapMarker(null);
        return pointM;
      }
      const toleranceM = SNAP_TOLERANCE_PX / getEffectivePixelsPerMeter(viewport);
      const nearbyTargets = snapIndex.query(pointM, toleranceM);
      const ordinaryTargets = excludeIds ? nearbyTargets.filter((target) => !target.objectId || !excludeIds.has(target.objectId)) : nearbyTargets;
      const tangentTargets: SnapTarget[] = draft?.tool === "line" ? objects.flatMap((object) => object.type === "circle" && visibleLayerIds.has(object.layerId) ? tangentPointsToCircleM(draft.startWorld, object, object.radiusM).map((pointM) => ({ pointM, kind: "tangent" as const, objectId: object.id })) : []) : [];
      const targets = [...ordinaryTargets, ...tangentTargets];
      const backgroundLocal = boundingBackground ? worldToObjectLocal(boundingBackground, pointM) : null;
      const insideGridBounds =
        !gridLimited ||
        !boundingBackground ||
        (backgroundLocal !== null &&
          backgroundLocal.xM >= 0 &&
          backgroundLocal.xM <= boundingBackground.widthM &&
          backgroundLocal.yM >= 0 &&
          backgroundLocal.yM <= boundingBackground.heightM);
      const result = snapPointM(pointM, {
        targets,
        gridStepM: gridVisible && insideGridBounds ? grid.spacingM : 0,
        toleranceM,
      });
      setSnapMarker((current) =>
        current?.pointM.xM === result.target?.pointM.xM && current?.pointM.yM === result.target?.pointM.yM
          ? current
          : result.target,
      );
      return result.pointM;
    },
    [snapEnabled, snapIndex, grid.spacingM, gridVisible, gridLimited, boundingBackground, viewport, draft, objects, visibleLayerIds],
  );

  const getPointerWorld = useCallback(
    (stage: Konva.Stage | null, options: { snap?: boolean } = {}): PointM | null => {
      const pointer = stage?.getPointerPosition();
      if (!pointer) return null;
      const world = screenToWorld(pointer, viewport);
      return options.snap === false ? world : snapWorld(world);
    },
    [viewport, snapWorld],
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

  /**
   * Finishing a polyline: `Enter` (or a double-click, below) commits it,
   * `Escape` discards it, `Backspace` takes back the last point.
   *
   * Freehand runs are thinned on commit rather than while drawing, so the
   * stroke on screen is exactly what the hand did and only the stored
   * object is simplified — see `simplifyPolylineM`.
   */
  const commitPolyline = useCallback(
    (draftToCommit: Extract<Draft, { tool: "polyline" }>) => {
      const toleranceM = FREEHAND_SIMPLIFY_PX / getEffectivePixelsPerMeter(viewport);
      const pointsM = simplifyPolylineM(draftToCommit.pointsM, toleranceM);
      if (pointsM.length >= MIN_LINE_POINTS) {
        onCreateObject({
          type: "line",
          xM: draftToCommit.anchorWorld.xM,
          yM: draftToCommit.anchorWorld.yM,
          pointsM,
        });
      }
      setDraft(null);
    },
    [viewport, onCreateObject],
  );

  useEffect(() => {
    if (!draft || draft.tool !== "polyline") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDraft(null);
      else if (event.key === "Enter") commitPolyline(draft);
      else if (event.key === "Backspace" && draft.pointsM.length > 1) {
        event.preventDefault();
        setDraft({ ...draft, pointsM: draft.pointsM.slice(0, -1) });
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [draft, commitPolyline]);

  // Enter persists a completed measurement as an ordinary editable line
  // or polygon. Its label is derived from geometry, so moving a vertex
  // keeps the displayed length/area current. Escape discards the draft.
  useEffect(() => {
    if (!draft || draft.tool !== "measure") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setDraft(null);
      else if (event.key === "Backspace" && draft.pointsWorld.length > 1) {
        event.preventDefault();
        setDraft({ ...draft, pointsWorld: draft.pointsWorld.slice(0, -1) });
      }
      else if (event.key === "Enter" && draft.pointsWorld.length >= 2) {
        const first = draft.pointsWorld[0];
        if (!first) return;
        const pointsM = draft.pointsWorld.map((point) => ({ xM: point.xM - first.xM, yM: point.yM - first.yM }));
        onCreateObject({
          type: "line",
          xM: first.xM,
          yM: first.yM,
          pointsM,
          measurement: { kind: pointsM.length === 3 ? "angle" : "length", showSegments: true },
        });
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

  const handleTouchStart = useCallback((event: Konva.KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length !== 2) return;
    const [a, b] = [event.evt.touches[0], event.evt.touches[1]];
    if (!a || !b) return;
    event.evt.preventDefault();
    event.target.getStage()?.stopDrag();
    pinchDistanceRef.current = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
  }, []);

  const handleTouchMove = useCallback((event: Konva.KonvaEventObject<TouchEvent>) => {
    if (event.evt.touches.length !== 2 || pinchDistanceRef.current === null) return;
    const [a, b] = [event.evt.touches[0], event.evt.touches[1]];
    if (!a || !b) return;
    event.evt.preventDefault();
    const distance = Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
    const rect = event.target.getStage()?.container().getBoundingClientRect();
    if (!rect || distance <= 0) return;
    onZoomAt({ x: (a.clientX + b.clientX) / 2 - rect.left, y: (a.clientY + b.clientY) / 2 - rect.top }, distance / pinchDistanceRef.current);
    pinchDistanceRef.current = distance;
  }, [onZoomAt]);

  const handleTouchEnd = useCallback(() => { pinchDistanceRef.current = null; }, []);

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
          const world = getPointerWorld(stage, { snap: false });
          if (!world) return;
          setDraft({ tool: "marquee", startWorld: world, currentWorld: world });
          return;
        }
        if (e.target !== stage) return;
        onDeselectAll();
        return;
      }
      if (activeTool === "polyline") {
        // Snapped, because this is the point a *click* would place; a
        // freehand stroke re-reads the raw pointer below.
        const world = getPointerWorld(e.target.getStage());
        if (!world) return;
        setDraft((current) =>
          current?.tool === "polyline"
            ? { ...current, pressing: "click", pressStartWorld: world }
            : {
                tool: "polyline",
                anchorWorld: world,
                pointsM: [{ xM: 0, yM: 0 }],
                previewWorld: world,
                pressing: "click",
                pressStartWorld: world,
              },
        );
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
      const stage = e.target.getStage();
      const screen = stage?.getPointerPosition();
      if (!draft) return;
      const world = getPointerWorld(stage);
      if (!world) return;
      if (draft.tool === "polyline") {
        // Freehand follows the raw pointer: snapping every sampled point
        // to the grid would turn a hand-drawn curve into a staircase.
        const rawWorld = screen ? screenToWorld(screen, viewport) : world;
        if (draft.pressing === null) {
          setDraft({ ...draft, previewWorld: world });
          return;
        }
        const pixelsPerMeter = getEffectivePixelsPerMeter(viewport);
        const last = draft.pointsM.at(-1);
        const lastWorld = last
          ? { xM: draft.anchorWorld.xM + last.xM, yM: draft.anchorWorld.yM + last.yM }
          : draft.anchorWorld;
        const travelledPx =
          Math.hypot(rawWorld.xM - lastWorld.xM, rawWorld.yM - lastWorld.yM) * pixelsPerMeter;
        if (draft.pressing === "click" && travelledPx < FREEHAND_THRESHOLD_PX) {
          setDraft({ ...draft, previewWorld: world });
          return;
        }
        if (travelledPx < FREEHAND_SPACING_PX) return;
        setDraft({
          ...draft,
          pressing: "freehand",
          pointsM: [
            ...draft.pointsM,
            { xM: rawWorld.xM - draft.anchorWorld.xM, yM: rawWorld.yM - draft.anchorWorld.yM },
          ],
          previewWorld: rawWorld,
        });
        return;
      }
      if (draft.tool === "polygon") {
        setDraft({ ...draft, previewWorld: world });
      } else if (draft.tool === "measure") {
        // A finished measurement (previewWorld === null) stops following.
        if (draft.previewWorld !== null) setDraft({ ...draft, previewWorld: world });
      } else if (draft.tool === "marquee") {
        setDraft({ ...draft, currentWorld: world });
      } else if (draft.tool === "calibrate") {
        // Once both points are picked, the segment is frozen — stop
        // following the pointer while App.tsx's distance dialog is open.
        if (draft.pointsWorld.length < 2) setDraft({ ...draft, previewWorld: world });
      } else {
        const currentWorld = draft.tool === "line" && isShiftHeld ? constrainPointAngleM(draft.startWorld, world, 15) : world;
        setDraft({ ...draft, currentWorld } as Draft);
      }
    },
    [draft, getPointerWorld, viewport, isShiftHeld],
  );

  const handleMouseUp = useCallback(() => {
    setSnapMarker(null);
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
    } else if (draft.tool === "polyline") {
      // A press that never became a stroke is a click: it placed one
      // point, which mousedown already recorded for the first one. For a
      // later one, add it here so the segment ends where the user clicked.
      if (draft.pressing === "click" && draft.pressStartWorld && draft.pointsM.length > 0) {
        const start = draft.pressStartWorld;
        const last = draft.pointsM.at(-1)!;
        const lastWorld = { xM: draft.anchorWorld.xM + last.xM, yM: draft.anchorWorld.yM + last.yM };
        const isFirstPoint = draft.pointsM.length === 1 && lastWorld.xM === start.xM && lastWorld.yM === start.yM;
        setDraft({
          ...draft,
          pressing: null,
          pressStartWorld: null,
          pointsM: isFirstPoint
            ? draft.pointsM
            : [...draft.pointsM, { xM: start.xM - draft.anchorWorld.xM, yM: start.yM - draft.anchorWorld.yM }],
        });
      } else {
        setDraft({ ...draft, pressing: null, pressStartWorld: null });
      }
      return;
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

  /** A double-click closes the polyline, the habit every drawing tool has taught. */
  const handleDoubleClick = useCallback(() => {
    if (draft?.tool === "polyline") commitPolyline(draft);
  }, [draft, commitPolyline]);

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
      if (activeTool === "measure") {
        const world = getPointerWorld(e.target.getStage());
        if (!world) return;
        if (!draft || draft.tool !== "measure" || draft.previewWorld === null) {
          // A click after Enter starts a fresh measurement rather than
          // extending the finished one.
          setDraft({ tool: "measure", pointsWorld: [world], previewWorld: world });
          return;
        }
        const first = draft.pointsWorld[0];
        if (first && draft.pointsWorld.length >= 3 && Math.hypot(world.xM - first.xM, world.yM - first.yM) <= SNAP_TOLERANCE_PX / getEffectivePixelsPerMeter(viewport)) {
          const pointsM = draft.pointsWorld.map((point) => ({ xM: point.xM - first.xM, yM: point.yM - first.yM }));
          onCreateObject({ type: "polygon", xM: first.xM, yM: first.yM, pointsM, measurement: { kind: "area", showSegments: true } });
          setDraft(null);
          return;
        }
        setDraft({ ...draft, pointsWorld: [...draft.pointsWorld, world] });
        return;
      }
      if (activeTool === "calibrate") {
        // Calibration measures against the plan as drawn, so it reads the
        // raw pointer: snapping it to a grid derived from the current
        // (still wrong) scale would fold that error into the correction.
        const world = getPointerWorld(e.target.getStage(), { snap: false });
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
    [activeTool, draft, getPointerWorld, onCreateObject, onCalibrationMeasured, viewport],
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
          onDblClick={handleDoubleClick}
          onDblTap={handleDoubleClick}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          <KonvaLayer>
            {backgrounds
              .filter((background) => background.visible)
              .map((background) => (
                <BackgroundImageShape
                  key={background.id}
                  background={background}
                  viewport={viewport}
                  selected={background.id === selectedBackgroundId}
                  draggable={activeTool === "select" && !background.locked}
                  selectable={activeTool === "select"}
                  onSelect={() => onSelectBackground(background.id)}
                  onBeginEdit={onBeginObjectEdit}
                  onMoveLive={onBackgroundMoveLive}
                  onResizeLive={onBackgroundResizeLive}
                />
              ))}
          </KonvaLayer>
          <KonvaLayer listening={false}>
            {gridVisible && (
              <Group
                clipFunc={gridClipPoints ? (context) => {
                  const first = gridClipPoints[0];
                  if (!first) return;
                  context.beginPath();
                  context.moveTo(first.x, first.y);
                  for (const point of gridClipPoints.slice(1)) context.lineTo(point.x, point.y);
                  context.closePath();
                } : undefined}
              >
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
              </Group>
            )}
          </KonvaLayer>
          <KonvaLayer>
            {renderObjects
              .map((object) => {
                const layer = layersById.get(object.layerId);
                return (
                  <PlanObjectShape
                    labelDisplay={labelDisplay}
                    key={object.id}
                    object={object}
                    viewport={viewport}
                    selected={selectedIdSet.has(object.id)}
                    draggable={activeTool === "select" && layer?.locked !== true}
                    selectable={activeTool === "select"}
                    onSelect={(additive) => onSelectObject(object.id, additive)}
                    onBeginEdit={() => onBeginObjectDrag(object.id)}
                    onMoveLive={(xM, yM) => {
                      // An object must not snap to its own corners, or it
                      // would pin itself the instant the drag began.
                      const snapped = snapWorld({ xM, yM }, selectedIdSet.has(object.id) ? selectedIdSet : new Set([object.id]));
                      onObjectMoveLive(object.id, snapped.xM, snapped.yM);
                    }}
                    simplified={simplifiedRendering}
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
                snapWorld={(pointM) => snapWorld(pointM, new Set([selectedObject.id]))}
              />
            )}
            {multiSelectionBounds && <MultiSelectionOutline bounds={multiSelectionBounds} viewport={viewport} />}
          </KonvaLayer>
          <KonvaLayer listening={false}>
            <DraftPreview draft={draft} viewport={viewport} />
            {snapMarker && <SnapMarker target={snapMarker} viewport={viewport} />}
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
    const widthM = Math.abs(draft.currentWorld.xM - draft.startWorld.xM);
    const heightM = Math.abs(draft.currentWorld.yM - draft.startWorld.yM);
    return (
      <>
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
      <Text x={topLeft.x + 8} y={topLeft.y + 8} text={`${formatLengthM(widthM)} × ${formatLengthM(heightM)}`} fontSize={12} fill="#2563eb" />
      </>
    );
  }

  if (draft.tool === "polyline") {
    const anchor = worldToScreen(draft.anchorWorld, viewport);
    const committed = draft.pointsM.flatMap((point) => {
      const screen = worldToScreen(
        { xM: draft.anchorWorld.xM + point.xM, yM: draft.anchorWorld.yM + point.yM },
        viewport,
      );
      return [screen.x, screen.y];
    });
    // The rubber band to the pointer is only meaningful between clicks;
    // while a freehand stroke is being drawn the line already ends there.
    const preview =
      draft.previewWorld && draft.pressing !== "freehand"
        ? (() => {
            const screen = worldToScreen(draft.previewWorld, viewport);
            return [screen.x, screen.y];
          })()
        : [];
    const lengthM = polylineLengthM(draft.pointsM);
    return (
      <>
        <Line points={[...committed, ...preview]} stroke="#2563eb" strokeWidth={1.5} dash={preview.length > 0 ? [6, 4] : undefined} lineJoin="round" lineCap="round" />
        {draft.pointsM.map((point, index) => {
          const screen = worldToScreen(
            { xM: draft.anchorWorld.xM + point.xM, yM: draft.anchorWorld.yM + point.yM },
            viewport,
          );
          // Freehand samples are far too dense to mark individually.
          return draft.pressing === "freehand" && index > 0 ? null : (
            <KonvaCircle key={index} x={screen.x} y={screen.y} radius={3} fill="#ffffff" stroke="#2563eb" strokeWidth={1.5} />
          );
        })}
        {lengthM > 0 && (
          <Text x={anchor.x + 10} y={anchor.y - 18} text={formatLengthM(lengthM)} fontSize={12} fill="#2563eb" />
        )}
      </>
    );
  }

  if (draft.tool === "circle") {
    const center = worldToScreen(draft.centerWorld, viewport);
    const radiusPx = metersToPixels(
      Math.hypot(draft.currentWorld.xM - draft.centerWorld.xM, draft.currentWorld.yM - draft.centerWorld.yM),
      viewport,
    );
    return (
      <>
      <KonvaCircle
        x={center.x}
        y={center.y}
        radius={radiusPx}
        fill="rgba(22, 163, 74, 0.15)"
        stroke="#16a34a"
        strokeWidth={1.5}
        dash={[6, 4]}
      />
      <Text x={center.x + radiusPx + 8} y={center.y - 8} text={`R ${formatLengthM(radiusPx / (viewport.basePixelsPerMeter * viewport.zoom))}`} fontSize={12} fill="#16a34a" />
      </>
    );
  }

  if (draft.tool === "line") {
    const start = worldToScreen(draft.startWorld, viewport);
    const end = worldToScreen(draft.currentWorld, viewport);
    const dx = draft.currentWorld.xM - draft.startWorld.xM;
    const dy = draft.currentWorld.yM - draft.startWorld.yM;
    return <><Line points={[start.x, start.y, end.x, end.y]} stroke="#0f172a" strokeWidth={2} dash={[6, 4]} /><Text x={(start.x + end.x) / 2 + 8} y={(start.y + end.y) / 2 - 18} text={`${formatLengthM(Math.hypot(dx, dy))} · ${formatAngleDeg((Math.atan2(dy, dx) * 180) / Math.PI)}`} fontSize={12} fill="#0f172a" /></>;
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

  if (draft.tool === "measure") {
    const screen = draft.pointsWorld.map((point) => worldToScreen(point, viewport));
    const previewScreen = draft.previewWorld ? worldToScreen(draft.previewWorld, viewport) : null;
    // The live segment is part of the measurement as far as the reader is
    // concerned, so the running total includes it.
    const livePoints = draft.previewWorld ? [...draft.pointsWorld, draft.previewWorld] : draft.pointsWorld;
    const liveScreen = previewScreen ? [...screen, previewScreen] : screen;
    const lengths = segmentLengthsM(livePoints);
    const totalM = polylineLengthM(livePoints);
    const areaM2 = livePoints.length >= 3 ? polygonAreaM2(livePoints) : 0;
    const flat = liveScreen.flatMap((point) => [point.x, point.y]);
    const last = liveScreen[liveScreen.length - 1];

    return (
      <>
        {livePoints.length >= 3 && (
          <Line points={flat} closed fill="rgba(15, 118, 110, 0.10)" listening={false} />
        )}
        {flat.length >= 4 && <Line points={flat} stroke={MEASURE_COLOR} strokeWidth={2} />}
        {liveScreen.map((point, index) => (
          <KonvaCircle key={`m-${index}-${point.x}-${point.y}`} x={point.x} y={point.y} radius={4} fill={MEASURE_COLOR} />
        ))}
        {lengths.map((lengthM, index) => {
          const from = liveScreen[index];
          const to = liveScreen[index + 1];
          if (!from || !to) return null;
          return (
            <Text
              key={`ml-${index}`}
              x={(from.x + to.x) / 2 + 6}
              y={(from.y + to.y) / 2 - 16}
              text={formatLengthM(lengthM)}
              fontSize={12}
              fill={MEASURE_COLOR}
            />
          );
        })}
        {last && lengths.length > 0 && (
          <Text
            x={last.x + 10}
            y={last.y + 10}
            text={
              areaM2 > 0
                ? `Total ${formatLengthM(totalM)}\nAire ${formatAreaM2(areaM2)}`
                : `Total ${formatLengthM(totalM)}`
            }
            fontSize={13}
            fontStyle="bold"
            fill={MEASURE_COLOR}
          />
        )}
      </>
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

/** A small cross-hair on the point the pointer was pulled to, so a snap is visible rather than merely felt. */
function SnapMarker({ target, viewport }: { target: SnapTarget; viewport: Viewport }) {
  const point = worldToScreen(target.pointM, viewport);
  if (target.kind === "alignment-x" || target.kind === "alignment-y" || target.kind === "alignment-xy") {
    return (
      <>
        {(target.kind === "alignment-x" || target.kind === "alignment-xy") && <Line points={[point.x, -10000, point.x, 10000]} stroke={MEASURE_COLOR} strokeWidth={1} dash={[5, 5]} />}
        {(target.kind === "alignment-y" || target.kind === "alignment-xy") && <Line points={[-10000, point.y, 10000, point.y]} stroke={MEASURE_COLOR} strokeWidth={1} dash={[5, 5]} />}
        <KonvaCircle x={point.x} y={point.y} radius={5} fill="#ffffff" stroke={MEASURE_COLOR} strokeWidth={1.5} />
      </>
    );
  }
  const size = target.kind === "grid" ? 4 : 6;
  return (
    <>
      <Line
        points={[point.x - size, point.y, point.x + size, point.y]}
        stroke={MEASURE_COLOR}
        strokeWidth={1.5}
      />
      <Line
        points={[point.x, point.y - size, point.x, point.y + size]}
        stroke={MEASURE_COLOR}
        strokeWidth={1.5}
      />
      {target.kind !== "grid" && (
        <KonvaCircle x={point.x} y={point.y} radius={size + 2} stroke={MEASURE_COLOR} strokeWidth={1.5} />
      )}
    </>
  );
}
