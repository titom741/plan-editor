import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import type Konva from "konva";
import { computeDefaultBackgroundPlacement, createBackgroundImage, worldDistanceToImagePixels } from "../domain/background";
import { getProjectBoundsM } from "../domain/bounds";
import { calibrationFromKnownDistance } from "../domain/calibration";
import { createSheet } from "../domain/sheets";
import { getDefaultTargetLayer } from "../domain/layers";
import { nextObjectName } from "../domain/labels";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createTextObject,
} from "../domain/objects";
import {
  addObject,
  applyCalibration,
  createEmptyProject,
  patchBackground,
  patchObject,
  removeBackground,
  removeObject,
  setBackground,
} from "../domain/project";
import type { BackgroundImage, PlanObjectPatch, PointM, Project, Sheet } from "../domain/types";
import { computePrintRaster, computeSheetLayout } from "../printing/sheetLayout";
import { DEFAULT_SCREEN_PIXELS_PER_METER, screenToWorld } from "../rendering/viewport";
import { CalibrationDialog } from "./components/CalibrationDialog";
import { ExportDialog } from "./components/ExportDialog";
import { LayersPanel } from "./components/LayersPanel";
import { PlanCanvas } from "./components/PlanCanvas";
import type { NewObjectSpec } from "./components/PlanCanvas";
import { PrintCanvas } from "./components/PrintCanvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Toolbar } from "./components/Toolbar";
import { ToolsPanel } from "./components/ToolsPanel";
import { downloadPng, downloadSheetPdf } from "./exportSheet";
import { useAutosave } from "./hooks/useAutosave";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useViewport } from "./hooks/useViewport";
import { describeParseError, downloadProjectFile, readProjectFile } from "./projectFileActions";
import type { ToolId } from "./tools";
import "./App.css";

/** Screen CSS pixels per inch — the reference for turning a print DPI into a stroke/label multiplier. */
const CSS_PIXELS_PER_INCH = 96;

