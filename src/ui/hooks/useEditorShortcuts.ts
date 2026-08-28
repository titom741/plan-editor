import { useEffect } from "react";
import { keyboardEventSignature, type ShortcutMap } from "../shortcuts";

interface EditorShortcutsHandlers {
  shortcuts: ShortcutMap;
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
  shortcuts,
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

      const signature = keyboardEventSignature(event);
      const configured: [keyof ShortcutMap, () => void][] = [
        ["undo", onUndo], ["redo", onRedo], ["selectAll", onSelectAll], ["copy", onCopy],
        ["paste", onPaste], ["duplicate", onDuplicate], ["delete", onDelete], ["deselect", onDeselect],
      ];
      const match = configured.find(([action]) => shortcuts[action] === signature);
      if (match) { event.preventDefault(); match[1](); return; }

      const isModifier = event.metaKey || event.ctrlKey;
      if (isModifier) {
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

    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [shortcuts, onUndo, onRedo, onDelete, onDeselect, onSelectAll, onNudge, onCopy, onPaste, onDuplicate]);
}
