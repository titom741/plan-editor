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
