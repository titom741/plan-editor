export type ShortcutAction = "undo" | "redo" | "selectAll" | "copy" | "paste" | "duplicate" | "delete" | "deselect";
export type ShortcutMap = Record<ShortcutAction, string>;

export const DEFAULT_SHORTCUTS: ShortcutMap = {
  undo: "Mod+z", redo: "Mod+Shift+z", selectAll: "Mod+a", copy: "Mod+c",
  paste: "Mod+v", duplicate: "Mod+d", delete: "Delete", deselect: "Escape",
};
export const SHORTCUT_LABELS: Record<ShortcutAction, string> = {
  undo: "Annuler", redo: "Rétablir", selectAll: "Tout sélectionner", copy: "Copier",
  paste: "Coller", duplicate: "Dupliquer", delete: "Supprimer", deselect: "Désélectionner",
};
const STORAGE_KEY = "kl-implantation/shortcuts/v1";

export function keyboardEventSignature(event: Pick<KeyboardEvent, "key" | "ctrlKey" | "metaKey" | "altKey" | "shiftKey">): string {
  const parts: string[] = [];
  if (event.ctrlKey || event.metaKey) parts.push("Mod");
  if (event.altKey) parts.push("Alt");
  if (event.shiftKey) parts.push("Shift");
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (!(["Control", "Meta", "Alt", "Shift"] as string[]).includes(key)) parts.push(key);
  return parts.join("+");
}

export function loadShortcuts(): ShortcutMap {
  try { return { ...DEFAULT_SHORTCUTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<ShortcutMap> }; }
  catch { return { ...DEFAULT_SHORTCUTS }; }
}
export function saveShortcuts(shortcuts: ShortcutMap): ShortcutMap {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(shortcuts));
  return shortcuts;
}