/** Builds the actual `PlanObject` (naming, layer assignment) from a gesture the canvas reports — see `PlanCanvas`'s `NewObjectSpec`. */
function buildObjectFromSpec(project: Project, spec: NewObjectSpec) {
  const layer = getDefaultTargetLayer(project.layers);
  if (!layer) return null;
  const name = nextObjectName(project, spec.type);
  const common = { layerId: layer.id, name, xM: spec.xM, yM: spec.yM };

  switch (spec.type) {
    case "rectangle":
      return createRectangleObject({ ...common, widthM: spec.widthM, heightM: spec.heightM });
    case "circle":
      return createCircleObject({ ...common, radiusM: spec.radiusM });
    case "line":
      return createLineObject({ ...common, pointsM: spec.pointsM });
    case "polygon":
      return createPolygonObject({ ...common, pointsM: spec.pointsM });
    case "text":
      return createTextObject({ ...common, text: "Texte" });
  }
}

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
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);
  const [isBackgroundSelected, setIsBackgroundSelected] = useState(false);
  const [calibrationPoints, setCalibrationPoints] = useState<{ pointA: PointM; pointB: PointM } | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [printGrid, setPrintGrid] = useState(false);
  /** Non-null while the off-screen print stage is mounted and we're waiting for it to be ready to rasterise. */
  const [pendingExport, setPendingExport] = useState<"pdf" | "png" | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);
  const printStageRef = useRef<Konva.Stage>(null);

  const saveStatus = useAutosave(project, autosaveEnabled);

  // A display constant, not the project's calibration — see
  // `DEFAULT_SCREEN_PIXELS_PER_METER`. Calibrating a background corrects
  // the background's real-world size, it doesn't change how big a meter is
  // drawn on screen.
  const { viewport, containerRef, stageSize, zoomAt, pan } = useViewport(DEFAULT_SCREEN_PIXELS_PER_METER);

  const selectedObject = useMemo(
    () => project.objects.find((object) => object.id === selectedObjectId) ?? null,
    [project.objects, selectedObjectId],
  );
  const selectedLayer = useMemo(
    () => project.layers.find((layer) => layer.id === selectedObject?.layerId),
    [project.layers, selectedObject],
  );
  const isSelectedLocked = selectedLayer?.locked === true;
  const isBackgroundLocked = project.background?.locked === true;

  const handleSelectTool = useCallback((toolId: ToolId) => {
    setActiveTool(toolId);
    if (toolId !== "select") {
      setSelectedObjectId(null);
      setIsBackgroundSelected(false);
    }
  }, []);

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
    if (id) setIsBackgroundSelected(false);
  }, []);

  const handleSelectBackground = useCallback(() => {
    setIsBackgroundSelected(true);
    setSelectedObjectId(null);
  }, []);

  const handleDeselectAll = useCallback(() => {
    setSelectedObjectId(null);
    setIsBackgroundSelected(false);
  }, []);

  const handleCreateObject = useCallback(
    (spec: NewObjectSpec) => {
      let createdId: string | null = null;
      commitChange((currentProject) => {
        const object = buildObjectFromSpec(currentProject, spec);
        if (!object) return currentProject;
        createdId = object.id;
        return addObject(currentProject, object);
      });
      if (createdId) setSelectedObjectId(createdId);
      setActiveTool("select");
    },
    [commitChange],
  );

  const handleBeginObjectEdit = useCallback(() => beginEdit(), [beginEdit]);

  const handleObjectLiveUpdate = useCallback(
    (id: string, patch: PlanObjectPatch) => {
      applyLiveEdit((currentProject) => patchObject(currentProject, id, patch));
    },
    [applyLiveEdit],
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
    setSelectedObjectId(null);
    setIsBackgroundSelected(false);
    setCalibrationPoints(null);
    setActiveTool("calibrate");
  }, [project.background, isBackgroundLocked]);

  const handleCalibrationMeasured = useCallback((pointA: PointM, pointB: PointM) => {
    setCalibrationPoints({ pointA, pointB });
  }, []);

  const handleCancelCalibration = useCallback(() => {
    setCalibrationPoints(null);
    setActiveTool("select");
  }, []);

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
      setIsBackgroundSelected(true);
    },
    [calibrationPoints, project.background, commitChange],
  );

  const handleDeleteSelected = useCallback(() => {
    if (isBackgroundSelected) {
      if (isBackgroundLocked) return;
      commitChange((currentProject) => removeBackground(currentProject));
      setIsBackgroundSelected(false);
      return;
    }
    if (!selectedObjectId || isSelectedLocked) return;
    commitChange((currentProject) => removeObject(currentProject, selectedObjectId));
    setSelectedObjectId(null);
  }, [isBackgroundSelected, isBackgroundLocked, selectedObjectId, isSelectedLocked, commitChange]);

  useEditorShortcuts({
    onUndo: undo,
    onRedo: redo,
    onDelete: handleDeleteSelected,
    onDeselect: handleDeselectAll,
  });

  const handleToggleLayerVisible = useCallback(
    (layerId: string) => {
      setProjectDirect((currentProject) => ({
        ...currentProject,
        layers: currentProject.layers.map((layer) =>
          layer.id === layerId ? { ...layer, visible: !layer.visible } : layer,
        ),
        updatedAt: new Date().toISOString(),
      }));
    },
    [setProjectDirect],
  );

  const handleToggleLayerLocked = useCallback(
    (layerId: string) => {
      setProjectDirect((currentProject) => ({
        ...currentProject,
        layers: currentProject.layers.map((layer) =>
          layer.id === layerId ? { ...layer, locked: !layer.locked } : layer,
        ),
        updatedAt: new Date().toISOString(),
      }));
    },
    [setProjectDirect],
  );

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
          setIsBackgroundSelected(true);
          setSelectedObjectId(null);
          setActiveTool("select");
        };
        img.src = url;
      };
      reader.readAsDataURL(file);
    },
    [commitChange, stageSize, viewport],
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

  // --- Project files -------------------------------------------------------

  /** Swaps in a different document: clears the selection (its ids belong to the old project) and drops the undo stack. */
  const replaceDocument = useCallback(
    (nextProject: Project) => {
      resetHistory(nextProject);
      setSelectedObjectId(null);
      setIsBackgroundSelected(false);
      setCalibrationPoints(null);
      setActiveTool("select");
      setFileError(null);
      onDismissRestoreNotice();
    },
    [resetHistory, onDismissRestoreNotice],
  );

  const handleSaveToFile = useCallback(() => {
    downloadProjectFile(project);
  }, [project]);

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

  // --- Export --------------------------------------------------------------

  // The project carries at most one sheet for now; it's created lazily on
  // first export so existing projects don't need migrating, and stored on
  // the project so the chosen paper and scale persist like any other
  // setting rather than resetting every session.
  const sheet = useMemo(() => project.sheets[0] ?? createSheet(), [project.sheets]);
  const contentBounds = useMemo(() => getProjectBoundsM(project), [project]);
  const sheetLayout = useMemo(() => computeSheetLayout(sheet, contentBounds), [sheet, contentBounds]);
  const printRaster = useMemo(() => computePrintRaster(sheetLayout), [sheetLayout]);

  const handleSheetChange = useCallback(
    (patch: Partial<Sheet>) => {
      commitChange((currentProject) => {
        const current = currentProject.sheets[0] ?? createSheet();
        return {
          ...currentProject,
          sheets: [{ ...current, ...patch }, ...currentProject.sheets.slice(1)],
          updatedAt: new Date().toISOString(),
        };
      });
    },
    [commitChange],
  );

  /**
   * Rasterises the off-screen print stage and hands the result to the
   * chosen writer. Called only from `PrintCanvas`'s `onReady`, so the
   * background image is guaranteed to have decoded — capturing earlier
   * would quietly produce a plan with a blank backdrop.
   */
  const handlePrintCanvasReady = useCallback(() => {
    const target = pendingExport;
    const stage = printStageRef.current;
    if (!target || !stage) return;
    // Clear first: whatever happens below, the off-screen stage must come
    // down, or a failure would leave a huge canvas mounted forever.
    setPendingExport(null);
    try {
      if (target === "png") {
        downloadPng(stage.toDataURL({ mimeType: "image/png", pixelRatio: 1 }), project);
        return;
      }
      downloadSheetPdf({
        project,
        sheet,
        layout: sheetLayout,
        drawingJpegDataUrl: stage.toDataURL({ mimeType: "image/jpeg", quality: 0.92, pixelRatio: 1 }),
        pixelWidth: printRaster.pixelWidth,
        pixelHeight: printRaster.pixelHeight,
        now: new Date(),
      });
    } catch (error) {
      setFileError(
        `L'export a échoué : ${error instanceof Error ? error.message : String(error)}. Essayez un format de papier plus petit.`,
      );
    }
  }, [pendingExport, project, sheet, sheetLayout, printRaster]);

  const handleOpenExport = useCallback(() => {
    setIsExportOpen(true);
  }, []);

  return (
    <div className="app-layout">
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
      <Toolbar
        projectName={project.name}
        zoom={viewport.zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
        saveStatus={saveStatus}
        onNewProject={handleNewProject}
        onOpenProject={handleRequestOpenProject}
        onSaveToFile={handleSaveToFile}
        onExport={handleOpenExport}
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
      <ToolsPanel activeToolId={activeTool} onSelectTool={handleSelectTool} />
      <PlanCanvas
        containerRef={containerRef}
        stageSize={stageSize}
        viewport={viewport}
        onZoomAt={zoomAt}
        onPan={pan}
        objects={project.objects}
        layers={project.layers}
        background={project.background}
        activeTool={activeTool}
        selectedObjectId={selectedObjectId}
        isBackgroundSelected={isBackgroundSelected}
        onSelectObject={handleSelectObject}
        onSelectBackground={handleSelectBackground}
        onDeselectAll={handleDeselectAll}
        onCreateObject={handleCreateObject}
        onBeginObjectEdit={handleBeginObjectEdit}
        onObjectLiveUpdate={handleObjectLiveUpdate}
        onBackgroundMoveLive={handleBackgroundMoveLive}
        onBackgroundResizeLive={handleBackgroundResizeLive}
        onCalibrationMeasured={handleCalibrationMeasured}
        onCancelCalibration={handleCancelCalibration}
      />
      <PropertiesPanel
        selected={isBackgroundSelected ? null : selectedObject}
        selectedBackground={isBackgroundSelected ? project.background : null}
        calibration={project.calibration}
        isLocked={isBackgroundSelected ? isBackgroundLocked : isSelectedLocked}
        onBeginEdit={handleBeginObjectEdit}
        onLiveUpdate={(patch) => selectedObjectId && handleObjectLiveUpdate(selectedObjectId, patch)}
        onBackgroundLiveUpdate={handleBackgroundLiveUpdate}
        onDelete={handleDeleteSelected}
        onRequestReplaceBackground={handleRequestBackgroundImport}
        onRequestCalibration={handleRequestCalibration}
      />
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
      <LayersPanel
        background={project.background}
        isBackgroundSelected={isBackgroundSelected}
        layers={project.layers}
        onToggleVisible={handleToggleLayerVisible}
        onToggleLocked={handleToggleLayerLocked}
        onSelectBackground={handleSelectBackground}
        onToggleBackgroundVisible={handleToggleBackgroundVisible}
        onToggleBackgroundLocked={handleToggleBackgroundLocked}
        onRequestImportBackground={handleRequestBackgroundImport}
      />
      {isExportOpen && (
        <ExportDialog
          sheet={sheet}
          contentBounds={contentBounds}
          busy={pendingExport !== null}
          onChange={handleSheetChange}
          showGrid={printGrid}
          onShowGridChange={setPrintGrid}
          onExportPdf={() => setPendingExport("pdf")}
          onExportPng={() => setPendingExport("png")}
          onClose={() => setIsExportOpen(false)}
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
            objects={project.objects}
            layers={project.layers}
            background={project.background}
            showGrid={printGrid}
            renderScale={printRaster.effectiveDpi / CSS_PIXELS_PER_INCH}
            onReady={handlePrintCanvasReady}
          />
        </div>
      )}
    </div>
  );
}
