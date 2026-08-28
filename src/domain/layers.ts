import { createId } from "./ids";
import type { Layer } from "./types";

/** Layers created automatically for every new project. */
export const DEFAULT_LAYER_NAMES = [
  "Structures",
  "Électricité",
  "Sécurité",
  "Annotations",
] as const;

export function createDefaultLayers(): Layer[] {
  return DEFAULT_LAYER_NAMES.map((name, index) => ({
    id: createId("layer"),
    name,
    visible: true,
    locked: false,
    order: index,
  }));
}

/**
 * The layer a freshly-created object should land on: the first unlocked
 * layer (in `order`), falling back to the first layer at all if every
 * layer happens to be locked. Choosing *which* layer to target explicitly
 * (a layer picker in the UI) is deferred to KL-006.
 */
export function getDefaultTargetLayer(layers: Layer[]): Layer | undefined {
  const ordered = [...layers].sort((a, b) => a.order - b.order);
  return ordered.find((layer) => !layer.locked) ?? ordered[0];
}

/** Layers in draw order, bottom first. `order` is the single source of truth; the array's own order is not. */
export function sortLayersByOrder(layers: readonly Layer[]): Layer[] {
  return [...layers].sort((a, b) => a.order - b.order);
}

/**
 * Rewrites `order` to 0, 1, 2… following the array's current sequence.
 *
 * Every reordering operation goes through this, so `order` can never
 * develop gaps or duplicates — a duplicate would make the draw order
 * depend on `Array.prototype.sort`'s tie-breaking, which is exactly the
 * kind of "works until it doesn't" the model shouldn't allow.
 */
export function normalizeLayerOrder(layers: readonly Layer[]): Layer[] {
  return layers.map((layer, index) => (layer.order === index ? layer : { ...layer, order: index }));
}

/** A default name for a new layer: "Calque N", N chosen so it doesn't collide with an existing name. */
export function nextLayerName(layers: readonly Layer[]): string {
  const taken = new Set(layers.map((layer) => layer.name));
  let index = layers.length + 1;
  while (taken.has(`Calque ${index}`)) index += 1;
  return `Calque ${index}`;
}

/** A new layer, placed on top of the existing ones. */
export function createLayer(layers: readonly Layer[], name?: string): Layer {
  return {
    id: createId("layer"),
    name: name?.trim() || nextLayerName(layers),
    visible: true,
    locked: false,
    order: layers.length,
  };
}

/**
 * Moves a layer one step through the draw order: `direction` -1 sends it
 * down (drawn earlier, so further back), +1 brings it up. A no-op — same
 * array contents, renormalised — when the layer is already at that end.
 */
export function moveLayerInOrder(
  layers: readonly Layer[],
  layerId: string,
  direction: -1 | 1,
): Layer[] {
  const ordered = sortLayersByOrder(layers);
  const index = ordered.findIndex((layer) => layer.id === layerId);
  const target = index + direction;
  if (index === -1 || target < 0 || target >= ordered.length) return normalizeLayerOrder(ordered);
  const moved = ordered[index];
  const displaced = ordered[target];
  if (!moved || !displaced) return normalizeLayerOrder(ordered);
  ordered[index] = displaced;
  ordered[target] = moved;
  return normalizeLayerOrder(ordered);
}

/**
 * The layer an object orphaned by a deletion should move to: the one just
 * below the deleted layer, or the new bottom layer if it was the bottom.
 * Returns `undefined` when nothing would remain — the caller must then
 * refuse the deletion rather than strand the objects.
 */
export function getLayerAfterRemoval(
  layers: readonly Layer[],
  removedId: string,
): Layer | undefined {
  const ordered = sortLayersByOrder(layers);
  const index = ordered.findIndex((layer) => layer.id === removedId);
  if (index === -1) return undefined;
  const remaining = ordered.filter((layer) => layer.id !== removedId);
  return remaining[Math.max(0, index - 1)];
}
