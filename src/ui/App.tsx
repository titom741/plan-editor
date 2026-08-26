import { useCallback, useMemo, useState } from "react";
import { getDefaultTargetLayer } from "../domain/layers";
import { nextObjectName } from "../domain/labels";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createRectangleObject,
  createTextObject,
} from "../domain/objects";
import { addObject, createDemoProject, patchObject, removeObject } from "../domain/project";
import type { PlanObjectPatch, Project } from "../domain/types";
import { LayersPanel } from "./components/LayersPanel";
import { PlanCanvas } from "./components/PlanCanvas";
import type { NewObjectSpec } from "./components/PlanCanvas";
import { PropertiesPanel } from "./components/PropertiesPanel";
import { Toolbar } from "./components/Toolbar";
import { ToolsPanel } from "./components/ToolsPanel";
import { useEditorShortcuts } from "./hooks/useEditorShortcuts";
import { useProjectHistory } from "./hooks/useProjectHistory";
import { useViewport } from "./hooks/useViewport";
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

export default function App() {
  const {
    project,
    beginEdit,
    applyLiveEdit,
    commitChange,
    setProjectDirect,
    undo,
    redo,
    canUndo,
    canRedo,
  } = useProjectHistory(createDemoProject());

  const [activeTool, setActiveTool] = useState<ToolId>("select");
  const [selectedObjectId, setSelectedObjectId] = useState<string | null>(null);

  const { viewport, containerRef, stageSize, zoomAt, pan } = useViewport(
    project.calibration.pixelsPerMeter,
  );

  const selectedObject = useMemo(
    () => project.objects.find((object) => object.id === selectedObjectId) ?? null,
    [project.objects, selectedObjectId],
  );
  const selectedLayer = useMemo(
    () => project.layers.find((layer) => layer.id === selectedObject?.layerId),
    [project.layers, selectedObject],
  );
  const isSelectedLocked = selectedLayer?.locked === true;

  const handleSelectTool = useCallback((toolId: ToolId) => {
    setActiveTool(toolId);
    if (toolId !== "select") setSelectedObjectId(null);
  }, []);

  const handleSelectObject = useCallback((id: string | null) => {
    setSelectedObjectId(id);
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

  const handleDeleteSelected = useCallback(() => {
    if (!selectedObjectId || isSelectedLocked) return;
    commitChange((currentProject) => removeObject(currentProject, selectedObjectId));
    setSelectedObjectId(null);
  }, [selectedObjectId, isSelectedLocked, commitChange]);

  const handleDeselect = useCallback(() => setSelectedObjectId(null), []);

  useEditorShortcuts({
    onUndo: undo,
    onRedo: redo,
    onDelete: handleDeleteSelected,
    onDeselect: handleDeselect,
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

  return (
    <div className="app-layout">
      <Toolbar
        projectName={project.name}
        zoom={viewport.zoom}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={undo}
        onRedo={redo}
      />
      <ToolsPanel activeToolId={activeTool} onSelectTool={handleSelectTool} />
      <PlanCanvas
        containerRef={containerRef}
        stageSize={stageSize}
        viewport={viewport}
        onZoomAt={zoomAt}
        onPan={pan}
        objects={project.objects}
        layers={project.layers}
        activeTool={activeTool}
        selectedObjectId={selectedObjectId}
        onSelectObject={handleSelectObject}
        onCreateObject={handleCreateObject}
        onBeginObjectEdit={handleBeginObjectEdit}
        onObjectLiveUpdate={handleObjectLiveUpdate}
      />
      <PropertiesPanel
        selected={selectedObject}
        isLocked={isSelectedLocked}
        onBeginEdit={handleBeginObjectEdit}
        onLiveUpdate={(patch) => selectedObjectId && handleObjectLiveUpdate(selectedObjectId, patch)}
        onDelete={handleDeleteSelected}
      />
      <LayersPanel
        background={project.background}
        layers={project.layers}
        onToggleVisible={handleToggleLayerVisible}
        onToggleLocked={handleToggleLayerLocked}
      />
    </div>
  );
}
