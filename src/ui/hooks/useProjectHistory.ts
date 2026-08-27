import { useCallback, useState } from "react";
import type { Project } from "../../domain/types";
import {
  createHistory,
  pushHistory,
  redo as redoHistory,
  replacePresent,
  undo as undoHistory,
} from "../../history/historyStack";
import type { HistoryState } from "../../history/historyStack";

/**
 * Binds the generic undo/redo stack (`history/historyStack.ts`) to a
 * `Project`. Exposes three ways to change the project, matching the three
 * kinds of edit the editor makes:
 *
 * - `commitChange` — an atomic, one-shot edit (create an object, delete an
 *   object): snapshot + apply in a single undo step.
 * - `beginEdit` + `applyLiveEdit` — a gesture that updates continuously
 *   (dragging, resizing, rotating, typing in a property field): call
 *   `beginEdit()` once when the gesture starts to snapshot the "before"
 *   state, then `applyLiveEdit` as many times as needed without adding
 *   further undo steps, so a whole drag collapses into one undo entry
 *   instead of one per animation frame.
 * - `setProjectDirect` — changes that should not be undoable at all (e.g.
 *   toggling a layer's visibility).
 */
export function useProjectHistory(initialProject: Project) {
  const [state, setState] = useState<HistoryState<Project>>(() => createHistory(initialProject));

  const beginEdit = useCallback(() => {
    setState((current) => pushHistory(current, current.present));
  }, []);

  const applyLiveEdit = useCallback((updater: (project: Project) => Project) => {
    setState((current) => replacePresent(current, updater(current.present)));
  }, []);

  const commitChange = useCallback((updater: (project: Project) => Project) => {
    setState((current) => pushHistory(current, updater(current.present)));
  }, []);

  // Same mechanics as applyLiveEdit — replace present, no history entry —
  // but kept as a distinct name so call sites document *why* they're
  // bypassing history (not mid-gesture, just genuinely not undoable).
  const setProjectDirect = applyLiveEdit;

  // Replaces the project wholesale and *discards* the undo stack: used
  // when the project stops being the same document (opening a file,
  // starting a new project). Keeping the old past would let Ctrl+Z walk
  // backwards out of the file the user just opened and into the previous
  // one — an edit history that spans two documents isn't a history, it's
  // a trap.
  const resetHistory = useCallback((nextProject: Project) => {
    setState(createHistory(nextProject));
  }, []);

  const undo = useCallback(() => setState((current) => undoHistory(current)), []);
  const redo = useCallback(() => setState((current) => redoHistory(current)), []);

  return {
    project: state.present,
    beginEdit,
    applyLiveEdit,
    commitChange,
    setProjectDirect,
    resetHistory,
    undo,
    redo,
    canUndo: state.past.length > 0,
    canRedo: state.future.length > 0,
  };
}
