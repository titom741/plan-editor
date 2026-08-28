import { createId } from "../domain/ids";
import type { CatalogItem, CatalogShape } from "../domain/catalog";
import type { ObjectStyle } from "../domain/types";

/**
 * The user's own material library.
 *
 * The built-in catalogue covers what most event plans need, but every
 * company has its own kit — a particular stage module, a numbered barrier
 * type, a stand size that is theirs. Those live here: added, edited and
 * removed by the user, kept per installation like the reusable components
 * and the toolbar preferences, because they belong to the *user*, not to
 * one project.
 *
 * Built-in items can also be hidden. A firm that never handles heavy
 * goods vehicles should not scroll past one every time, and hiding is
 * reversible in a way that editing the built-in list would not be.
 */

const ITEMS_KEY = "kl-implantation/catalog-items/v1";
const HIDDEN_KEY = "kl-implantation/catalog-hidden/v1";

const SHAPES: readonly CatalogShape[] = ["rectangle", "circle", "line", "polygon"];

function readJson(key: string): unknown {
  try {
    const stored = localStorage.getItem(key);
    return stored === null ? null : JSON.parse(stored);
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* best effort — a full or disabled localStorage must not block the UI */
  }
}

function readStyle(value: unknown): ObjectStyle {
  if (typeof value !== "object" || value === null) return {};
  const record = value as Record<string, unknown>;
  const style: ObjectStyle = {};
  if (typeof record.fill === "string") style.fill = record.fill;
  if (typeof record.stroke === "string") style.stroke = record.stroke;
  if (typeof record.strokeWidth === "number" && Number.isFinite(record.strokeWidth)) {
    style.strokeWidth = record.strokeWidth;
  }
  if (typeof record.opacity === "number" && Number.isFinite(record.opacity))
    style.opacity = record.opacity;
  return style;
}

/** Validates one stored item. Returns `null` for anything malformed — a broken entry is skipped, not "repaired". */
function parseItem(value: unknown): CatalogItem | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  const shape = record.shape;
  if (typeof shape !== "string" || !(SHAPES as readonly string[]).includes(shape)) return null;
  const size = (key: string): number | undefined => {
    const raw = record[key];
    return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : undefined;
  };
  const points = Array.isArray(record.pointsM)
    ? record.pointsM
        .map((point) => {
          if (typeof point !== "object" || point === null) return null;
          const value = point as Record<string, unknown>;
          return typeof value.xM === "number" &&
            Number.isFinite(value.xM) &&
            typeof value.yM === "number" &&
            Number.isFinite(value.yM)
            ? { xM: value.xM, yM: value.yM }
            : null;
        })
        .filter((point): point is { xM: number; yM: number } => point !== null)
    : undefined;
  return {
    id: record.id,
    name: record.name,
    category: typeof record.category === "string" ? record.category : "Personnel",
    reference: typeof record.reference === "string" ? record.reference : "",
    shape: shape as CatalogShape,
    ...(size("widthM") !== undefined ? { widthM: size("widthM") } : {}),
    ...(size("heightM") !== undefined ? { heightM: size("heightM") } : {}),
    ...(size("radiusM") !== undefined ? { radiusM: size("radiusM") } : {}),
    ...(points && points.length > 0 ? { pointsM: points } : {}),
    unit: typeof record.unit === "string" ? record.unit : "u",
    style: readStyle(record.style),
  };
}

export function loadCustomCatalog(): CatalogItem[] {
  const raw = readJson(ITEMS_KEY);
  if (!Array.isArray(raw)) return [];
  return raw.map(parseItem).filter((item): item is CatalogItem => item !== null);
}

export function saveCustomCatalog(items: readonly CatalogItem[]): CatalogItem[] {
  const next = [...items];
  write(ITEMS_KEY, next);
  return next;
}

/** Input for a new or edited item — everything but the id, which the store owns. */
export type CatalogItemDraft = Omit<CatalogItem, "id">;

export function addCustomCatalogItem(draft: CatalogItemDraft): CatalogItem[] {
  return saveCustomCatalog([...loadCustomCatalog(), { ...draft, id: createId("catalog") }]);
}

export function updateCustomCatalogItem(id: string, draft: CatalogItemDraft): CatalogItem[] {
  return saveCustomCatalog(
    loadCustomCatalog().map((item) => (item.id === id ? { ...draft, id } : item)),
  );
}

export function deleteCustomCatalogItem(id: string): CatalogItem[] {
  return saveCustomCatalog(loadCustomCatalog().filter((item) => item.id !== id));
}

export function loadHiddenCatalogIds(): Set<string> {
  const raw = readJson(HIDDEN_KEY);
  return new Set(
    Array.isArray(raw) ? raw.filter((id): id is string => typeof id === "string") : [],
  );
}

export function toggleHiddenCatalogId(id: string): Set<string> {
  const hidden = loadHiddenCatalogIds();
  if (hidden.has(id)) hidden.delete(id);
  else hidden.add(id);
  write(HIDDEN_KEY, [...hidden]);
  return hidden;
}
