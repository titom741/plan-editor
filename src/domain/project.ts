import { createDefaultCalibration } from "./calibration";
import { resizeBackgroundToCalibration } from "./background";
import { createId } from "./ids";
import { createDefaultLayers } from "./layers";
import { createRectangleObject } from "./objects";
import type { BackgroundImage, Calibration, PlanObject, PlanObjectPatch, Project } from "./types";

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
