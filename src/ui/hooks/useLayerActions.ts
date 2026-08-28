import { useCallback, useState } from "react";
import { getDefaultTargetLayer } from "../../domain/layers";
import {
  addLayer,
  assignObjectsToLayer,
  moveLayer,
  patchLayer,
  removeLayer,
  renameLayer,
} from "../../domain/project";
import type { Layer, ObjectStyle, Project } from "../../domain/types";

interface UseLayerActionsOptions {
  project: Project;
  /** Undoable document edits. */
  commitChange: (updater: (project: Project) => Project) => void;
  /** Non-undoable edits, for changes that are a way of *looking* at the plan. */
  setProjectDirect: (updater: (project: Project) => Project) => void;
}

/** A layer operation waiting on the user's answer in a dialog. */
export type LayerPrompt =
  | { kind: "delete"; layer: Layer; destinations: Layer[]; objectCount: number }
  | { kind: "style"; layer: Layer };

/**
 * Creating, renaming, reordering, deleting and retargeting layers, plus
 * which layer new objects land on.
 *
 * Two rules are worth keeping in view here. Visibility and lock stay
 * *outside* the undo stack — they are a way of looking at the plan, not a
 * change to it (unchanged since KL-002) — while everything else goes
 * through it. And the active layer is validated during render rather than
 * in an effect, so opening another document or deleting the active layer
 * can never leave new objects pointing at a layer that no longer exists.
 */
export function useLayerActions({ project, commitChange, setProjectDirect }: UseLayerActionsOptions) {
  const [activeLayerId, setActiveLayerId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<LayerPrompt | null>(null);

  // Adjusted during render rather than in an effect — the same pattern
  // `NumberField` and `PlanCanvas` already use for "derive state from
  // changed props".
  const activeLayerIsValid = activeLayerId !== null && project.layers.some((layer) => layer.id === activeLayerId);
  if (!activeLayerIsValid) {
    const fallback = getDefaultTargetLayer(project.layers);
    if (fallback && fallback.id !== activeLayerId) setActiveLayerId(fallback.id);
  }
  /** The layer new objects go on. Never points at a layer that isn't in the project. */
  const effectiveLayerId = activeLayerIsValid ? activeLayerId : (getDefaultTargetLayer(project.layers)?.id ?? null);

  const toggleVisible = useCallback(
    (layerId: string) => {
      setProjectDirect((current) => {
        const layer = current.layers.find((candidate) => candidate.id === layerId);
        return layer ? patchLayer(current, layerId, { visible: !layer.visible }) : current;
      });
    },
    [setProjectDirect],
  );

  const toggleLocked = useCallback(
    (layerId: string) => {
      setProjectDirect((current) => {
        const layer = current.layers.find((candidate) => candidate.id === layerId);
        return layer ? patchLayer(current, layerId, { locked: !layer.locked }) : current;
      });
    },
    [setProjectDirect],
  );

  const add = useCallback(() => {
    const { project: nextProject, layer } = addLayer(project);
    commitChange(() => nextProject);
    setActiveLayerId(layer.id);
  }, [project, commitChange]);

  const rename = useCallback(
    (layerId: string, name: string) => commitChange((current) => renameLayer(current, layerId, name)),
    [commitChange],
  );

  const move = useCallback(
    (layerId: string, direction: -1 | 1) => commitChange((current) => moveLayer(current, layerId, direction)),
    [commitChange],
  );

  /**
   * An empty layer goes straight away; a populated one asks first, because
   * where its objects end up is the user's decision and not one to infer.
   */
  const requestDelete = useCallback(
    (layerId: string) => {
      const layer = project.layers.find((candidate) => candidate.id === layerId);
      if (!layer || project.layers.length <= 1) return;
      const objectCount = project.objects.filter((object) => object.layerId === layerId).length;
      if (objectCount === 0) {
        commitChange((current) => removeLayer(current, layerId));
        return;
      }
      setPrompt({
        kind: "delete",
        layer,
        destinations: project.layers.filter((candidate) => candidate.id !== layerId),
        objectCount,
      });
    },
    [project.layers, project.objects, commitChange],
  );

  const confirmDelete = useCallback(
    (choice: { destinationLayerId: string } | { deleteObjects: true }) => {
      if (prompt?.kind !== "delete") return;
      const layerId = prompt.layer.id;
      commitChange((current) => removeLayer(current, layerId, choice));
      setPrompt(null);
    },
    [prompt, commitChange],
  );

  const requestStyle = useCallback(
    (layerId: string) => {
      const layer = project.layers.find((candidate) => candidate.id === layerId);
      if (layer) setPrompt({ kind: "style", layer });
    },
    [project.layers],
  );

  const confirmStyle = useCallback(
    (defaultStyle: ObjectStyle) => {
      if (prompt?.kind !== "style") return;
      const layerId = prompt.layer.id;
      commitChange((current) => patchLayer(current, layerId, { defaultStyle }));
      setPrompt(null);
    },
    [prompt, commitChange],
  );

  const setFolder = useCallback(
    (layerId: string) => {
      const layer = project.layers.find((candidate) => candidate.id === layerId);
      if (!layer) return;
      const folder = window.prompt("Nom du dossier de calques (vide pour retirer)", layer.folder ?? "") ?? layer.folder;
      if (folder === layer.folder) return;
      commitChange((current) => patchLayer(current, layerId, { folder: folder?.trim() || undefined }));
    },
    [project.layers, commitChange],
  );

  const assignObjects = useCallback(
    (objectIds: readonly string[], layerId: string) => {
      if (objectIds.length === 0) return;
      commitChange((current) => assignObjectsToLayer(current, [...objectIds], layerId));
    },
    [commitChange],
  );

  const cancelPrompt = useCallback(() => setPrompt(null), []);

  return {
    activeLayerId: effectiveLayerId,
    setActiveLayerId,
    prompt,
    cancelPrompt,
    toggleVisible,
    toggleLocked,
    add,
    rename,
    move,
    requestDelete,
    confirmDelete,
    requestStyle,
    confirmStyle,
    setFolder,
    assignObjects,
  };
}
