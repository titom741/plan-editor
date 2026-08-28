import { useCallback, useMemo, useState } from "react";
import { editableObjects, getSelectionBoundsM, isSelectionLocked, toggleSelection } from "../../domain/selection";
import type { BoundsM } from "../../domain/bounds";
import type { Project } from "../../domain/types";

interface UseSelectionOptions {
  project: Project;
  /** Ids of layers the user can currently see — a hidden layer's objects stay out of "select all". */
  visibleLayerIds: ReadonlySet<string>;
  /** Ids of locked layers, which decide what a bulk edit may touch. */
  lockedLayerIds: ReadonlySet<string>;
}

/**
 * What is selected, and everything derived from it.
 *
 * The selection is held as *ids*, never as objects: the objects change on
 * every edit, and a selection of stale copies would quietly resurrect
 * whatever they held. Resolving them against the live project each render
 * also makes a deleted object drop out of the selection for free.
 *
 * The background is selected separately rather than being id number zero,
 * because it isn't a `PlanObject` — it has no layer, no type, and its own
 * property panel.
 */
export function useSelection({ project, visibleLayerIds, lockedLayerIds }: UseSelectionOptions) {
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [isBackgroundSelected, setIsBackgroundSelected] = useState(false);

  const selectedObjects = useMemo(() => {
    const wanted = new Set(selectedIds);
    return project.objects.filter((object) => wanted.has(object.id));
  }, [project.objects, selectedIds]);

  /** The properties panel edits one object at a time; a group gets a summary instead. */
  const selectedObject = selectedObjects.length === 1 ? (selectedObjects[0] ?? null) : null;

  const selectionBounds: BoundsM | null = useMemo(
    () => (selectedObjects.length > 1 ? getSelectionBoundsM(selectedObjects) : null),
    [selectedObjects],
  );

  /** Read-only mode for the properties panel — see `isSelectionLocked` for the rule. */
  const isSelectedLocked = isSelectionLocked(selectedObjects, lockedLayerIds);

  /** The part of the selection a bulk edit is allowed to touch. */
  const editableSelection = useMemo(
    () => editableObjects(selectedObjects, lockedLayerIds),
    [selectedObjects, lockedLayerIds],
  );

  /**
   * Clicking one member of a group selects the whole group — that is what
   * grouping is for. `Shift`+click stays a single-object toggle, so a group
   * can still be picked apart deliberately.
   */
  const selectObject = useCallback(
    (id: string, additive: boolean) => {
      const object = project.objects.find((candidate) => candidate.id === id);
      const groupedIds = object?.groupId
        ? project.objects.filter((candidate) => candidate.groupId === object.groupId).map((candidate) => candidate.id)
        : [id];
      setSelectedIds((current) => (additive ? toggleSelection(current, id) : groupedIds));
      setIsBackgroundSelected(false);
    },
    [project.objects],
  );

  const selectMany = useCallback((ids: string[], additive: boolean) => {
    if (!additive) {
      setSelectedIds(ids);
    } else if (ids.length > 0) {
      setSelectedIds((current) => [...current, ...ids.filter((id) => !current.includes(id))]);
    }
    if (ids.length > 0) setIsBackgroundSelected(false);
  }, []);

  const selectAll = useCallback(() => {
    // Objects on a hidden layer aren't on screen; sweeping them into the
    // selection would mean the next Delete removes things the user can't see.
    setSelectedIds(
      project.objects.filter((object) => visibleLayerIds.has(object.layerId)).map((object) => object.id),
    );
    setIsBackgroundSelected(false);
  }, [project.objects, visibleLayerIds]);

  const selectBackground = useCallback(() => {
    setIsBackgroundSelected(true);
    setSelectedIds([]);
  }, []);

  /** Replaces the selection wholesale — what a paste, an import or a fresh shape wants. */
  const selectOnly = useCallback((ids: readonly string[]) => {
    setSelectedIds([...ids]);
    setIsBackgroundSelected(false);
  }, []);

  const deselectAll = useCallback(() => {
    setSelectedIds([]);
    setIsBackgroundSelected(false);
  }, []);

  return {
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
  };
}
