import { useCallback, useMemo, useRef, useState, type ChangeEvent } from "react";
import { computeDefaultBackgroundPlacement, createBackgroundImage, worldDistanceToImagePixels } from "../domain/background";
import { calibrationFromKnownDistance } from "../domain/calibration";
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
import type { BackgroundImage, PlanObjectPatch, PointM, Project } from "../domain/types";
import { DEFAULT_SCREEN_PIXELS_PER_METER, screenToWorld } from "../rendering/viewport";
import { CalibrationDialog } from "./components/CalibrationDialog";
import { LayersPanel } from "./components/LayersPanel";
import { PlanCanvas } from "./components/PlanCanvas";
import type { NewObjectSpec } from "./components/PlanCanvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Toolbar } from "./components/Toolbar";
import { ToolsPanel } from "./components/ToolsPanel";
import { useAutosave } from "./hooks/useAutosave";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useViewport } from "./hooks/useViewport";
import { describeParseError, downloadProjectFile, readProjectFile } from "./projectFileActions";
import type { ToolId } from "./tools";
import "./App.css";

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
  const fileInputRef = useRef<HTMLInputElement>(null);
  const projectFileInputRef = useRef<HTMLInputElement>(null);

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
    </div>
  );
}
