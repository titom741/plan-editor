import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent } from "react";
import { computeDefaultBackgroundPlacement, createBackgroundImage, cropRectFromMargins, getBackgroundCropMargins, worldDistanceToImagePixels } from "../domain/background";
import { boundsCenterM, getBackgroundBoundsM } from "../domain/bounds";
import { DEFAULT_LABEL_DISPLAY, type LabelDisplay } from "../domain/display";
import { clearGroup, createNamedGroup, distributeObjects, transformObjectAroundPivot } from "../domain/grouping";
import type { CatalogItem } from "../domain/catalog";
import { duplicateObjects } from "../domain/clipboard";
import { calibrationFromKnownDistance, calibrationFromKnownScale } from "../domain/calibration";
import { sortLayersByOrder } from "../domain/layers";
import { nextObjectName } from "../domain/labels";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
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
  setBackground,
} from "../domain/project";
import type { BackgroundImage, ObjectStyle, PlanObjectPatch, PointM, Project } from "../domain/types";
import { DEFAULT_SCREEN_PIXELS_PER_METER, screenToWorld } from "../rendering/viewport";
import { CalibrationDialog } from "./components/CalibrationDialog";
import { DeleteLayerDialog, LayerStyleDialog } from "./components/LayerDialogs";
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
import { ToolsPanel } from "./components/ToolsPanel";
import { ShortcutsDialog } from "./components/ShortcutsDialog";
import { CommentsDialog } from "./components/CommentsDialog";
import { useAutosave } from "./hooks/useAutosave";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useLayerActions } from "./hooks/useLayerActions";
import { useClipboard } from "./hooks/useClipboard";
import { useSelection } from "./hooks/useSelection";
import { CSS_PIXELS_PER_INCH, useSheetExport } from "./hooks/useSheetExport";
import { useViewport } from "./hooks/useViewport";
import { describeParseError, downloadProjectFile, readProjectFile } from "./projectFileActions";
import type { ToolId } from "./tools";
import { downloadDiagnosticReport } from "./diagnosticActions";
import { loadShortcuts, saveShortcuts, type ShortcutMap } from "./shortcuts";
import {
  DEFAULT_PINNED_COMMANDS,
  loadPinnedCommands,
  savePinnedCommands,
  togglePinnedCommand,
  type CommandGroup,
  type CommandId,
} from "./commands";
import { deleteComponentTemplate, loadComponentTemplates, saveComponentTemplate, type ComponentTemplate } from "../persistence/componentStorage";
import "./App.css";

const LibraryDialog = lazy(() => import("./components/LibraryDialog").then((module) => ({ default: module.LibraryDialog })));
const ProjectsDialog = lazy(() => import("./components/ProjectsDialog").then((module) => ({ default: module.ProjectsDialog })));
const ScheduleDialog = lazy(() => import("./components/ScheduleDialog").then((module) => ({ default: module.ScheduleDialog })));
const ExchangeDialog = lazy(() => import("./components/ExchangeDialog").then((module) => ({ default: module.ExchangeDialog })));

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
  const name = nextObjectName(project, spec.type);
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
      return createPolygonObject({ ...common, pointsM: spec.pointsM, measurement: spec.measurement });
    case "text":
      return createTextObject({ ...common, text: "Texte" });
  }
}

