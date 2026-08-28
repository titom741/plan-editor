import type { VectorM } from "./geometry";
import { createId } from "./ids";
import type { PlanObject } from "./types";

/**
 * Copy/paste and duplicate, as a domain operation.
 *
 * The editor's clipboard holds real `PlanObject`s rather than a serialised
 * blob: this is a local, single-window app, so there is no round-trip
 * through the system clipboard to survive and nothing to validate on the
 * way back in. What *does* need care is everything the copies must not
 * share with their originals — identity and, if the source layer has since
 * been deleted, a home.
 */

export interface DuplicateContext {
  /** How far to shift the copies, so a paste doesn't land exactly on top of the original and look like nothing happened. */
  offsetM: VectorM;
  /** Ids of the layers the project currently has. A copy whose layer is gone would be invisible and unreachable. */
  existingLayerIds: ReadonlySet<string>;
  /** Where a copy goes when its original's layer no longer exists. */
  fallbackLayerId: string;
}

/**
 * Copies of `objects` with fresh ids, shifted by `offsetM`.
 *
 * Names are carried over unchanged. Two objects called "Chapiteau
 * principal" after a copy is honest — the user asked for a copy — and
 * inventing "Chapiteau principal (copie) (copie)" on the second paste
 * would be worse than the ambiguity it tries to prevent.
 *
 * Only the anchor moves: `pointsM` on lines and polygons are stored
 * relative to it, so shifting the anchor shifts the whole shape and the
 * copy keeps its exact geometry, rotation included.
 */
export function duplicateObjects(
  objects: readonly PlanObject[],
  context: DuplicateContext,
): PlanObject[] {
  return objects.map((object) => ({
    ...object,
    id: createId("obj"),
    layerId: context.existingLayerIds.has(object.layerId)
      ? object.layerId
      : context.fallbackLayerId,
    xM: object.xM + context.offsetM.xM,
    yM: object.yM + context.offsetM.yM,
  }));
}
