/**
 * Which side panels the user has folded away.
 *
 * All five are independent and stack in their rail: folding "Outils" must
 * not take the command menus with it, which is exactly what it used to do.
 * The state is persisted, because a fold is a statement about how someone
 * wants to work — losing it on every reload would make folding pointless.
 */

export type PanelSectionId = "tools" | "file" | "project" | "properties" | "elements";

const PANEL_SECTION_IDS: readonly PanelSectionId[] = [
  "tools",
  "file",
  "project",
  "properties",
  "elements",
];

const STORAGE_KEY = "kl-implantation/panels/v1";

export function loadCollapsedSections(): Set<PanelSectionId> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return new Set();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    // Unknown ids are dropped: a preference written by a later build must
    // not fold away a panel this one cannot unfold.
    return new Set(
      parsed.filter((id): id is PanelSectionId =>
        typeof id === "string" && (PANEL_SECTION_IDS as readonly string[]).includes(id),
      ),
    );
  } catch {
    return new Set();
  }
}

export function saveCollapsedSections(ids: ReadonlySet<PanelSectionId>): Set<PanelSectionId> {
  const next = new Set(ids);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]));
  } catch {
    /* best effort — a full or disabled localStorage must not block the UI */
  }
  return next;
}

export function toggleSection(
  current: ReadonlySet<PanelSectionId>,
  id: PanelSectionId,
): Set<PanelSectionId> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}
