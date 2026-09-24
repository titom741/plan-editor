/**
 * How the side rails are laid out: which panels are folded away, and how
 * much room each rail is given.
 *
 * The two rails behave differently, on purpose:
 *
 * - **The left rail is a set of menus, one open at a time.** Fichier,
 *   Projet, Outils and Électricité are places you go to pick something and leave; you
 *   do not read a plan against two of them at once, and opening one while
 *   another stays open just pushes the third off the bottom.
 * - **The right rail stacks.** Properties and Éléments are read *while*
 *   editing — the selected object's fields next to the inventory it sits
 *   in — which is also why that rail has a height split to drag.
 *
 * Everything here is persisted. A fold and a rail width are both
 * statements about how someone wants to work; losing them on every reload
 * would make the controls pointless.
 */

export type PanelSectionId =
  "tools" | "electrical" | "file" | "project" | "properties" | "elements";

export interface PanelRail {
  /**
   * The panels of the rail, in the order they are stacked. It mirrors the
   * order they are written in `Editor.tsx`; nothing enforces that, so the
   * two are changed together.
   */
  readonly sections: readonly PanelSectionId[];
  /** Whether opening one panel folds the others in the same rail. */
  readonly exclusive: boolean;
}

export const PANEL_RAILS: readonly PanelRail[] = [
  // Électricité is a menu of its own (KL-047), not a heading inside
  // Outils: laying out a network is a job of its own, done with its own
  // tools, and it deserved more than the bottom of a long palette.
  { sections: ["file", "project", "tools", "electrical"], exclusive: true },
  { sections: ["properties", "elements"], exclusive: false },
];

const PANEL_SECTION_IDS: readonly PanelSectionId[] = PANEL_RAILS.flatMap((rail) => rail.sections);

/**
 * What is open before anyone touches anything: the drawing tools, since
 * that is the panel used continuously, while Fichier and Projet are
 * visited and left.
 */
const DEFAULT_OPEN: PanelSectionId = "tools";

function railOf(id: PanelSectionId): PanelRail | undefined {
  return PANEL_RAILS.find((rail) => rail.sections.includes(id));
}

/**
 * Folds all but one open panel of every exclusive rail, keeping
 * {@link DEFAULT_OPEN} when it is among them and the first otherwise.
 *
 * Applied on read, because a preference stored by a build whose left rail
 * stacked would otherwise reopen the app in a state this one has no way to
 * reach again. Someone arriving from that build was drawing with all three
 * open, so they land on the palette rather than on Fichier.
 */
function enforceExclusivity(collapsed: ReadonlySet<PanelSectionId>): Set<PanelSectionId> {
  const next = new Set(collapsed);
  for (const rail of PANEL_RAILS) {
    if (!rail.exclusive) continue;
    const open = rail.sections.filter((id) => !next.has(id));
    if (open.length <= 1) continue;
    const kept = open.includes(DEFAULT_OPEN) ? DEFAULT_OPEN : open[0];
    for (const other of open) if (other !== kept) next.add(other);
  }
  return next;
}

/** Everything folded except {@link DEFAULT_OPEN}. */
function defaultCollapsed(): Set<PanelSectionId> {
  return new Set(PANEL_SECTION_IDS.filter((id) => id !== DEFAULT_OPEN && railOf(id)?.exclusive));
}

const STORAGE_KEY = "kl-implantation/panels/v1";
const SIZES_KEY = "kl-implantation/panel-sizes/v1";

export function loadCollapsedSections(): Set<PanelSectionId> {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return defaultCollapsed();
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return defaultCollapsed();
    // Unknown ids are dropped: a preference written by a later build must
    // not fold away a panel this one cannot unfold.
    return enforceExclusivity(
      new Set(
        parsed.filter(
          (id): id is PanelSectionId =>
            typeof id === "string" && (PANEL_SECTION_IDS as readonly string[]).includes(id),
        ),
      ),
    );
  } catch {
    return defaultCollapsed();
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

/**
 * Folds or unfolds one panel.
 *
 * Folding never touches anything else. *Unfolding* folds the rest of the
 * rail when that rail is exclusive — which is the whole point of the left
 * one: opening a menu closes the menu that was open.
 */
export function toggleSection(
  current: ReadonlySet<PanelSectionId>,
  id: PanelSectionId,
): Set<PanelSectionId> {
  const next = new Set(current);
  if (!next.has(id)) {
    next.add(id);
    return next;
  }
  next.delete(id);
  const rail = railOf(id);
  if (rail?.exclusive) {
    for (const other of rail.sections) if (other !== id) next.add(other);
  }
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
