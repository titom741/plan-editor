import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  computeDefaultBackgroundPlacement,
  createBackgroundImage,
  cropRectFromMargins,
  getBackgroundCropMargins,
  worldDistanceToImagePixels,
} from "../domain/background";
import { boundsCenterM, getBackgroundBoundsM, unionBounds, type BoundsM } from "../domain/bounds";
import { DEFAULT_LABEL_DISPLAY, type LabelDisplay } from "../domain/display";
import {
  clearGroup,
  createNamedGroup,
  distributeObjects,
  transformObjectAroundPivot,
} from "../domain/grouping";
import type { StandGrid } from "../domain/stands";
import type { CatalogItem } from "../domain/catalog";
import { duplicateObjects } from "../domain/clipboard";
import {
  analyzeNetwork,
  createCableObject,
  createDeviceObject,
  electricalLayerId,
  isCable,
  reconcileCables,
  sizeCableForDevices,
} from "../domain/electrical";
import { calibrationFromKnownDistance, calibrationFromKnownScale } from "../domain/calibration";
import { sortLayersByOrder } from "../domain/layers";
import { nextObjectName } from "../domain/labels";
import { DEFAULT_SYMBOL_CHARACTER } from "../domain/symbols";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createSymbolObject,
  createTextObject,
  createImageObject,
} from "../domain/objects";
import {
  addObject,
  addObjects,
  applyCalibration,
  createEmptyProject,
  patchBackground,
  patchObject,
  patchObjects,
  removeBackground,
  removeObjects,
  addBackground,
  replaceBackground,
  moveBackground,
} from "../domain/project";
import type {
  BackgroundImage,
  ObjectStyle,
  PlanObjectPatch,
  PointM,
  Project,
  RectangleObject,
} from "../domain/types";
import { DEFAULT_SCREEN_PIXELS_PER_METER, screenToWorld } from "../rendering/viewport";
import { CalibrationDialog } from "./components/CalibrationDialog";
import { DeleteLayerDialog, LayerStyleDialog } from "./components/LayerDialogs";
import { StandsDialog } from "./components/StandsDialog";
import { ExportDialog } from "./components/ExportDialog";
import { LayersPanel } from "./components/LayersPanel";
import { PlanCanvas } from "./components/PlanCanvas";
import type { NewObjectSpec } from "./components/PlanCanvas";
import { PrintCanvas } from "./components/PrintCanvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { ElementsPanel } from "./components/ElementsPanel";
import { SheetPreview } from "./components/SheetPreview";
import { ScaleCalibrationDialog } from "./components/ScaleCalibrationDialog";
import { Toolbar } from "./components/Toolbar";
import { ToolbarCustomizeDialog } from "./components/ToolbarCustomizeDialog";
import { CommandMenu } from "./components/CommandMenu";
import { DialogErrorFallback, ErrorBoundary } from "./components/ErrorBoundary";
import { ToolsPanel } from "./components/ToolsPanel";
import { ElectricalPanel } from "./components/ElectricalPanel";
import { SaveFolderDialog } from "./components/SaveFolderDialog";
import { loadSaveFolder, storeSaveFolder, type SaveFolder } from "../persistence/saveFolder";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { CommentsDialog } from "./components/CommentsDialog";
import { useAutosave } from "./hooks/useAutosave";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useLayerActions } from "./hooks/useLayerActions";
import { useClipboard } from "./hooks/useClipboard";
import { useSelection } from "./hooks/useSelection";
import {
  clampRailSize,
  loadCollapsedSections,
  loadRailSizes,
  saveCollapsedSections,
  saveRailSizes,
  toggleSection,
  type PanelSectionId,
  type RailSizes,
} from "./panelSections";
import { CSS_PIXELS_PER_INCH, useSheetExport } from "./hooks/useSheetExport";
import { useViewport } from "./hooks/useViewport";
import {
  describeParseError,
  readProjectFile,
  readProjectText,
  openProjectFileNatively,
  saveProjectFile,
  saveProjectFileAs,
  describeSaveDestination,
  type SaveDestination,
} from "./projectFileActions";
import { onNativeFileOpened } from "./nativeBridge";
import type { ToolId } from "./tools";
import { downloadDiagnosticReport } from "./diagnosticActions";
import { loadShortcuts, saveShortcuts, type ShortcutMap } from "./shortcuts";
import {
  DEFAULT_PINNED_COMMANDS,
  loadPinnedCommands,
  savePinnedCommands,
  togglePinnedCommand,
  type CommandId,
} from "./commands";
import {
  deleteComponentTemplate,
  loadComponentTemplates,
  saveComponentTemplate,
  type ComponentTemplate,
} from "../persistence/componentStorage";
import "./App.css";

const LibraryDialog = lazy(() =>
  import("./components/LibraryDialog").then((module) => ({ default: module.LibraryDialog })),
);
const ProjectsDialog = lazy(() =>
  import("./components/ProjectsDialog").then((module) => ({ default: module.ProjectsDialog })),
);
const ScheduleDialog = lazy(() =>
  import("./components/ScheduleDialog").then((module) => ({ default: module.ScheduleDialog })),
);
const ElectricalDialog = lazy(() =>
  import("./components/ElectricalDialog").then((module) => ({
    default: module.ElectricalDialog,
  })),
);
const ExchangeDialog = lazy(() =>
  import("./components/ExchangeDialog").then((module) => ({ default: module.ExchangeDialog })),
);

/**
 * Arrow-key presses closer together than this are folded into a single
 * undo step. Holding an arrow down fires the key at the OS repeat rate, and
 * without this one nudge across a room would bury every earlier edit under
 * fifty history entries.
 */
const NUDGE_COALESCE_MS = 700;

/** Builds the actual `PlanObject` (naming, layer assignment) from a gesture the canvas reports — see `PlanCanvas`'s `NewObjectSpec`. */
/**
 * How a persisted measurement looks by default: the same teal the live
 * measuring overlay uses, with no fill, so an annotation reads as an
 * annotation and not as another thing standing on the ground. It is only
 * a *default* — a measurement is an ordinary line or polygon, so its
 * colour and stroke width are editable like any other object's.
 */
const MEASUREMENT_STYLE: ObjectStyle = {
  stroke: "#0f766e",
  strokeWidth: 2,
  fill: undefined,
  dash: "dashed",
};

function buildObjectFromSpec(project: Project, spec: NewObjectSpec, layerId: string) {
  const name = nextObjectName(project, spec.type === "device" ? spec.role : spec.type);
  const isMeasurement = "measurement" in spec && spec.measurement !== undefined;
  const style = isMeasurement
    ? MEASUREMENT_STYLE
    : project.layers.find((layer) => layer.id === layerId)?.defaultStyle;
  const common = { layerId, name, xM: spec.xM, yM: spec.yM, style };

  switch (spec.type) {
    case "rectangle":
      return createRectangleObject({ ...common, widthM: spec.widthM, heightM: spec.heightM });
    case "circle":
      return createCircleObject({ ...common, radiusM: spec.radiusM });
    case "line":
      return createLineObject({ ...common, pointsM: spec.pointsM, measurement: spec.measurement });
    case "polygon":
      return createPolygonObject({
        ...common,
        pointsM: spec.pointsM,
        measurement: spec.measurement,
      });
    case "arrow":
      // A line that carries a head. The layer's default style still
      // applies underneath — only the arrowhead is the tool's doing.
      return createLineObject({
        ...common,
        style: { ...(style ?? {}), arrowEnd: true },
        pointsM: spec.pointsM,
      });
    case "symbol":
      return createSymbolObject({ ...common, character: spec.character });
    case "text":
      return createTextObject({ ...common, text: "Texte" });
    // Electrical objects bring their own look — a coffret drawn in the
    // layer's generic style would not read as a coffret.
    case "device":
      return createDeviceObject({ role: spec.role, center: spec, layerId, name });
    case "cable":
      return createCableObject({ anchor: spec, pointsM: spec.pointsM, layerId, name });
  }
}