/** The modal dialogs the editor can show. Exactly one at a time — see `openDialog`. */
type DialogId =
  | "scaleCalibration"
  | "export"
  | "library"
  | "schedule"
  | "projects"
  | "exchange"
  | "shortcuts"
  | "comments"
  | "customizeToolbar";

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
  /** The layer new objects land on. KL-002 always used the first unlocked layer; KL-006 makes it the user's choice. */
  const [calibrationPoints, setCalibrationPoints] = useState<{ pointA: PointM; pointB: PointM } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  // One state rather than eight booleans: these are all modal, so "which
  // one is open" is a single fact. Eight independent flags could represent
  // two dialogs stacked on top of each other — a state the app has no UI
  // for and never wants to reach.
  const [openDialog, setOpenDialog] = useState<DialogId | null>(null);
  const closeDialog = useCallback(() => setOpenDialog(null), []);
  const [shortcuts, setShortcuts] = useState<ShortcutMap>(() => loadShortcuts());
  const [toolsCollapsed, setToolsCollapsed] = useState(false);
  const [collapsedMenus, setCollapsedMenus] = useState<ReadonlySet<CommandGroup>>(new Set());
  const toggleMenu = useCallback((group: CommandGroup) => {
    setCollapsedMenus((current) => {
      const next = new Set(current);
      if (next.has(group)) next.delete(group);
      else next.add(group);
      return next;
    });
  }, []);
  const [propertiesCollapsed, setPropertiesCollapsed] = useState(false);
  const [elementsCollapsed, setElementsCollapsed] = useState(false);
  const [componentTemplates, setComponentTemplates] = useState<ComponentTemplate[]>(() => loadComponentTemplates());
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
  const navigationBounds = useMemo(
    () => (project.background?.visible ? getBackgroundBoundsM(project.background) : null),
    [project.background],
  );
  const { viewport, containerRef, stageSize, zoomAt, pan, fitBounds } = useViewport(
    DEFAULT_SCREEN_PIXELS_PER_METER,
    navigationBounds,
  );
  const lastAutoFittedBackgroundIdRef = useRef<string | null>(null);
  useEffect(() => {
    const background = project.background;
    if (!background?.visible || stageSize.widthPx <= 0 || stageSize.heightPx <= 0) return;
    if (lastAutoFittedBackgroundIdRef.current === background.id) return;
    lastAutoFittedBackgroundIdRef.current = background.id;
    fitBounds(getBackgroundBoundsM(background));
  }, [project.background, stageSize, fitBounds]);

  /** What labels show across this plan; an object may still override it for itself. */
  const labelDisplay = project.labelDisplay ?? DEFAULT_LABEL_DISPLAY;

  /**
   * A plan-wide label change is a change to the *document* — it decides
   * what the exported sheet says — so it goes through the undo stack like
   * any other edit, not through `setProjectDirect`.
   */
  const handleLabelDisplayChange = useCallback(
    (nextDisplay: LabelDisplay) => {
      commitChange((current) => ({ ...current, labelDisplay: nextDisplay, updatedAt: new Date().toISOString() }));
    },
    [commitChange],
  );

  const objectCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const object of project.objects) counts.set(object.layerId, (counts.get(object.layerId) ?? 0) + 1);
    return counts;
  }, [project.objects]);

  /** Objects in draw order: by their layer's `order`, then by creation order within a layer. */
  const orderedObjects = useMemo(() => {
    const rank = new Map(sortLayersByOrder(project.layers).map((layer, index) => [layer.id, index]));
    return [...project.objects].sort(
      (a, b) => (rank.get(a.layerId) ?? 0) - (rank.get(b.layerId) ?? 0),
    );
  }, [project.objects, project.layers]);

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
    isBackgroundSelected,
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
    changeSheet,
    addSheet,
    duplicateSheet,
    deleteSheet,
    startExport,
    startMultiPageExport,
    handlePrintCanvasReady,
  } = useSheetExport({
    project,
    orderedObjects,
    visibleLayerIds,
    commitChange,
    onError: setFileError,
  });

  const isBackgroundLocked = project.background?.locked === true;

  const handleSelectTool = useCallback((toolId: ToolId) => {
    setActiveTool(toolId);
    if (toolId !== "select") deselectAll();
  }, [deselectAll]);

  // The object is built *before* the state update, not read back out of
  // its updater: React may defer an updater to the next render, and
  // recovering an id from inside one only works while React happens to
  // take its eager path. The paste below was caught doing exactly that in
  // the browser — the copies appeared, but the selection stayed on the
  // originals.
  const handleCreateObject = useCallback(
    (spec: NewObjectSpec) => {
      if (!effectiveLayerId) return;
      const object = buildObjectFromSpec(project, spec, effectiveLayerId);
      if (object) {
        commitChange((currentProject) => addObject(currentProject, object));
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
      applyLiveEdit((currentProject) => patchBackground(currentProject, patch));
    },
    [applyLiveEdit],
  );

  const handleBackgroundMoveLive = useCallback(
    (xM: number, yM: number) => handleBackgroundLiveUpdate({ xM, yM }),
    [handleBackgroundLiveUpdate],
  );

  const handleBackgroundResizeLive = useCallback(
    (widthM: number, heightM: number) => handleBackgroundLiveUpdate({ widthM, heightM }),
    [handleBackgroundLiveUpdate],
  );

  const handleRequestCalibration = useCallback(() => {
    if (!project.background || isBackgroundLocked) return;
    deselectAll();
    setCalibrationPoints(null);
    setActiveTool("calibrate");
  }, [project.background, isBackgroundLocked, deselectAll]);

  const handleCalibrationMeasured = useCallback((pointA: PointM, pointB: PointM) => {
    setCalibrationPoints({ pointA, pointB });
  }, []);

  const handleCancelCalibration = useCallback(() => {
    setCalibrationPoints(null);
    setActiveTool("select");
  }, []);

  const handleConfirmScaleCalibration = useCallback((scale: number, dpi: number) => {
    commitChange((currentProject) => applyCalibration(currentProject, calibrationFromKnownScale(scale, dpi)));
    closeDialog();
    setActiveTool("select");
    selectBackground();
  }, [commitChange, closeDialog, selectBackground]);

  // Turns the two clicked points (in the project's current, possibly
  // still-approximate scale) plus the real distance the user just typed
  // into an actual `Calibration`, and commits it — one undo step covering
  // both the new `calibration` and the background's corrected size, since
  // they're derived together (see `domain/project.ts`'s `applyCalibration`).
  const handleConfirmCalibration = useCallback(
    (realDistanceM: number) => {
      if (!calibrationPoints || !project.background) return;
      const { pointA, pointB } = calibrationPoints;
      const measuredDistanceM = Math.hypot(pointB.xM - pointA.xM, pointB.yM - pointA.yM);
      const pixelDistance = worldDistanceToImagePixels(project.background, measuredDistanceM);
      const calibration = calibrationFromKnownDistance(pixelDistance, realDistanceM);
      commitChange((currentProject) => applyCalibration(currentProject, calibration));
      setCalibrationPoints(null);
      setActiveTool("select");
      selectBackground();
    },
    [calibrationPoints, project.background, commitChange, selectBackground],
  );

  const handleDeleteSelected = useCallback(() => {
    if (isBackgroundSelected) {
      if (isBackgroundLocked) return;
      commitChange((currentProject) => removeBackground(currentProject));
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
  }, [isBackgroundSelected, isBackgroundLocked, selectedObjects, lockedLayerIds, commitChange, deselectAll]);

  const { copy, paste, duplicate } = useClipboard({
    project,
    selectedObjects,
    fallbackLayerId: effectiveLayerId,
    commitChange,
    onPasted: useCallback((ids: readonly string[]) => {
      selectOnly(ids);
      setActiveTool("select");
    }, [selectOnly]),
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
    const groupIds = new Set(editableSelection.map((object) => object.groupId).filter((id): id is string => Boolean(id)));
    if (groupIds.size === 0) return;
    commitChange((currentProject) => {
      const grouped = currentProject.objects.filter(
        (object) => object.groupId && groupIds.has(object.groupId) && !lockedLayerIds.has(object.layerId),
      );
      const patches = new Map(clearGroup(grouped).map((object) => [object.id, object]));
      return patchObjects(currentProject, patches);
    });
  }, [editableSelection, lockedLayerIds, commitChange]);

  // The pivot is the *whole* selection's centre, not the editable part's:
  // scaling a group around a moving pivot would shift it sideways as soon
  // as one member happens to be locked.
  const handleTransformSelection = useCallback((scale: number, rotationDeg: number) => {
    if (!selectionBounds || selectedObjects.length < 2 || editableSelection.length === 0) return;
    const pivot = boundsCenterM(selectionBounds);
    const transformed = editableSelection.map((object) => transformObjectAroundPivot(object, pivot, scale, rotationDeg));
    const patches = new Map(transformed.map((object) => [object.id, object]));
    commitChange((currentProject) => patchObjects(currentProject, patches));
  }, [selectionBounds, selectedObjects.length, editableSelection, commitChange]);

  const handleDistributeSelection = useCallback((axis: "x" | "y") => {
    if (editableSelection.length < 3) return;
    const distributed = distributeObjects(editableSelection, axis);
    commitChange((currentProject) => patchObjects(currentProject, new Map(distributed.map((object) => [object.id, object]))));
  }, [editableSelection, commitChange]);

  const handleSaveComponent = useCallback(() => {
    if (selectedObjects.length === 0 || !selectionBounds) return;
    const name = window.prompt("Nom du modèle réutilisable", selectedObjects[0]?.groupName ?? "Composant")?.trim();
    if (!name) return;
    const normalized = selectedObjects.map((object) => ({ ...object, xM: object.xM - selectionBounds.minXM, yM: object.yM - selectionBounds.minYM }));
    const template = saveComponentTemplate(name, normalized);
    setComponentTemplates((current) => [...current, template]);
  }, [selectedObjects, selectionBounds]);

  const handleInsertComponent = useCallback((template: ComponentTemplate) => {
    if (!effectiveLayerId) return;
    const center = screenToWorld({ x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 }, viewport);
    const copies = duplicateObjects(template.objects, { offsetM: center, existingLayerIds: new Set(project.layers.map((layer) => layer.id)), fallbackLayerId: effectiveLayerId });
    const grouped = createNamedGroup(copies, template.name);
    commitChange((currentProject) => addObjects(currentProject, grouped));
    selectOnly(grouped.map((object) => object.id));
    closeDialog();
  }, [effectiveLayerId, stageSize, viewport, project.layers, commitChange, closeDialog, selectOnly]);

  const handleToggleBackgroundVisible = useCallback(() => {
    setProjectDirect((currentProject) =>
      currentProject.background
        ? {
            ...currentProject,
            background: { ...currentProject.background, visible: !currentProject.background.visible },
            updatedAt: new Date().toISOString(),
          }
        : currentProject,
    );
  }, [setProjectDirect]);

  const handleToggleBackgroundLocked = useCallback(() => {
    setProjectDirect((currentProject) =>
      currentProject.background
        ? {
            ...currentProject,
            background: { ...currentProject.background, locked: !currentProject.background.locked },
            updatedAt: new Date().toISOString(),
          }
        : currentProject,
    );
  }, [setProjectDirect]);

  const handleRequestBackgroundImport = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const handleImportBackgroundFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const url = typeof reader.result === "string" ? reader.result : null;
        if (!url) return;
        const img = new Image();
        img.onload = () => {
          const centerWorld = screenToWorld({ x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 }, viewport);
          commitChange((currentProject) => {
            if (currentProject.background) {
              const margins = getBackgroundCropMargins(currentProject.background);
              return setBackground(currentProject, {
                ...currentProject.background,
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
              url,
              widthPx: img.naturalWidth,
              heightPx: img.naturalHeight,
              ...placement,
            });
            return setBackground(currentProject, background);
          });
          selectBackground();
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

  const handleObjectImageInputChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !effectiveLayerId) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = typeof reader.result === "string" ? reader.result : null; if (!url) return;
      const image = new Image();
      image.onload = () => {
        const widthM = 10; const heightM = widthM * image.naturalHeight / image.naturalWidth;
        const center = screenToWorld({ x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 }, viewport);
        const object = createImageObject({ layerId: effectiveLayerId, name: file.name.replace(/\.[^.]+$/, "") || "Image", url, widthPx: image.naturalWidth, heightPx: image.naturalHeight, widthM, heightM, xM: center.xM - widthM / 2, yM: center.yM - heightM / 2, style: { opacity: 1 } });
        commitChange((currentProject) => addObject(currentProject, object));
        selectOnly([object.id]);
        setActiveTool("select");
      };
      image.src = url;
    };
    reader.readAsDataURL(file);
  }, [effectiveLayerId, stageSize, viewport, commitChange, selectOnly]);

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

  const handleSaveToFile = useCallback(() => {
    downloadProjectFile(project);
  }, [project]);

  /**
   * "Save as" asks for a file name and *renames the project to match*.
   * A browser download can't tell us where the file went, so a project
   * whose name no longer matches its file is the one thing we can avoid:
   * next time, the suggested name is the one the user last chose.
   */
  const handleSaveToFileAs = useCallback(() => {
    const name = window.prompt("Enregistrer sous — nom du projet et du fichier", project.name)?.trim();
    if (!name) return;
    const renamed = { ...project, name, updatedAt: new Date().toISOString() };
    commitChange(() => renamed);
    downloadProjectFile(renamed);
  }, [project, commitChange]);

  const handleRequestOpenProject = useCallback(() => {
    projectFileInputRef.current?.click();
  }, []);

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
  }, [replaceDocument]);

  const handleRenameProject = useCallback(() => {
    const name = window.prompt("Nom du projet", project.name)?.trim();
    if (!name || name === project.name) return;
    commitChange((current) => ({ ...current, name, updatedAt: new Date().toISOString() }));
  }, [project.name, commitChange]);

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
        case "newProject": return handleNewProject();
        case "openProject": return handleRequestOpenProject();
        case "recentProjects": return setOpenDialog("projects");
        case "saveFile": return handleSaveToFile();
        case "saveFileAs": return handleSaveToFileAs();
        case "export": return setOpenDialog("export");
        case "library": return setOpenDialog("library");
        case "importObjectImage": return objectImageInputRef.current?.click();
        case "schedule": return setOpenDialog("schedule");
        case "exchange": return setOpenDialog("exchange");
        case "comments": return setOpenDialog("comments");
        case "shortcuts": return setOpenDialog("shortcuts");
        case "customizeToolbar": return setOpenDialog("customizeToolbar");
        case "diagnostic": return downloadDiagnosticReport(project);
      }
    },
    [project, handleNewProject, handleRequestOpenProject, handleSaveToFile, handleSaveToFileAs],
  );

  // --- Material library ----------------------------------------------------

  /** Drops a catalogue item at the centre of the current view, carrying its reference and unit so it shows up in the schedule. */
  const handleInsertCatalogItem = useCallback((item: CatalogItem) => {
    if (!effectiveLayerId) return;
    const center = screenToWorld({ x: stageSize.widthPx / 2, y: stageSize.heightPx / 2 }, viewport);
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
    };
    const object = item.shape === "circle"
      ? createCircleObject({ ...common, radiusM: item.radiusM ?? 0.5 })
      : item.shape === "line"
        ? createLineObject({ ...common, pointsM: item.pointsM ?? [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }] })
        : item.shape === "polygon"
          ? createPolygonObject({ ...common, pointsM: item.pointsM ?? [{ xM: 0, yM: 0 }, { xM: 1, yM: 0 }, { xM: 0, yM: 1 }] })
          : createRectangleObject({ ...common, widthM: item.widthM ?? 1, heightM: item.heightM ?? 1 });
    commitChange((currentProject) => addObject(currentProject, object));
    selectOnly([object.id]);
    setActiveTool("select");
    closeDialog();
  }, [effectiveLayerId, stageSize, viewport, commitChange, closeDialog, selectOnly]);

  return (
    <div className={`app-layout${toolsCollapsed ? " tools-collapsed" : ""}${propertiesCollapsed ? " properties-collapsed" : ""}`}>
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
        accept=".json,application/json"
        className="visually-hidden"
        onChange={handleProjectFileInputChange}
      />
      <input ref={objectImageInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="visually-hidden" onChange={handleObjectImageInputChange} />
      <Toolbar
        projectName={project.name}
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
      <ToolsPanel
        activeToolId={activeTool}
        onSelectTool={handleSelectTool}
        snapEnabled={snapEnabled}
        onSnapEnabledChange={setSnapEnabled}
        gridVisible={gridVisible}
        onGridVisibleChange={setGridVisible}
        gridLimited={project.background?.visible ? true : gridLimited}
        onGridLimitedChange={setGridLimited}
        gridLimitForced={project.background?.visible === true}
        labelDisplay={labelDisplay}
        onLabelDisplayChange={handleLabelDisplayChange}
        collapsed={toolsCollapsed}
        onToggleCollapsed={() => setToolsCollapsed((value) => !value)}
      />
      {!toolsCollapsed && (
        <>
          <CommandMenu
            group="file"
            onRun={runCommand}
            pinnedIds={pinnedCommands}
            collapsed={collapsedMenus.has("file")}
            onToggleCollapsed={() => toggleMenu("file")}
          />
          <CommandMenu
            group="project"
            onRun={runCommand}
            pinnedIds={pinnedCommands}
            collapsed={collapsedMenus.has("project")}
            onToggleCollapsed={() => toggleMenu("project")}
          />
        </>
      )}
      </div>
      <PlanCanvas
        containerRef={containerRef}
        stageSize={stageSize}
        viewport={viewport}
        onZoomAt={zoomAt}
        onPan={pan}
        objects={orderedObjects}
        layers={project.layers}
        background={project.background}
        activeTool={activeTool}
        snapEnabled={snapEnabled}
        labelDisplay={labelDisplay}
        gridVisible={gridVisible}
        gridLimited={project.background?.visible ? true : gridLimited}
        selectedIds={selectedIds}
        isBackgroundSelected={isBackgroundSelected}
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
        activeLayerLabel={project.layers.find((layer) => layer.id === effectiveLayerId)?.name ?? "Aucun"}
        activeLayerLocked={project.layers.find((layer) => layer.id === effectiveLayerId)?.locked ?? false}
      />
      <div className="inspector-rail">
      <PropertiesPanel
        selected={isBackgroundSelected ? null : selectedObject}
        selectionCount={isBackgroundSelected ? 0 : selectedObjects.length}
        selectionBounds={selectionBounds}
        layers={project.layers}
        selectionLayerId={
          selectedObjects.length > 0 &&
          selectedObjects.every((object) => object.layerId === selectedObjects[0]?.layerId)
            ? (selectedObjects[0]?.layerId ?? null)
            : null
        }
        onAssignLayer={(layerId) => assignObjectsToLayerAction(selectedIds, layerId)}
        selectedBackground={isBackgroundSelected ? project.background : null}
        calibration={project.calibration}
        isLocked={isBackgroundSelected ? isBackgroundLocked : isSelectedLocked}
        labelDisplay={labelDisplay}
        onBeginEdit={handleBeginObjectEdit}
        onLiveUpdate={(patch) => selectedObject && handleObjectLiveUpdate(selectedObject.id, patch)}
        onBackgroundLiveUpdate={handleBackgroundLiveUpdate}
        onDelete={handleDeleteSelected}
        onDuplicate={duplicate}
        onRequestReplaceBackground={handleRequestBackgroundImport}
        onRequestCalibration={handleRequestCalibration}
        onRequestScaleCalibration={() => setOpenDialog("scaleCalibration")}
        onCreateGroup={handleCreateGroup}
        onUngroup={handleUngroup}
        onTransformSelection={handleTransformSelection}
        onDistributeSelection={handleDistributeSelection}
        onSaveComponent={handleSaveComponent}
        collapsed={propertiesCollapsed}
        onToggleCollapsed={() => setPropertiesCollapsed((value) => !value)}
      />
      <ElementsPanel
        layers={project.layers}
        objects={orderedObjects}
        selectedIds={selectedIds}
        onSelectObject={selectObject}
        collapsed={elementsCollapsed}
        onToggleCollapsed={() => setElementsCollapsed((value) => !value)}
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
        background={project.background}
        isBackgroundSelected={isBackgroundSelected}
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
        onRequestImportBackground={handleRequestBackgroundImport}
        onAssignObjectToLayer={(objectId, layerId) => { assignObjectsToLayerAction([objectId], layerId); selectOnly([objectId]); }}
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
          preview={<SheetPreview project={project} sheet={sheet} layout={sheetLayout} objects={orderedObjects} layers={project.layers} background={project.background} showGrid={printGrid} />}
          contentBounds={contentBounds}
          busy={pendingExport !== null}
          onChange={changeSheet}
          showGrid={printGrid}
          onShowGridChange={setPrintGrid}
          transparentPng={transparentPng}
          onTransparentPngChange={setTransparentPng}
          onExportPdf={() => startExport("pdf")}
          onExportMultiPage={startMultiPageExport}
          onExportPng={() => startExport("png")}
          onClose={() => closeDialog()}
        />
      )}
      <Suspense fallback={<div className="dialog-backdrop"><div className="dialog" role="status">Chargement…</div></div>}>
        {openDialog === "library" && <LibraryDialog onInsert={handleInsertCatalogItem} templates={componentTemplates} onInsertTemplate={handleInsertComponent} onDeleteTemplate={(id) => setComponentTemplates(deleteComponentTemplate(id))} onClose={() => closeDialog()} />}
        {openDialog === "schedule" && <ScheduleDialog project={project} objects={project.objects} onClose={() => closeDialog()} />}
        {openDialog === "projects" && <ProjectsDialog currentProject={project} onOpen={(nextProject) => { replaceDocument(nextProject); closeDialog(); }} onClose={() => closeDialog()} />}
        {openDialog === "exchange" && <ExchangeDialog project={project} objects={orderedObjects.filter((object) => visibleLayerIds.has(object.layerId))} selection={selectedObjects} targetLayerId={effectiveLayerId} onImportObjects={(objects) => { commitChange((current) => addObjects(current, objects)); selectOnly(objects.map((object) => object.id)); }} onSetGeoreference={(georeference) => commitChange((current) => ({ ...current, georeference, updatedAt: new Date().toISOString() }))} onClose={() => closeDialog()} />}
      </Suspense>
      {openDialog === "customizeToolbar" && (
        <ToolbarCustomizeDialog
          pinnedIds={pinnedCommands}
          onToggle={(id) => setPinnedCommands((current) => savePinnedCommands(togglePinnedCommand(current, id)))}
          onReset={() => setPinnedCommands(savePinnedCommands(DEFAULT_PINNED_COMMANDS))}
          onClose={closeDialog}
        />
      )}
      {openDialog === "shortcuts" && <ShortcutsDialog shortcuts={shortcuts} onChange={(next) => setShortcuts(saveShortcuts(next))} onClose={() => closeDialog()} />}
      {openDialog === "comments" && <CommentsDialog project={project} selectedObjectId={selectedIds.length === 1 ? selectedIds[0] : undefined} onChange={(comments) => commitChange((current) => ({ ...current, collaboration: { comments }, updatedAt: new Date().toISOString() }))} onClose={() => closeDialog()} />}
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
            background={project.background}
            showGrid={printGrid}
            labelDisplay={labelDisplay}
            renderScale={printRaster.effectiveDpi / CSS_PIXELS_PER_INCH}
            transparentBackground={pendingExport === "png" && transparentPng}
            onReady={handlePrintCanvasReady}
          />
        </div>
      )}
    </div>
  );
}
