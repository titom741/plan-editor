/**
 * How the side rails are laid out: which panels are folded away, and how
 * much room each rail is given.
 *
 * The panels are independent and stack — several open at once is the
 * normal case, which is why each rail also has a size the user can drag.
 * An accordion was tried instead, to stop three open panels from pushing
 * the folded headers out of the rail; that symptom was a layout bug (the
 * rail scrolled instead of its panels), and folding one panel to reach
 * another is a poor trade for a plan you read against two panels at once.
 *
 * Everything here is persisted. A fold and a rail width are both
 * statements about how someone wants to work; losing them on every reload
 * would make the controls pointless.
 */

export type PanelSectionId = "tools" | "file" | "project" | "properties" | "elements";

/** The panels of each rail, in the order they are stacked. */
export const PANEL_RAILS: readonly (readonly PanelSectionId[])[] = [
  ["tools", "file", "project"],
  ["properties", "elements"],
];

const PANEL_SECTION_IDS: readonly PanelSectionId[] = PANEL_RAILS.flat();

const STORAGE_KEY = "kl-implantation/panels/v1";
const SIZES_KEY = "kl-implantation/panel-sizes/v1";

export function loadCollapsedSections(): Set<PanelSectionId> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return new Set();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return new Set();
    // Unknown ids are dropped: a preference written by a later build must
    // not fold away a panel this one cannot unfold.
    return new Set(
      parsed.filter(
        (id): id is PanelSectionId =>
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

/** Folds or unfolds one panel, leaving every other panel as it was. */
export function toggleSection(
  current: ReadonlySet<PanelSectionId>,
  id: PanelSectionId,
): Set<PanelSectionId> {
  const next = new Set(current);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

// ---------------------------------------------------------------------------
// Rail sizes
// ---------------------------------------------------------------------------

/**
 * The two rail widths in CSS pixels and the share of the right rail given
 * to the properties panel, as a percentage. Bounds are enforced here
 * rather than in the drag handler so a stored value can't reopen the app
 * with a rail dragged off the screen.
 */
export interface RailSizes {
  toolsWidthPx: number;
  propertiesWidthPx: number;
  propertiesPercent: number;
}

export const DEFAULT_RAIL_SIZES: RailSizes = {
  toolsWidthPx: 220,
  propertiesWidthPx: 260,
  propertiesPercent: 60,
};

const RAIL_BOUNDS = {
  toolsWidthPx: { min: 180, max: 420 },
  propertiesWidthPx: { min: 220, max: 460 },
  propertiesPercent: { min: 20, max: 80 },
} as const satisfies Record<keyof RailSizes, { min: number; max: number }>;

export function clampRailSize<K extends keyof RailSizes>(key: K, value: number): number {
  const { min, max } = RAIL_BOUNDS[key];
  if (!Number.isFinite(value)) return DEFAULT_RAIL_SIZES[key];
  const clamped = Math.max(min, Math.min(max, value));
  // Rounded because a drag produces sub-pixel noise there is no use for,
  // and a stored `26.793893129770993` is only harder to read.
  return key === "propertiesPercent" ? Math.round(clamped * 10) / 10 : Math.round(clamped);
}

export function loadRailSizes(): RailSizes {
  try {
    const stored = localStorage.getItem(SIZES_KEY);
    if (stored === null) return { ...DEFAULT_RAIL_SIZES };
    const parsed: unknown = JSON.parse(stored);
    if (typeof parsed !== "object" || parsed === null) return { ...DEFAULT_RAIL_SIZES };
    const record = parsed as Record<string, unknown>;
    const read = <K extends keyof RailSizes>(key: K): number =>
      clampRailSize(key, typeof record[key] === "number" ? record[key] : DEFAULT_RAIL_SIZES[key]);
    return {
      toolsWidthPx: read("toolsWidthPx"),
      propertiesWidthPx: read("propertiesWidthPx"),
      propertiesPercent: read("propertiesPercent"),
    };
  } catch {
    return { ...DEFAULT_RAIL_SIZES };
  }
}

export function saveRailSizes(sizes: RailSizes): RailSizes {
  try {
    localStorage.setItem(SIZES_KEY, JSON.stringify(sizes));
  } catch {
    /* best effort — see saveCollapsedSections */
  }
  return sizes;
}