/** The modal dialogs the editor can show. Exactly one at a time — see `openDialog`. */
type DialogId =
  | "scaleCalibration"
  | "export"
  | "library"
  | "schedule"
  | "electrical"
  | "projects"
  | "exchange"
  | "shortcuts"
  | "comments"
  | "customizeToolbar"
  | "saveFolder";

interface EditorProps {
  /** The project the session starts from — restored from storage, or a fresh one. Read once: from here on the editor owns the document. */
  initialProject: Project;
  /** False while `App` is still trying to restore a saved project; gates autosave so the starting project can't overwrite it. */
  autosaveEnabled: boolean;
  /** Shown once under the toolbar when the previous session couldn't be restored. */
  restoreNotice: string | null;
  onDismissRestoreNotice: () => void;
}

export default function Editor({
  initialProject,
  autosaveEnabled,
  restoreNotice,
  onDismissRestoreNotice,
}: EditorProps) {
  const {
    project,
    beginEdit,
    applyLiveEdit,
    commitChange,
    setProjectDirect,
    resetHistory,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectHistory(initialProject);

  const [activeTool, setActiveTool] = useState<ToolId>("select");
  /**
   * The character the symbol tool will place. Session state, not
   * document state: it is which symbol the user is currently stamping,
   * and a plan file has no business remembering it.
   */
  const [symbolCharacter, setSymbolCharacter] = useState(DEFAULT_SYMBOL_CHARACTER);
  /** The layer new objects land on. KL-002 always used the first unlocked layer; KL-006 makes it the user's choice. */
  const [calibrationPoints, setCalibrationPoints] = useState<{
    pointA: PointM;
    pointB: PointM;
  } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // One state rather than eight booleans: these are all modal, so "which
  // one is open" is a single fact. Eight independent flags could represent
  // two dialogs stacked on top of each other — a state the app has no UI
  // for and never wants to reach.
  const [openDialog, setOpenDialog] = useState<DialogId | null>(null);
  const closeDialog = useCallback(() => setOpenDialog(null), []);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => loadShortcuts());
  // One set for every foldable side panel. The left rail opens one menu at
  // a time, the right one stacks, and both the folds and the rail sizes
  // persist — see `panelSections.ts`, which owns those rules so they can be
  // tested without a DOM.
  const [collapsedSections, setCollapsedSections] = useState<ReadonlySet<PanelSectionId>>(() =>
    loadCollapsedSections(),
  );
  const isCollapsed = useCallback(
    (id: PanelSectionId) => collapsedSections.has(id),
    [collapsedSections],
  );
  const toggleCollapsed = useCallback((id: PanelSectionId) => {
    setCollapsedSections((current) => saveCollapsedSections(toggleSection(current, id)));
  }, []);

  const [railSizes, setRailSizes] = useState<RailSizes>(() => loadRailSizes());
  /** Mirrors `railSizes` so the window-level drag handlers read it without re-subscribing on every pixel. */
  const railSizesRef = useRef(railSizes);
  const inspectorRailRef = useRef<HTMLDivElement | null>(null);
  const railDragRef = useRef<
    | {
        axis: "x";
        key: "toolsWidthPx" | "propertiesWidthPx";
        sign: 1 | -1;
        startPx: number;
        startValue: number;
      }
    | { axis: "y"; startPx: number; startValue: number; railHeightPx: number }
    | null
  >(null);
  // A resize is a window-level gesture: the pointer routinely leaves the
  // eight-pixel handle it started on, so both rails share one listener
  // pair rather than each handle tracking its own.
  useEffect(() => {
    const move = (event: PointerEvent) => {
      const drag = railDragRef.current;
      if (!drag) return;
      const next =
        drag.axis === "x"
          ? {
              ...railSizesRef.current,
              [drag.key]: clampRailSize(
                drag.key,
                drag.startValue + (event.clientX - drag.startPx) * drag.sign,
              ),
            }
          : {
              ...railSizesRef.current,
              propertiesPercent: clampRailSize(
                "propertiesPercent",
                drag.startValue + ((event.clientY - drag.startPx) / drag.railHeightPx) * 100,
              ),
            };
      railSizesRef.current = next;
      setRailSizes(next);
    };
    // Written once when the gesture ends, not on every pixel of the drag.
    const up = () => {
      if (!railDragRef.current) return;
      railDragRef.current = null;
      saveRailSizes(railSizesRef.current);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
  }, []);
  const startWidthDrag = useCallback(
    (key: "toolsWidthPx" | "propertiesWidthPx", event: ReactPointerEvent) => {
      event.preventDefault();
      railDragRef.current = {
        axis: "x",
        key,
        sign: key === "toolsWidthPx" ? 1 : -1,
        startPx: event.clientX,
        startValue: railSizesRef.current[key],
      };
    },
    [],
  );
  const startInspectorDrag = useCallback((event: ReactPointerEvent) => {
    const railHeightPx = inspectorRailRef.current?.clientHeight ?? 0;
    if (railHeightPx <= 0) return;
    event.preventDefault();
    railDragRef.current = {
      axis: "y",
      startPx: event.clientY,
      startValue: railSizesRef.current.propertiesPercent,
      railHeightPx,
    };
  }, []);
  const [componentTemplates, setComponentTemplates] = useState<ComponentTemplate[]>(() =>
    loadComponentTemplates(),
  );
  /** Snapping is on by default: a plan is drawn to fit together, and the people who don't want it find the switch faster than the people who need it find its absence. */
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [gridVisible, setGridVisible] = useState(true);
  const [gridLimited, setGridLimited] = useState(true);
  /** Non-null while the off-screen print stage is mounted and we're waiting for it to be ready to rasterise. */
  /** The editor's own clipboard. Copies live in memory: this is a single-window, offline app, so there is no system clipboard to round-trip through. */
  /** How many times the current clipboard has been pasted, so each paste lands a little further along instead of on top of the last. */
  /** Every selected object's position at the moment a drag started, so a group move is recomputed from the origin rather than accumulated. */
  const dragOriginRef = useRef<{ positions: Map<string, PointM> } | null>(null);
  /** When the last arrow-key nudge happened, for coalescing a burst into one undo step. */
  const lastNudgeAtRef = useRef(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const objectImageInputRef = useRef<HTMLInputElement>(null);

  const saveStatus = useAutosave(project, autosaveEnabled);

  // A display constant, not the project's calibration — see
  // `DEFAULT_SCREEN_PIXELS_PER_METER`. Calibrating a background corrects
  // the background's real-world size, it doesn't change how big a meter is
  // drawn on screen.
  const navigationBounds = useMemo(() => {
    // Framing follows the whole visible stack, not one image: with a
    // survey plan and a satellite view over it, "fit the plan" has to
    // show both.
    const visible = project.backgrounds.filter((background) => background.visible);
    return visible.reduce<BoundsM | null>(
      (bounds, background) => unionBounds(bounds, getBackgroundBoundsM(background)),
      null,
    );
  }, [project.backgrounds]);
  const { viewport, containerRef, stageSize, zoomAt, pan, fitBounds } = useViewport(
    DEFAULT_SCREEN_PIXELS_PER_METER,
    navigationBounds,
  );
  /**
   * Backdrop ids the view has already accounted for.
   *
   * Two rules, and the set is what tells them apart. Opening a document
   * (the set is still empty) frames whatever it contains. After that, a
   * newly imported backdrop frames the view only if it is the *only* one
   * — adding a second over a plan the user has already framed must leave
   * the camera where they put it.
   *
   * Keyed per id rather than on "whichever is first", because reordering
   * the stack changes who is first, and that was re-framing the view and
   * yanking the user away from what they were looking at.
   */
  const autoFittedBackgroundIdsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (stageSize.widthPx <= 0 || stageSize.heightPx <= 0) return;
    const seen = autoFittedBackgroundIdsRef.current;
    const unseen = project.backgrounds.filter((background) => !seen.has(background.id));
    if (unseen.length === 0) return;

    const isOpeningDocument = seen.size === 0;
    for (const background of unseen) seen.add(background.id);

    if (isOpeningDocument) {
      if (navigationBounds) fitBounds(navigationBounds);
      return;
    }
    const onlyOne = project.backgrounds.length === 1 ? project.backgrounds[0] : undefined;
    if (onlyOne?.visible) fitBounds(getBackgroundBoundsM(onlyOne));
  }, [project.backgrounds, navigationBounds, stageSize, fitBounds]);

  /** What labels show across this plan; an object may still override it for itself. */
  const labelDisplay = project.labelDisplay ?? DEFAULT_LABEL_DISPLAY;
  /** True once anything is imported: the grid is then bounded to the plan rather than running to the horizon. */
  const hasVisibleBackground = project.backgrounds.some((background) => background.visible);

  /**
   * A plan-wide label change is a change to the *document* — it decides
   * what the exported sheet says — so it goes through the undo stack like
   * any other edit, not through `setProjectDirect`.
   */
  const handleLabelDisplayChange = useCallback(
    (nextDisplay: LabelDisplay) => {
      commitChange((current) => ({
        ...current,
        labelDisplay: nextDisplay,
        updatedAt: new Date().toISOString(),
      }));
    },
    [commitChange],
  );

  const objectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const object of project.objects)
      counts.set(object.layerId, (counts.get(object.layerId) ?? 0) + 1);
    return counts;
  }, [project.objects]);

  /** Objects in draw order: by their layer's `order`, then by creation order within a layer. */
  const orderedObjects = useMemo(() => {
    const rank = new Map(
      sortLayersByOrder(project.layers).map((layer, index) => [layer.id, index]),
    );
    // Within a layer, cables go under everything else: their ends sit on
    // the devices' centres, and must not cross out the box they plug into.
    return [...project.objects].sort(
      (a, b) =>
        (rank.get(a.layerId) ?? 0) - (rank.get(b.layerId) ?? 0) ||
        Number(!isCable(a)) - Number(!isCable(b)),
    );
  }, [project.objects, project.layers]);

  // Read once per change of the plan, and shared: the properties panel
  // shows one object's slice of it, the diagram dialog the whole (KL-045).
  const electricalNetwork = useMemo(() => analyzeNetwork(project), [project]);

  const lockedLayerIds = useMemo(
    () => new Set(project.layers.filter((layer) => layer.locked).map((layer) => layer.id)),
    [project.layers],
  );
  const visibleLayerIds = useMemo(
    () => new Set(project.layers.filter((layer) => layer.visible).map((layer) => layer.id)),
    [project.layers],
  );
  const {
    activeLayerId: effectiveLayerId,
    setActiveLayerId,
    prompt: layerPrompt,
    cancelPrompt: cancelLayerPrompt,
    toggleVisible: toggleLayerVisible,
    toggleLocked: toggleLayerLocked,
    add: addLayerAction,
    rename: renameLayerAction,
    move: moveLayerAction,
    requestDelete: requestDeleteLayer,
    confirmDelete: confirmDeleteLayer,
    requestStyle: requestLayerStyle,
    confirmStyle: confirmLayerStyle,
    setFolder: setLayerFolder,
    assignObjects: assignObjectsToLayerAction,
  } = useLayerActions({ project, commitChange, setProjectDirect });

  const {
    selectedIds,
    selectedBackgroundId,
    selectedObjects,
    selectedObject,
    selectionBounds,
    isSelectedLocked,
    editableSelection,
    selectObject,
    selectMany,
    selectAll,
    selectBackground,
    selectOnly,
    deselectAll,
  } = useSelection({ project, visibleLayerIds, lockedLayerIds });

  const {
    sheet,
    availableSheets,
    setActiveSheetId,
    contentBounds,
    sheetLayout,
    printRaster,
    printStageRef,
    pendingExport,
    rasterObjects,
    printGrid,
    setPrintGrid,
    transparentPng,
    setTransparentPng,
    enlargeSmallText,
    setEnlargeSmallText,
    changeSheet,
    addSheet,
    duplicateSheet,
    deleteSheet,
    startExport,
    startMultiPageExport,
    handlePrintCanvasReady,
    standLegibility,
  } = useSheetExport({
    project,
    orderedObjects,
    visibleLayerIds,
    commitChange,
    onError: setFileError,
  });

  /** The backdrop the properties panel is editing, resolved fresh so a removed one drops out of the selection. */
  const selectedBackground =
    project.backgrounds.find((candidate) => candidate.id === selectedBackgroundId) ?? null;
  const isBackgroundLocked = selectedBackground?.locked === true;

  const handleSelectTool = useCallback(
    (toolId: ToolId) => {
      setActiveTool(toolId);
      if (toolId !== "select") deselectAll();
    },
    [deselectAll],
  );

  // The object is built *before* the state update, not read back out of
  // its updater: React may defer an updater to the next render, and
  // recovering an id from inside one only works while React happens to
  // take its eager path. The paste below was caught doing exactly that in
  // the browser — the copies appeared, but the selection stayed on the
  // originals.
  const handleCreateObject = useCallback(
    (spec: NewObjectSpec) => {
      const layerId =
        spec.type === "device" || spec.type === "cable"
          ? (electricalLayerId(project.layers) ?? effectiveLayerId)
          : effectiveLayerId;
      if (!layerId) return;
      const object = buildObjectFromSpec(project, spec, layerId);
      if (object) {
        commitChange((currentProject) => {
          const added = addObject(currentProject, object);
          // A cable is sized for what it was plugged into, which is only
          // known once its ends have been reconciled onto the devices.
          return object.electrical?.role === "cable"
            ? sizeCableForDevices(reconcileCables(currentProject, added), object.id)
            : added;
        });
        selectOnly([object.id]);
      }
      setActiveTool("select");
    },
    [project, effectiveLayerId, commitChange, selectOnly],
  );

  const handleBeginObjectEdit = useCallback(() => beginEdit(), [beginEdit]);

  const handleObjectLiveUpdate = useCallback(
    (id: string, patch: PlanObjectPatch) => {
      applyLiveEdit((currentProject) => patchObject(currentProject, id, patch));
    },
    [applyLiveEdit],
  );

  const handleObjectCommitUpdate = useCallback(
    (id: string, patch: PlanObjectPatch) => {
      commitChange((currentProject) => patchObject(currentProject, id, patch));
    },
    [commitChange],
  );

  /**
   * A shape's drag begins: snapshot where every object that will move is
   * *now*, so each frame can be solved as "origin + total delta" rather
   * than "previous position + this frame's delta". The second form drifts,
   * and drifts differently for each member of a group.
   */
  const handleBeginObjectDrag = useCallback(
    (id: string) => {
      beginEdit();
      const moving = selectedIds.includes(id) ? new Set(selectedIds) : new Set([id]);
      const positions = new Map<string, PointM>();
      for (const object of project.objects) {
        if (!moving.has(object.id)) continue;
        if (lockedLayerIds.has(object.layerId)) continue;
        positions.set(object.id, { xM: object.xM, yM: object.yM });
      }
      dragOriginRef.current = { positions };
    },
    [beginEdit, selectedIds, project.objects, lockedLayerIds],
  );

  const handleObjectMoveLive = useCallback(
    (id: string, xM: number, yM: number) => {
      const origin = dragOriginRef.current;
      const start = origin?.positions.get(id);
      if (origin && start && origin.positions.size > 1) {
        const deltaXM = xM - start.xM;
        const deltaYM = yM - start.yM;
        const patches = new Map<string, PlanObjectPatch>();
        for (const [movingId, position] of origin.positions) {
          patches.set(movingId, { xM: position.xM + deltaXM, yM: position.yM + deltaYM });
        }
        applyLiveEdit((currentProject) => patchObjects(currentProject, patches));
        return;
      }
      applyLiveEdit((currentProject) => patchObject(currentProject, id, { xM, yM }));
    },
    [applyLiveEdit],
  );

  /**
   * Arrow-key movement. The new positions are computed inside the updater,
   * from the project as it is at that moment, so a key repeating faster
   * than React re-renders still moves the selection once per press instead
   * of losing the presses that shared a stale snapshot.
   */
  const handleNudge = useCallback(
    (deltaXM: number, deltaYM: number) => {
      if (selectedIds.length === 0) return;
      const moving = new Set(selectedIds);
      const nudge = (currentProject: Project) => {
        const patches = new Map<string, PlanObjectPatch>();
        for (const object of currentProject.objects) {
          if (!moving.has(object.id) || lockedLayerIds.has(object.layerId)) continue;
          patches.set(object.id, { xM: object.xM + deltaXM, yM: object.yM + deltaYM });
        }
        return patchObjects(currentProject, patches);
      };

      const now = Date.now();
      const continuesBurst = now - lastNudgeAtRef.current < NUDGE_COALESCE_MS;
      lastNudgeAtRef.current = now;
      if (continuesBurst) applyLiveEdit(nudge);
      else commitChange(nudge);
    },
    [selectedIds, lockedLayerIds, applyLiveEdit, commitChange],
  );

  const handleBackgroundLiveUpdate = useCallback(
    (patch: Partial<BackgroundImage>) => {
      if (!selectedBackgroundId) return;
      applyLiveEdit((currentProject) =>
        patchBackground(currentProject, selectedBackgroundId, patch),
      );
    },
    [applyLiveEdit, selectedBackgroundId],
  );

  const handleBackgroundMoveLive = useCallback(
    (xM: number, yM: number) => handleBackgroundLiveUpdate({ xM, yM }),
    [handleBackgroundLiveUpdate],
  );

  const handleBackgroundResizeLive = useCallback(
    (widthM: number, heightM: number) => handleBackgroundLiveUpdate({ widthM, heightM }),
    [handleBackgroundLiveUpdate],
  );

  /** Calibration measures on the selected backdrop; with none selected it falls back to the topmost one. */
  const calibratedBackground = selectedBackground ?? project.backgrounds.at(-1) ?? null;

  const handleRequestCalibration = useCallback(() => {
    if (!selectedBackground || isBackgroundLocked) return;
    deselectAll();
    setCalibrationPoints(null);
    setActiveTool("calibrate");
  }, [selectedBackground, isBackgroundLocked, deselectAll]);

  const handleCalibrationMeasured = useCallback((pointA: PointM, pointB: PointM) => {
    setCalibrationPoints({ pointA, pointB });
  }, []);

  const handleCancelCalibration = useCallback(() => {
    setCalibrationPoints(null);
    setActiveTool("select");
  }, []);

  const handleConfirmScaleCalibration = useCallback(
    (scale: number, dpi: number) => {
      if (!calibratedBackground) return;
      const backgroundId = calibratedBackground.id;
      commitChange((currentProject) =>
        applyCalibration(currentProject, calibrationFromKnownScale(scale, dpi), backgroundId),
      );
      closeDialog();
      setActiveTool("select");
      selectBackground(backgroundId);
    },
    [commitChange, closeDialog, selectBackground, calibratedBackground],
  );

  // Turns the two clicked points (in the project's current, possibly
  // still-approximate scale) plus the real distance the user just typed
  // into an actual `Calibration`, and commits it — one undo step covering
  // both the new `calibration` and the background's corrected size, since
  // they're derived together (see `domain/project.ts`'s `applyCalibration`).
  const handleConfirmCalibration = useCallback(
    (realDistanceM: number) => {
      if (!calibrationPoints || !calibratedBackground) return;
      const { pointA, pointB } = calibrationPoints;
      const measuredDistanceM = Math.hypot(pointB.xM - pointA.xM, pointB.yM - pointA.yM);
      const pixelDistance = worldDistanceToImagePixels(calibratedBackground, measuredDistanceM);
      const calibration = calibrationFromKnownDistance(pixelDistance, realDistanceM);
      commitChange((currentProject) =>
        applyCalibration(currentProject, calibration, calibratedBackground.id),
      );
      setCalibrationPoints(null);
      setActiveTool("select");
      selectBackground(calibratedBackground.id);
    },
    [calibrationPoints, calibratedBackground, commitChange, selectBackground],
  );

  const handleDeleteSelected = useCallback(() => {
    if (selectedBackgroundId) {
      if (isBackgroundLocked) return;
      commitChange((currentProject) => removeBackground(currentProject, selectedBackgroundId));
      deselectAll();
      return;
    }
    // A locked layer's objects can be selected (to inspect them) but not
    // deleted, so a mixed selection deletes the unlocked part and leaves
    // the rest — rather than refusing the whole gesture.
    const deletable = selectedObjects
      .filter((object) => !lockedLayerIds.has(object.layerId))
      .map((object) => object.id);
    if (deletable.length === 0) return;
    commitChange((currentProject) => removeObjects(currentProject, deletable));
    deselectAll();
  }, [
    selectedBackgroundId,
    isBackgroundLocked,
    selectedObjects,
    lockedLayerIds,
    commitChange,
    deselectAll,
  ]);

  const { copy, paste, duplicate } = useClipboard({
    project,
    selectedObjects,
    fallbackLayerId: effectiveLayerId,
    commitChange,
    onPasted: useCallback(
      (ids: readonly string[]) => {
        selectOnly(ids);
        setActiveTool("select");
      },
      [selectOnly],
    ),
  });

  useEditorShortcuts({
    shortcuts,
    onUndo: undo,
    onRedo: redo,
    onDelete: handleDeleteSelected,
    onDeselect: deselectAll,
    onSelectAll: selectAll,
    onNudge: handleNudge,
    onCopy: copy,
    onPaste: paste,
    onDuplicate: duplicate,
  });

  const handleCreateGroup = useCallback(() => {
    if (editableSelection.length < 2) return;
    const name = window.prompt("Nom du groupe", "Groupe")?.trim();
    if (!name) return;
    const grouped = createNamedGroup(editableSelection, name);
    const patches = new Map(grouped.map((object) => [object.id, object]));
    commitChange((currentProject) => patchObjects(currentProject, patches));
  }, [editableSelection, commitChange]);

  // Ungrouping releases the *whole* group, not just the members that
  // happen to be selected — a half-dissolved group is not a state the user
  // asked for. Objects on a locked layer keep their membership.
  const handleUngroup = useCallback(() => {
    const groupIds = new Set(
      editableSelection.map((object) => object.groupId).filter((id): id is string => Boolean(id)),
    );
    if (groupIds.size === 0) return;
    commitChange((currentProject) => {
      const grouped = currentProject.objects.filter(
        (object) =>
          object.groupId && groupIds.has(object.groupId) && !lockedLayerIds.has(object.layerId),
      );
      const patches = new Map(clearGroup(grouped).map((object) => [object.id, object]));
      return patchObjects(currentProject, patches);
    });
  }, [editableSelection, lockedLayerIds, commitChange]);

  // The pivot is the *whole* selection's centre, not the editable part's:
  // scaling a group around a moving pivot would shift it sideways as soon
  // as one member happens to be locked.
  const handleTransformSelection = useCallback(
    (scale: number, rotationDeg: number) => {
      if (!selectionBounds || selectedObjects.length < 2 || editableSelection.length === 0) return;
      const pivot = boundsCenterM(selectionBounds);
      const transformed = editableSelection.map((object) =>
        transformObjectAroundPivot(object, pivot, scale, rotationDeg),
      );
      const patches = new Map(transformed.map((object) => [object.id, object]));
      commitChange((currentProject) => patchObjects(currentProject, patches));
    },
    [selectionBounds, selectedObjects.length, editableSelection, commitChange],
  );

  const handleDistributeSelection = useCallback(
    (axis: "x" | "y") => {
      if (editableSelection.length < 3) return;
      const distributed = distributeObjects(editableSelection, axis);
      commitChange((currentProject) =>
        patchObjects(currentProject, new Map(distributed.map((object) => [object.id, object]))),
      );
    },
    [editableSelection, commitChange],
  );

  const handleSaveComponent = useCallback(() => {
    if (selectedObjects.length === 0 || !selectionBounds) return;
    const name = window
      .prompt("Nom du modèle réutilisable", selectedObjects[0]?.groupName ?? "Composant")
      ?.trim();
    if (!name) return;
    const normalized = selectedObjects.map((object) => ({
      ...object,
      xM: object.xM - selectionBounds.minXM,
      yM: object.yM - selectionBounds.minYM,
    }));
    const template = saveComponentTemplate(name, normalized);
    setComponentTemplates((current) => [...current, template]);
  }, [selectedObjects, selectionBounds]);

  const handleInsertComponent = useCallback(
    (template: ComponentTemplate) => {
      if (!effectiveLayerId) return;
      const center = screenToWorld(
        { x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 },
        viewport,
      );
      const copies = duplicateObjects(template.objects, {
        offsetM: center,
        existingLayerIds: new Set(project.layers.map((layer) => layer.id)),
        fallbackLayerId: effectiveLayerId,
      });
      const grouped = createNamedGroup(copies, template.name);
      commitChange((currentProject) => addObjects(currentProject, grouped));
      selectOnly(grouped.map((object) => object.id));
      closeDialog();
    },
    [effectiveLayerId, stageSize, viewport, project.layers, commitChange, closeDialog, selectOnly],
  );

  /**
   * Visibility and lock stay outside the undo stack, like a layer's: they
   * are a way of looking at the plan, not a change to it.
   */
  const handleToggleBackgroundVisible = useCallback(
    (backgroundId: string) => {
      setProjectDirect((currentProject) => {
        const background = currentProject.backgrounds.find(
          (candidate) => candidate.id === backgroundId,
        );
        return background
          ? patchBackground(currentProject, backgroundId, { visible: !background.visible })
          : currentProject;
      });
    },
    [setProjectDirect],
  );

  const handleToggleBackgroundLocked = useCallback(
    (backgroundId: string) => {
      setProjectDirect((currentProject) => {
        const background = currentProject.backgrounds.find(
          (candidate) => candidate.id === backgroundId,
        );
        return background
          ? patchBackground(currentProject, backgroundId, { locked: !background.locked })
          : currentProject;
      });
    },
    [setProjectDirect],
  );

  const handleMoveBackground = useCallback(
    (backgroundId: string, direction: -1 | 1) => {
      commitChange((currentProject) => moveBackground(currentProject, backgroundId, direction));
    },
    [commitChange],
  );

  /**
   * Which entry the next import lands on: `null` adds a new backdrop on
   * top, an id replaces that one's image in place (keeping its placement,
   * opacity and corrections). Carried in a ref because the file dialog is
   * a round trip through the DOM — the intent has to survive it, and it
   * must not cause a render.
   */
  const backgroundImportTargetRef = useRef<string | null>(null);

  const handleRequestBackgroundImport = useCallback((replaceId?: string) => {
    backgroundImportTargetRef.current = replaceId ?? null;
    fileInputRef.current?.click();
  }, []);

  const handleImportBackgroundFile = useCallback(
    (file: File) => {
      const replaceId = backgroundImportTargetRef.current;
      backgroundImportTargetRef.current = null;
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : null;
        if (!url) return;
        const img = new Image();
        img.onload = () => {
          const centerWorld = screenToWorld(
            { x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 },
            viewport,
          );
          let importedId: string | null = null;
          commitChange((currentProject) => {
            const existing = replaceId
              ? currentProject.backgrounds.find((candidate) => candidate.id === replaceId)
              : undefined;
            if (existing) {
              // Replacing keeps where the old image sat and how it was
              // corrected — the point of "replace" is a newer revision of
              // the same plan, already positioned.
              importedId = existing.id;
              const margins = getBackgroundCropMargins(existing);
              return replaceBackground(currentProject, existing.id, {
                ...existing,
                name: file.name || existing.name,
                url,
                widthPx: img.naturalWidth,
                heightPx: img.naturalHeight,
                crop: cropRectFromMargins(img.naturalWidth, img.naturalHeight, margins),
              });
            }
            const placement = computeDefaultBackgroundPlacement(
              img.naturalWidth,
              img.naturalHeight,
              currentProject.calibration.pixelsPerMeter,
              centerWorld,
            );
            const background = createBackgroundImage({
              name: file.name,
              url,
              widthPx: img.naturalWidth,
              heightPx: img.naturalHeight,
              ...placement,
            });
            importedId = background.id;
            return addBackground(currentProject, background);
          });
          if (importedId) selectBackground(importedId);
          setActiveTool("select");
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    },
    [commitChange, stageSize, viewport, selectBackground],
  );

  const handleFileInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) handleImportBackgroundFile(file);
      // Reset so choosing the same file again still fires a change event.
      event.target.value = "";
    },
    [handleImportBackgroundFile],
  );

  const handleObjectImageInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file || !effectiveLayerId) return;
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : null;
        if (!url) return;
        const image = new Image();
        image.onload = () => {
          const widthM = 10;
          const heightM = (widthM * image.naturalHeight) / image.naturalWidth;
          const center = screenToWorld(
            { x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 },
            viewport,
          );
          const object = createImageObject({
            layerId: effectiveLayerId,
            name: file.name.replace(/\.[^.]+$/, "") || "Image",
            url,
            widthPx: image.naturalWidth,
            heightPx: image.naturalHeight,
            widthM,
            heightM,
            xM: center.xM - widthM / 2,
            yM: center.yM - heightM / 2,
            style: { opacity: 1 },
          });
          commitChange((currentProject) => addObject(currentProject, object));
          selectOnly([object.id]);
          setActiveTool("select");
        };
        image.src = url;
      };
      reader.readAsDataURL(file);
    },
    [effectiveLayerId, stageSize, viewport, commitChange, selectOnly],
  );

  // --- Project files -------------------------------------------------------

  /** Swaps in a different document: clears the selection (its ids belong to the old project) and drops the undo stack. */
  const replaceDocument = useCallback(
    (nextProject: Project) => {
      resetHistory(nextProject);
      deselectAll();
      // Cleared rather than remapped: the id belonged to the old document.
      // The render-time guard above picks the new project's default.
      setActiveLayerId(null);
      setCalibrationPoints(null);
      setActiveTool("select");
      setFileError(null);
      onDismissRestoreNotice();
    },
    [resetHistory, onDismissRestoreNotice, deselectAll, setActiveLayerId],
  );

  /**
   * The file this session is working against, once one is known. Only the
   * macOS shell can tell us — a browser download never says where it went
   * — so everywhere else this stays `null` and every save asks.
   */
  const [saveDestination, setSaveDestination] = useState<SaveDestination>(null);

  /**
   * The folder set in "Dossier d'enregistrement" (KL-053). Read once at
   * startup — a directory handle lives in IndexedDB, so it arrives a beat
   * after the first render — and written back whenever the setting changes.
   */
  const [saveFolder, setSaveFolder] = useState<SaveFolder | null>(null);
  useEffect(() => {
    let cancelled = false;
    void loadSaveFolder().then((folder) => {
      if (!cancelled) setSaveFolder(folder);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  const handleSaveFolderChange = useCallback((folder: SaveFolder | null) => {
    void storeSaveFolder(folder).then(setSaveFolder);
  }, []);

  const reportSaveOutcome = useCallback((outcome: Awaited<ReturnType<typeof saveProjectFile>>) => {
    // Cancelling is a decision, not a failure, and says nothing.
    if (outcome.status === "failed") setFileError(`L'enregistrement a échoué : ${outcome.message}`);
    else if (outcome.status === "saved") setSaveDestination(outcome.destination);
  }, []);

  const handleSaveToFile = useCallback(() => {
    void saveProjectFile(project, saveDestination, saveFolder)
      .then(reportSaveOutcome)
      .catch((error: unknown) =>
        setFileError(
          `L'enregistrement a échoué : ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }, [project, saveDestination, saveFolder, reportSaveOutcome]);

  /**
   * "Save as" always asks where the file goes. It also renames the
   * project to match the file, because a project whose name has drifted
   * from its file is a document nobody can find again — and outside the
   * macOS shell the file name is the only trace we are left with.
   */
  const handleSaveToFileAs = useCallback(() => {
    const name = window
      .prompt("Enregistrer sous — nom du projet et du fichier", project.name)
      ?.trim();
    if (!name) return;
    const renamed = { ...project, name, updatedAt: new Date().toISOString() };
    commitChange(() => renamed);
    void saveProjectFileAs(renamed, saveFolder)
      .then(reportSaveOutcome)
      .catch((error: unknown) =>
        setFileError(
          `L'enregistrement a échoué : ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
  }, [project, commitChange, saveFolder, reportSaveOutcome]);

  /**
   * A `.kli` double-clicked in the Finder. The shell reads the file and
   * calls in; from here it is the same path as any other open, refusal
   * of a bad file included.
   */
  useEffect(
    () =>
      onNativeFileOpened(({ path, name, contents }) => {
        const parsed = readProjectText(contents);
        if (!parsed.ok) {
          setFileError(describeParseError(parsed.error));
          return;
        }
        replaceDocument(parsed.file.project);
        setSaveDestination({ kind: "path", path, name });
      }),
    [replaceDocument],
  );

  const handleRequestOpenProject = useCallback(() => {
    void openProjectFileNatively(saveFolder)
      .then((opened) => {
        // No bridge: fall back to the hidden file input, which is what
        // every browser has.
        if (opened === null) {
          projectFileInputRef.current?.click();
          return;
        }
        if ("cancelled" in opened) return;
        if (!opened.result.ok) {
          setFileError(describeParseError(opened.result.error));
          return;
        }
        replaceDocument(opened.result.file.project);
        setSaveDestination(opened.destination);
      })
      .catch(() => projectFileInputRef.current?.click());
  }, [replaceDocument, saveFolder]);

  const handleProjectFileInputChange = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      event.target.value = "";
      if (!file) return;
      const result = await readProjectFile(file);
      if (!result.ok) {
        // Refusing loudly and keeping the current project is the point:
        // the user still has their work and still has the file.
        setFileError(describeParseError(result.error));
        return;
      }
      replaceDocument(result.file.project);
      // A browser gives us the bytes, never the path: the next plain save
      // has to ask again rather than guess.
      setSaveDestination(null);
    },
    [replaceDocument],
  );

  const handleNewProject = useCallback(() => {
    const confirmed = window.confirm(
      "Démarrer un nouveau projet ? Le projet en cours sera remplacé. Enregistrez-le dans un fichier d'abord si vous souhaitez le conserver.",
    );
    if (!confirmed) return;
    // No need to clear the stored project first: the new one becomes the
    // working document and the autosave overwrites it a moment later.
    // Deleting *and* writing would be two concurrent IndexedDB operations
    // racing over one record, and losing that race would wipe the project
    // the user just started.
    replaceDocument(createEmptyProject({ name: "Nouveau projet" }));
    setSaveDestination(null);
  }, [replaceDocument]);

  const handleRenameProject = useCallback(
    (requestedName?: string) => {
      const name = (requestedName ?? window.prompt("Nom du projet", project.name))?.trim();
      if (!name || name === project.name) return;
      commitChange((current) => ({ ...current, name, updatedAt: new Date().toISOString() }));
    },
    [project.name, commitChange],
  );

  /**
   * The stands written inside a marquee. The object is held in state
   * rather than read back from the selection when the dialog confirms:
   * the plan can change under an open dialog, and the grid has to be
   * measured against the rectangle the user was looking at.
   */
  const [editingStands, setEditingStands] = useState<RectangleObject | null>(null);

  const handleRequestStands = useCallback(() => {
    if (selectedObject?.type === "rectangle" && !selectedObject.electrical)
      setEditingStands(selectedObject);
  }, [selectedObject]);

  const handleConfirmStands = useCallback(
    (stands: StandGrid) => {
      if (!editingStands) return;
      const id = editingStands.id;
      setEditingStands(null);
      commitChange((current) => patchObject(current, id, { stands }));
    },
    [editingStands, commitChange],
  );

  const handleRemoveStands = useCallback(() => {
    if (!editingStands) return;
    const id = editingStands.id;
    setEditingStands(null);
    commitChange((current) => patchObject(current, id, { stands: undefined }));
  }, [editingStands, commitChange]);

  // --- Commands ------------------------------------------------------------

  const [pinnedCommands, setPinnedCommands] = useState<CommandId[]>(() => loadPinnedCommands());

  /**
   * One place where a command id becomes an action. The left-hand menus,
   * the pinned toolbar buttons and (later) any other entry point all go
   * through here, so an action can never behave differently depending on
   * where it was invoked from.
   */
  const runCommand = useCallback(
    (id: CommandId) => {
      switch (id) {
        case "newProject":
          return handleNewProject();
        case "openProject":
          return handleRequestOpenProject();
        case "recentProjects":
          return setOpenDialog("projects");
        case "saveFile":
          return handleSaveToFile();
        case "saveFileAs":
          return handleSaveToFileAs();
        case "saveFolder":
          return setOpenDialog("saveFolder");
        case "export":
          return setOpenDialog("export");
        case "library":
          return setOpenDialog("library");
        case "importObjectImage":
          return objectImageInputRef.current?.click();
        case "schedule":
          return setOpenDialog("schedule");
        case "electrical":
          return setOpenDialog("electrical");
        case "exchange":
          return setOpenDialog("exchange");
        case "comments":
          return setOpenDialog("comments");
        case "shortcuts":
          return setOpenDialog("shortcuts");
        case "customizeToolbar":
          return setOpenDialog("customizeToolbar");
        case "diagnostic":
          return downloadDiagnosticReport(project);
      }
    },
    [project, handleNewProject, handleRequestOpenProject, handleSaveToFile, handleSaveToFileAs],
  );

  // --- Material library ----------------------------------------------------

  /** Drops a catalogue item at the centre of the current view, carrying its reference and unit so it shows up in the schedule. */
  const handleInsertCatalogItem = useCallback(
    (item: CatalogItem) => {
      if (!effectiveLayerId) return;
      const center = screenToWorld(
        { x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 },
        viewport,
      );
      const common = {
        layerId: effectiveLayerId,
        name: item.name,
        // No `label`: that legacy field overrides the display settings
        // wholesale, so a catalogue item carrying one would silently ignore
        // the plan's label choices. The name is already `item.name`.
        catalogId: item.id,
        category: item.category,
        reference: item.reference,
        quantity: 1,
        unit: item.unit,
        xM: center.xM,
        yM: center.yM,
        style: item.style,
        ...(item.electrical ? { electrical: item.electrical } : {}),
      };
      const object =
        item.shape === "circle"
          ? createCircleObject({ ...common, radiusM: item.radiusM ?? 0.5 })
          : item.shape === "line"
            ? createLineObject({
                ...common,
                pointsM: item.pointsM ?? [
                  { xM: 0, yM: 0 },
                  { xM: 1, yM: 0 },
                ],
              })
            : item.shape === "polygon"
              ? createPolygonObject({
                  ...common,
                  pointsM: item.pointsM ?? [
                    { xM: 0, yM: 0 },
                    { xM: 1, yM: 0 },
                    { xM: 0, yM: 1 },
                  ],
                })
              : createRectangleObject({
                  ...common,
                  widthM: item.widthM ?? 1,
                  heightM: item.heightM ?? 1,
                });
      commitChange((currentProject) => addObject(currentProject, object));
      selectOnly([object.id]);
      setActiveTool("select");
      closeDialog();
    },
    [effectiveLayerId, stageSize, viewport, commitChange, closeDialog, selectOnly],
  );

  return (
    <div
      className="app-layout"
      style={
        {
          "--tools-width": `${railSizes.toolsWidthPx}px`,
          "--properties-width": `${railSizes.propertiesWidthPx}px`,
        } as CSSProperties
      }
    >
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg"
        className="visually-hidden"
        onChange={handleFileInputChange}
      />
      <input
        ref={projectFileInputRef}
        type="file"
        accept=".kli,.kl.json,.json,application/json"
        className="visually-hidden"
        onChange={handleProjectFileInputChange}
      />
      <input
        ref={objectImageInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="visually-hidden"
        onChange={handleObjectImageInputChange}
      />
      <Toolbar
        projectName={project.name}
        savedFile={describeSaveDestination(saveDestination)}
        onRenameProject={handleRenameProject}
        zoom={viewport.zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        saveStatus={saveStatus}
        onFitPlan={() => navigationBounds && fitBounds(navigationBounds)}
        canFitPlan={navigationBounds !== null}
        pinnedIds={pinnedCommands}
        onRunCommand={runCommand}
      />
      {(restoreNotice || fileError) && (
        <div className="app-notice" role="status">
          <span>{fileError ?? restoreNotice}</span>
          <button
            type="button"
            className="app-notice__dismiss"
            onClick={() => (fileError ? setFileError(null) : onDismissRestoreNotice())}
            title="Fermer"
          >
            ✕
          </button>
        </div>
      )}
      <div className="side-rail">
        <CommandMenu
          group="file"
          onRun={runCommand}
          pinnedIds={pinnedCommands}
          collapsed={isCollapsed("file")}
          onToggleCollapsed={() => toggleCollapsed("file")}
        />
        <CommandMenu
          group="project"
          onRun={runCommand}
          pinnedIds={pinnedCommands}
          collapsed={isCollapsed("project")}
          onToggleCollapsed={() => toggleCollapsed("project")}
        />
        <ToolsPanel
          activeToolId={activeTool}
          onSelectTool={handleSelectTool}
          symbolCharacter={symbolCharacter}
          onSymbolCharacterChange={setSymbolCharacter}
          snapEnabled={snapEnabled}
          onSnapEnabledChange={setSnapEnabled}
          gridVisible={gridVisible}
          onGridVisibleChange={setGridVisible}
          gridLimited={hasVisibleBackground ? true : gridLimited}
          onGridLimitedChange={setGridLimited}
          gridLimitForced={hasVisibleBackground}
          labelDisplay={labelDisplay}
          onLabelDisplayChange={handleLabelDisplayChange}
          collapsed={isCollapsed("tools")}
          onToggleCollapsed={() => toggleCollapsed("tools")}
        />
        <ElectricalPanel
          activeToolId={activeTool}
          onSelectTool={handleSelectTool}
          network={electricalNetwork}
          onOpenDiagram={() => setOpenDialog("electrical")}
          labelDisplay={labelDisplay}
          onLabelDisplayChange={handleLabelDisplayChange}
          collapsed={isCollapsed("electrical")}
          onToggleCollapsed={() => toggleCollapsed("electrical")}
        />
        <div
          className="rail-resizer rail-resizer--tools"
          role="separator"
          aria-orientation="vertical"
          aria-label="Largeur des menus"
          onPointerDown={(event) => startWidthDrag("toolsWidthPx", event)}
        />
      </div>
      <PlanCanvas
        containerRef={containerRef}
        stageSize={stageSize}
        viewport={viewport}
        onZoomAt={zoomAt}
        onPan={pan}
        objects={orderedObjects}
        layers={project.layers}
        backgrounds={project.backgrounds}
        activeTool={activeTool}
        symbolCharacter={symbolCharacter}
        snapEnabled={snapEnabled}
        labelDisplay={labelDisplay}
        gridVisible={gridVisible}
        gridLimited={hasVisibleBackground ? true : gridLimited}
        selectedIds={selectedIds}
        selectedBackgroundId={selectedBackgroundId}
        onSelectObject={selectObject}
        onSelectMany={selectMany}
        onSelectBackground={selectBackground}
        onDeselectAll={deselectAll}
        onCreateObject={handleCreateObject}
        onBeginObjectEdit={handleBeginObjectEdit}
        onBeginObjectDrag={handleBeginObjectDrag}
        onObjectLiveUpdate={handleObjectLiveUpdate}
        onObjectCommitUpdate={handleObjectCommitUpdate}
        onObjectMoveLive={handleObjectMoveLive}
        onBackgroundMoveLive={handleBackgroundMoveLive}
        onBackgroundResizeLive={handleBackgroundResizeLive}
        onCalibrationMeasured={handleCalibrationMeasured}
        onCancelCalibration={handleCancelCalibration}
      />
      <div
        className="inspector-rail"
        ref={inspectorRailRef}
        style={{ "--properties-percent": `${railSizes.propertiesPercent}%` } as CSSProperties}
      >
        <div
          className="rail-resizer rail-resizer--properties"
          role="separator"
          aria-orientation="vertical"
          aria-label="Largeur de l'inspecteur"
          onPointerDown={(event) => startWidthDrag("propertiesWidthPx", event)}
        />
        <PropertiesPanel
          selected={selectedBackgroundId ? null : selectedObject}
          selectionCount={selectedBackgroundId ? 0 : selectedObjects.length}
          selectionBounds={selectionBounds}
          layers={project.layers}
          selectionLayerId={
            selectedObjects.length > 0 &&
            selectedObjects.every((object) => object.layerId === selectedObjects[0]?.layerId)
              ? (selectedObjects[0]?.layerId ?? null)
              : null
          }
          onAssignLayer={(layerId) => assignObjectsToLayerAction(selectedIds, layerId)}
          selectedBackground={selectedBackground}
          calibration={project.calibration}
          isLocked={selectedBackgroundId ? isBackgroundLocked : isSelectedLocked}
          labelDisplay={labelDisplay}
          onBeginEdit={handleBeginObjectEdit}
          onLiveUpdate={(patch) =>
            selectedObject && handleObjectLiveUpdate(selectedObject.id, patch)
          }
          onBackgroundLiveUpdate={handleBackgroundLiveUpdate}
          onDelete={handleDeleteSelected}
          onDuplicate={duplicate}
          onRequestReplaceBackground={() =>
            selectedBackgroundId && handleRequestBackgroundImport(selectedBackgroundId)
          }
          onRequestCalibration={handleRequestCalibration}
          onRequestScaleCalibration={() => setOpenDialog("scaleCalibration")}
          onCreateGroup={handleCreateGroup}
          onUngroup={handleUngroup}
          onTransformSelection={handleTransformSelection}
          onDistributeSelection={handleDistributeSelection}
          onSaveComponent={handleSaveComponent}
          onEditStands={handleRequestStands}
          objects={project.objects}
          electricalNetwork={electricalNetwork}
          collapsed={isCollapsed("properties")}
          onToggleCollapsed={() => toggleCollapsed("properties")}
        />
        <div
          className="inspector-resizer"
          role="separator"
          aria-orientation="horizontal"
          aria-label="Hauteur des propriétés"
          onPointerDown={startInspectorDrag}
        />
        <ElementsPanel
          layers={project.layers}
          objects={orderedObjects}
          selectedIds={selectedIds}
          onSelectObject={selectObject}
          collapsed={isCollapsed("elements")}
          onToggleCollapsed={() => toggleCollapsed("elements")}
        />
      </div>
      {calibrationPoints && (
        <CalibrationDialog
          measuredDistanceM={Math.hypot(
            calibrationPoints.pointB.xM - calibrationPoints.pointA.xM,
            calibrationPoints.pointB.yM - calibrationPoints.pointA.yM,
          )}
          onConfirm={handleConfirmCalibration}
          onCancel={handleCancelCalibration}
        />
      )}
      {openDialog === "scaleCalibration" && (
        <ScaleCalibrationDialog
          onConfirm={handleConfirmScaleCalibration}
          onCancel={() => closeDialog()}
        />
      )}
      {editingStands && (
        <StandsDialog
          object={editingStands}
          onConfirm={handleConfirmStands}
          onRemove={handleRemoveStands}
          onCancel={() => setEditingStands(null)}
        />
      )}
      {layerPrompt?.kind === "delete" && (
        <DeleteLayerDialog
          layer={layerPrompt.layer}
          destinations={layerPrompt.destinations}
          objectCount={layerPrompt.objectCount}
          onConfirm={confirmDeleteLayer}
          onCancel={cancelLayerPrompt}
        />
      )}
      {layerPrompt?.kind === "style" && (
        <LayerStyleDialog
          layer={layerPrompt.layer}
          onConfirm={confirmLayerStyle}
          onCancel={cancelLayerPrompt}
        />
      )}
      <LayersPanel
        backgrounds={project.backgrounds}
        selectedBackgroundId={selectedBackgroundId}
        layers={project.layers}
        objects={project.objects}
        objectCounts={objectCounts}
        activeLayerId={effectiveLayerId}
        onSetActiveLayer={setActiveLayerId}
        onSelectObject={(id) => selectObject(id, false)}
        onToggleVisible={toggleLayerVisible}
        onToggleLocked={toggleLayerLocked}
        onRenameLayer={renameLayerAction}
        onMoveLayer={moveLayerAction}
        onDeleteLayer={requestDeleteLayer}
        onAddLayer={addLayerAction}
        onSelectBackground={selectBackground}
        onToggleBackgroundVisible={handleToggleBackgroundVisible}
        onToggleBackgroundLocked={handleToggleBackgroundLocked}
        onMoveBackground={handleMoveBackground}
        onRequestImportBackground={() => handleRequestBackgroundImport()}
        onAssignObjectToLayer={(objectId, layerId) => {
          assignObjectsToLayerAction([objectId], layerId);
          selectOnly([objectId]);
        }}
        onSetLayerFolder={setLayerFolder}
        onSetLayerDefaultStyle={requestLayerStyle}
      />
      {openDialog === "export" && (
        <ExportDialog
          sheet={sheet}
          sheets={availableSheets}
          onSelectSheet={setActiveSheetId}
          onAddSheet={addSheet}
          onDuplicateSheet={duplicateSheet}
          onDeleteSheet={deleteSheet}
          preview={
            <SheetPreview
              project={project}
              sheet={sheet}
              layout={sheetLayout}
              objects={orderedObjects}
              layers={project.layers}
              backgrounds={project.backgrounds}
              showGrid={printGrid}
            />
          }
          contentBounds={contentBounds}
          standLegibility={standLegibility}
          busy={pendingExport !== null}
          onChange={changeSheet}
          showGrid={printGrid}
          onShowGridChange={setPrintGrid}
          transparentPng={transparentPng}
          onTransparentPngChange={setTransparentPng}
          enlargeSmallText={enlargeSmallText}
          onEnlargeSmallTextChange={setEnlargeSmallText}
          onExportPdf={() => startExport("pdf")}
          onExportMultiPage={startMultiPageExport}
          onExportPng={() => startExport("png")}
          onClose={() => closeDialog()}
        />
      )}
      {/*
        Each lazily-loaded dialog is behind a boundary of its own: a chunk
        that fails to fetch — a stale build, a dropped connection — must
        not take the editor, and the unsaved plan in it, down with it.
      */}
      <ErrorBoundary
        fallback={(error, retry) => (
          <DialogErrorFallback
            error={error}
            onRetry={retry}
            // Closing has to clear the boundary as well as the dialog:
            // leaving the captured error in place would make the *next*
            // dialog open onto this same message.
            onClose={() => {
              retry();
              closeDialog();
            }}
          />
        )}
      >
        <Suspense
          fallback={
            <div className="dialog-backdrop">
              <div className="dialog" role="status">
                Chargement…
              </div>
            </div>
          }
        >
          {openDialog === "library" && (
            <LibraryDialog
              onInsert={handleInsertCatalogItem}
              templates={componentTemplates}
              onInsertTemplate={handleInsertComponent}
              onDeleteTemplate={(id) => setComponentTemplates(deleteComponentTemplate(id))}
              onClose={() => closeDialog()}
            />
          )}
          {openDialog === "schedule" && (
            <ScheduleDialog
              project={project}
              objects={project.objects}
              onClose={() => closeDialog()}
            />
          )}
          {openDialog === "electrical" && (
            <ElectricalDialog
              project={project}
              network={electricalNetwork}
              onSelectObject={(id) => {
                selectOnly([id]);
                closeDialog();
              }}
              onClose={() => closeDialog()}
            />
          )}
          {openDialog === "projects" && (
            <ProjectsDialog
              currentProject={project}
              onOpen={(nextProject) => {
                replaceDocument(nextProject);
                closeDialog();
              }}
              onClose={() => closeDialog()}
            />
          )}
          {openDialog === "exchange" && (
            <ExchangeDialog
              project={project}
              objects={orderedObjects.filter((object) => visibleLayerIds.has(object.layerId))}
              selection={selectedObjects}
              targetLayerId={effectiveLayerId}
              onImportObjects={(objects) => {
                commitChange((current) => addObjects(current, objects));
                selectOnly(objects.map((object) => object.id));
              }}
              onSetGeoreference={(georeference) =>
                commitChange((current) => ({
                  ...current,
                  georeference,
                  updatedAt: new Date().toISOString(),
                }))
              }
              onClose={() => closeDialog()}
            />
          )}
        </Suspense>
      </ErrorBoundary>
      {openDialog === "customizeToolbar" && (
        <ToolbarCustomizeDialog
          pinnedIds={pinnedCommands}
          onToggle={(id) =>
            setPinnedCommands((current) => savePinnedCommands(togglePinnedCommand(current, id)))
          }
          onReset={() => setPinnedCommands(savePinnedCommands(DEFAULT_PINNED_COMMANDS))}
          onClose={closeDialog}
        />
      )}
      {openDialog === "shortcuts" && (
        <ShortcutsDialog
          shortcuts={shortcuts}
          onChange={(next) => setShortcuts(saveShortcuts(next))}
          onClose={() => closeDialog()}
        />
      )}
      {openDialog === "saveFolder" && (
        <SaveFolderDialog
          folder={saveFolder}
          onChange={handleSaveFolderChange}
          onClose={() => closeDialog()}
        />
      )}
      {openDialog === "comments" && (
        <CommentsDialog
          project={project}
          selectedObjectId={selectedIds.length === 1 ? selectedIds[0] : undefined}
          onChange={(comments) =>
            commitChange((current) => ({
              ...current,
              collaboration: { comments },
              updatedAt: new Date().toISOString(),
            }))
          }
          onClose={() => closeDialog()}
        />
      )}
      {/*
        The print stage is mounted only for the instant it takes to
        rasterise, and kept out of the layout entirely — it is far larger
        than the window (thousands of pixels a side) and must not affect
        what the user sees or reflow anything.
      */}
      {pendingExport && (
        <div className="print-canvas-host" aria-hidden="true">
          <PrintCanvas
            stageRef={printStageRef}
            pixelWidth={printRaster.pixelWidth}
            pixelHeight={printRaster.pixelHeight}
            viewport={printRaster.viewport}
            objects={rasterObjects}
            layers={project.layers}
            backgrounds={project.backgrounds}
            showGrid={printGrid}
            labelDisplay={labelDisplay}
            renderScale={printRaster.effectiveDpi / CSS_PIXELS_PER_INCH}
            effectiveDpi={printRaster.effectiveDpi}
            enlargeSmallText={enlargeSmallText}
            transparentBackground={pendingExport === "png" && transparentPng}
            onReady={handlePrintCanvasReady}
          />
        </div>
      )}
    </div>
  );
}
