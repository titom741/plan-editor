import { createDefaultCalibration } from "./calibration";
import { resizeBackgroundToCalibration } from "./background";
import { createId } from "./ids";
import { createDefaultLayers, createLayer, getLayerAfterRemoval, moveLayerInOrder, normalizeLayerOrder, sortLayersByOrder } from "./layers";
import { createRectangleObject } from "./objects";
import type { BackgroundImage, Calibration, Layer, PlanObject, PlanObjectPatch, Project } from "./types";

export interface CreateProjectInput {
  name: string;
  description?: string;
  location?: string;
}

/** Creates a brand-new, empty project with default layers and calibration. */
export function createEmptyProject(input: CreateProjectInput): Project {
  const now = new Date().toISOString();
  return {
    id: createId("project"),
    name: input.name,
    description: input.description ?? "",
    location: input.location ?? "",
    createdAt: now,
    updatedAt: now,
    units: "m",
    calibration: createDefaultCalibration(),
    background: null,
    layers: createDefaultLayers(),
    objects: [],
    sheets: [],
  };
}

/**
 * Creates the demonstration project used on first launch: a project with
 * the default layers plus a 10 × 5 m "Chapiteau principal" rectangle, to
 * prove the domain model carries real-world dimensions end to end.
 */
export function createDemoProject(): Project {
  const project = createEmptyProject({
    name: "Projet de démonstration",
    description: "Exemple généré automatiquement pour valider la chaîne mètres → écran.",
    location: "",
  });

  const structuresLayer = project.layers.find((layer) => layer.name === "Structures");
  if (!structuresLayer) {
    throw new Error("Default layer 'Structures' is missing — createDefaultLayers() changed?");
  }

  const chapiteau = createRectangleObject({
    layerId: structuresLayer.id,
    name: "Chapiteau principal",
    xM: 10,
    yM: 10,
    widthM: 10,
    heightM: 5,
    style: { fill: "#cfe3ff", stroke: "#2f6fed", strokeWidth: 2 },
  });

  return { ...project, objects: [chapiteau] };
}

/** Returns a new project with `object` appended. */
export function addObject(project: Project, object: PlanObject): Project {
  return { ...project, objects: [...project.objects, object], updatedAt: new Date().toISOString() };
}

