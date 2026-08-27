import { useEffect } from "react";

interface EditorShortcutsHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onDeselect: () => void;
  onSelectAll: () => void;
  /** Arrow keys: move the selection by this much, in metres. */
  onNudge: (deltaXM: number, deltaYM: number) => void;
  onCopy: () => void;
  onPaste: () => void;
  onDuplicate: () => void;
}

/** How far one arrow-key press moves the selection, in metres. */
export const NUDGE_STEP_M = 0.1;
/** How far it moves with Shift held — a coarse step for getting somewhere, against the fine one for landing on it. */
export const NUDGE_LARGE_STEP_M = 1;

const ARROW_DIRECTIONS: Record<string, { x: number; y: number }> = {
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
};

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Global keyboard shortcuts for the editor: undo/redo, delete, deselect,
 * select-all, arrow-key nudging, and copy/paste/duplicate. Skips them all
 * while focus is inside a text input so, for example, Ctrl+Z inside the
 * "Nom" field does the browser's native text-undo instead of hijacking the
 * editor's undo stack — and so an arrow key moves the caret rather than
 * the plan.
 */
export function useEditorShortcuts({
  onUndo,
  onRedo,
  onDelete,
  onDeselect,
  onSelectAll,
  onNudge,
  onCopy,
  onPaste,
  onDuplicate,
}: EditorShortcutsHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const isModifier = event.metaKey || event.ctrlKey;
      if (isModifier) {
        const key = event.key.toLowerCase();
        if (key === "z") {
          event.preventDefault();
          if (event.shiftKey) onRedo();
          else onUndo();
          return;
        }
        if (key === "y") {
          event.preventDefault();
          onRedo();
          return;
        }
        if (key === "a") {
          event.preventDefault();
          onSelectAll();
          return;
        }
        if (key === "c") {
          event.preventDefault();
          onCopy();
          return;
        }
        if (key === "v") {
          event.preventDefault();
          onPaste();
          return;
        }
        if (key === "d") {
          event.preventDefault();
          onDuplicate();
          return;
        }
        return;
      }

      const direction = ARROW_DIRECTIONS[event.key];
      if (direction) {
        // Without this the page (or the canvas container) scrolls under
        // the plan while the objects move — two things happening for one
        // key press.
        event.preventDefault();
        const step = event.shiftKey ? NUDGE_LARGE_STEP_M : NUDGE_STEP_M;
        onNudge(direction.x * step, direction.y * step);
        return;
      }

      if (event.key === "Delete" || event.key === "Backspace") {
        event.preventDefault();
        onDelete();
        return;
      }
      if (event.key === "Escape") {
        onDeselect();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onUndo, onRedo, onDelete, onDeselect, onSelectAll, onNudge, onCopy, onPaste, onDuplicate]);
}
