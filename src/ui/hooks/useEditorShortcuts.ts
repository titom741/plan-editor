import { useEffect } from "react";

interface EditorShortcutsHandlers {
  onUndo: () => void;
  onRedo: () => void;
  onDelete: () => void;
  onDeselect: () => void;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable;
}

/**
 * Global keyboard shortcuts for the editor: undo/redo, delete, and
 * deselect. Skips them all while focus is inside a text input so, for
 * example, Ctrl+Z inside the "Nom" field does the browser's native
 * text-undo instead of hijacking the editor's undo stack.
 */
export function useEditorShortcuts({ onUndo, onRedo, onDelete, onDeselect }: EditorShortcutsHandlers) {
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) return;

      const isModifier = event.metaKey || event.ctrlKey;
      if (isModifier && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) onRedo();
        else onUndo();
        return;
      }
      if (isModifier && event.key.toLowerCase() === "y") {
        event.preventDefault();
        onRedo();
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
  }, [onUndo, onRedo, onDelete, onDeselect]);
}