/** Returns a new project with the object matching `id` removed. A no-op (same objects array) if no object matches. */
export function removeObject(project: Project, id: string): Project {
  if (!project.objects.some((object) => object.id === id)) return project;
  return {
    ...project,
    objects: project.objects.filter((object) => object.id !== id),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Returns a new project with the object matching `id` patched. A no-op if
 * no object matches — callers may legitimately race with an object having
 * just been deleted (e.g. a resize handle drag ending after the object
 * was removed).
 */
export function patchObject(project: Project, id: string, patch: PlanObjectPatch): Project {
  let changed = false;
  const objects = project.objects.map((object) => {
    if (object.id !== id) return object;
    changed = true;
    // Safe by construction, not by the type system: callers only ever
    // build a patch from the object's own current (already-narrowed)
    // type — e.g. `widthM` only after checking `object.type === "rectangle"`
    // — so the fields always belong to whichever variant `object` already
    // is. TypeScript can't verify that across a discriminated-union merge,
    // hence the cast.
    return { ...object, ...patch } as PlanObject;
  });
  if (!changed) return project;
  return { ...project, objects, updatedAt: new Date().toISOString() };
}

/** Returns a new project with several objects appended at once — one undo step for a paste of many. */
export function addObjects(project: Project, objects: readonly PlanObject[]): Project {
  if (objects.length === 0) return project;
  return { ...project, objects: [...project.objects, ...objects], updatedAt: new Date().toISOString() };
}

/** Returns a new project with every object in `ids` removed. A no-op if none of them are present. */
export function removeObjects(project: Project, ids: readonly string[]): Project {
  const doomed = new Set(ids);
  if (!project.objects.some((object) => doomed.has(object.id))) return project;
  return {
    ...project,
    objects: project.objects.filter((object) => !doomed.has(object.id)),
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Returns a new project with each object patched by its own entry in
 * `patches`. Used for anything that edits a multi-selection — moving five
 * objects has to be a single state transition, or the four that aren't
 * being dragged would lag a frame behind the one that is.
 *
 * Same soundness argument as `patchObject`: the caller builds each patch
 * from the object's own already-narrowed type.
 */
export function patchObjects(project: Project, patches: ReadonlyMap<string, PlanObjectPatch>): Project {
  if (patches.size === 0) return project;
  let changed = false;
  const objects = project.objects.map((object) => {
    const patch = patches.get(object.id);
    if (!patch) return object;
    changed = true;
    return { ...object, ...patch } as PlanObject;
  });
  if (!changed) return project;
  return { ...project, objects, updatedAt: new Date().toISOString() };
}

// ---------------------------------------------------------------------------
// Layers (KL-006)
// ---------------------------------------------------------------------------

const touched = (project: Project, changes: Partial<Project>): Project => ({
  ...project,
  ...changes,
  updatedAt: new Date().toISOString(),
});

/** Adds a new, empty layer on top of the stack and returns it alongside the new project. */
export function addLayer(project: Project, name?: string): { project: Project; layer: Layer } {
  const layer = createLayer(project.layers, name);
  return { project: touched(project, { layers: [...project.layers, layer] }), layer };
}

/** Renames a layer. An empty or whitespace-only name is refused (a nameless layer is unusable in a picker) and the project comes back untouched. */
export function renameLayer(project: Project, layerId: string, name: string): Project {
  const trimmed = name.trim();
  if (!trimmed) return project;
  if (!project.layers.some((layer) => layer.id === layerId)) return project;
  return touched(project, {
    layers: project.layers.map((layer) => (layer.id === layerId ? { ...layer, name: trimmed } : layer)),
  });
}

/** Sets a layer's `visible` / `locked` flags. */
export function patchLayer(project: Project, layerId: string, patch: Partial<Pick<Layer, "visible" | "locked">>): Project {
  if (!project.layers.some((layer) => layer.id === layerId)) return project;
  return touched(project, {
    layers: project.layers.map((layer) => (layer.id === layerId ? { ...layer, ...patch } : layer)),
  });
}

/** Moves a layer one step through the draw order (-1 = further back, +1 = further forward). */
export function moveLayer(project: Project, layerId: string, direction: -1 | 1): Project {
  return touched(project, { layers: moveLayerInOrder(project.layers, layerId, direction) });
}

/**
 * Deletes a layer and moves its objects to the layer below it (or to the
 * new bottom layer, if it was the bottom one).
 *
 * The objects are kept on purpose. Deleting a container is not a request
 * to destroy its contents, and an undo away is not good enough when the
 * alternative — the objects reappearing one layer down, where they are
 * plainly visible — costs nothing. The caller is expected to say so
 * before asking.
 *
 * Refuses to delete the last remaining layer: every object needs a home,
 * and an empty `layers` array would leave the next created object
 * nowhere to go.
 */
export function removeLayer(project: Project, layerId: string): Project {
  if (project.layers.length <= 1) return project;
  const destination = getLayerAfterRemoval(project.layers, layerId);
  if (!destination) return project;
  return touched(project, {
    layers: normalizeLayerOrder(sortLayersByOrder(project.layers).filter((layer) => layer.id !== layerId)),
    objects: project.objects.map((object) =>
      object.layerId === layerId ? { ...object, layerId: destination.id } : object,
    ),
  });
}

/** Moves objects onto `layerId`. A no-op if the layer doesn't exist or nothing would change. */
export function assignObjectsToLayer(project: Project, ids: readonly string[], layerId: string): Project {
  if (!project.layers.some((layer) => layer.id === layerId)) return project;
  const moving = new Set(ids);
  if (!project.objects.some((object) => moving.has(object.id) && object.layerId !== layerId)) return project;
  return touched(project, {
    objects: project.objects.map((object) => (moving.has(object.id) ? { ...object, layerId } : object)),
  });
}

/** Returns a new project with `background` set, replacing any existing one. */
export function setBackground(project: Project, background: BackgroundImage): Project {
  return { ...project, background, updatedAt: new Date().toISOString() };
}

/** Returns a new project with the background removed. A no-op if there wasn't one. */
export function removeBackground(project: Project): Project {
  if (!project.background) return project;
  return { ...project, background: null, updatedAt: new Date().toISOString() };
}

/** Returns a new project with the background patched. A no-op if there isn't one. */
export function patchBackground(project: Project, patch: Partial<BackgroundImage>): Project {
  if (!project.background) return project;
  return {
    ...project,
    background: { ...project.background, ...patch },
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Returns a new project with `calibration` set and the background's
 * `widthM`/`heightM` recomputed to match it — the two always change
 * together, since (from calibration onward) the background's true size
 * is derived from its native pixel resolution via the calibration's
 * `pixelsPerMeter` (see `domain/calibration.ts` and
 * `resizeBackgroundToCalibration`). A no-op on the background if there
 * isn't one — the calibration itself is still recorded either way, ready
 * for the next background that's imported.
 */
export function applyCalibration(project: Project, calibration: Calibration): Project {
  const withCalibration: Project = { ...project, calibration, updatedAt: new Date().toISOString() };
  if (!project.background) return withCalibration;
  return patchBackground(withCalibration, resizeBackgroundToCalibration(project.background, calibration));
}
