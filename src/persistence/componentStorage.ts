/**
 * The reusable-component library: named bundles of plan objects the user
 * can drop back onto any plan.
 *
 * Kept in `localStorage` rather than the IndexedDB store `projectStorage`
 * uses, because a template belongs to the *installation*, not to a project
 * — it has to outlive the document it was cut from and be available in the
 * next one.
 *
 * What comes back out is untrusted like any other stored value, so it goes
 * through `parsePlanObjects` — the same validator the project file parser
 * uses — instead of being cast. A template that no longer parses is
 * dropped, not "repaired": unlike a project file, it is a convenience the
 * user can recreate in seconds, so silently skipping it beats refusing to
 * open the library at all.
 */

import { createId } from "../domain/ids";
import type { PlanObject } from "../domain/types";
import { parsePlanObjects } from "./projectFile";

export interface ComponentTemplate {
  id: string;
  name: string;
  objects: PlanObject[];
}

const STORAGE_KEY = "kl-implantation/component-templates/v1";
/** Pre-refactor key, read once so an existing library survives the rename. */
const LEGACY_STORAGE_KEY = "kl-component-templates-v1";

function readRaw(): unknown {
  try {
    const stored = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
    return stored === null ? [] : JSON.parse(stored);
  } catch {
    return [];
  }
}

function parseTemplate(value: unknown): ComponentTemplate | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (typeof record.id !== "string" || typeof record.name !== "string") return null;
  const objects = parsePlanObjects(record.objects);
  return objects === null ? null : { id: record.id, name: record.name, objects };
}

export function loadComponentTemplates(): ComponentTemplate[] {
  const raw = readRaw();
  if (!Array.isArray(raw)) return [];
  return raw
    .map(parseTemplate)
    .filter((template): template is ComponentTemplate => template !== null);
}

/** Best-effort: a full or disabled `localStorage` must not take the editor down with it. */
function write(templates: readonly ComponentTemplate[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(templates));
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignored on purpose — see above */
  }
}

export function saveComponentTemplate(name: string, objects: readonly PlanObject[]): ComponentTemplate {
  const template: ComponentTemplate = {
    id: createId("component"),
    name: name.trim() || "Composant",
    objects: objects.map((object) => ({ ...object })),
  };
  write([...loadComponentTemplates(), template]);
  return template;
}

export function deleteComponentTemplate(id: string): ComponentTemplate[] {
  const next = loadComponentTemplates().filter((template) => template.id !== id);
  write(next);
  return next;
}
