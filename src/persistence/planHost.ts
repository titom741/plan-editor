/**
 * A host application that keeps the projects itself (KL-055).
 *
 * The editor is also shipped inside Virade, the event-management
 * application, where it runs in a frame served by Virade's local service.
 * There, a project library kept in the browser's IndexedDB is the wrong
 * place: it is invisible to Virade's backups, tied to one web view's site
 * data, and apart from everything else about the event. So Virade offers a
 * library of its own — one plan per project, filed under a year, saved with
 * the rest of its data — and the editor uses it instead.
 *
 * **The contract is an object on the parent window**, `planEditorHost`,
 * rather than HTTP routes the editor would call: the editor does not need
 * to know Virade's API, and any other host can offer the same object. The
 * frame is same-origin, so the parent is reachable; anywhere else (a plain
 * browser tab, a cross-origin frame, the macOS shell) there is no parent
 * object and the editor keeps its own IndexedDB library.
 *
 * **Only primitives cross the boundary.** The host's objects come from
 * another JavaScript realm, where `instanceof` and prototype checks lie; a
 * project travels as the JSON text of its file, which `parseProjectFile`
 * validates here exactly like a file the user picked.
 */

import { parseProjectFile, toProjectFile } from "./projectFile";
import type { ParseError, ProjectFile } from "./projectFile";
import type { Project } from "../domain/types";

export interface PlanHost {
  /** Who keeps the plans, as the editor says it: « Virade ». */
  readonly name: string;
  /** Where a new plan goes, as a label: « 2026 ». */
  scope(): Promise<string>;
  /** Every plan, as JSON: an array of `HostPlanSummary`. */
  list(): Promise<string>;
  /** A plan's project file (JSON), or `null` when there is no such plan. */
  load(id: string): Promise<string | null>;
  /** The plan to reopen at launch, or `null` for none yet. */
  loadCurrent(): Promise<string | null>;
  /** Creates or replaces a plan; resolves to when it was saved (ISO date). */
  save(
    id: string,
    name: string,
    location: string,
    objectCount: number,
    file: string,
  ): Promise<string>;
  remove(id: string): Promise<boolean>;
  /** The folder files are saved and exported to by default, or `null`. */
  exportFolder(): Promise<string | null>;
  /**
   * Files a generated file (base64) where the host keeps them, with no
   * dialog; resolves to its path. Optional: without it, files download.
   */
  saveFile?(fileName: string, base64: string): Promise<string>;
}

export interface HostPlanSummary {
  id: string;
  name: string;
  location: string;
  savedAt: string;
  updatedAt: string;
  objectCount: number;
  /** Which year (or other group) the plan belongs to. */
  scope: string;
  /** A plan of a closed year: it opens, it is not saved over. */
  readOnly: boolean;
}

/**
 * The message of an error thrown by the host. Its `Error` is another
 * realm's, so `instanceof Error` is false and `String()` would prefix the
 * class name; the message is read directly.
 */
export function messageOf(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { message?: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

function isPlanHost(value: unknown): value is PlanHost {
  if (typeof value !== "object" || value === null) return false;
  const host = value as Record<string, unknown>;
  return (
    typeof host.name === "string" &&
    ["scope", "list", "load", "loadCurrent", "save", "remove", "exportFolder"].every(
      (method) => typeof host[method] === "function",
    )
  );
}

/**
 * The host, when the editor runs inside one. Read on every call rather
 * than cached: it costs nothing, and a test can install or remove one.
 */
export function getPlanHost(): PlanHost | null {
  try {
    if (typeof window === "undefined" || window.parent === window) return null;
    const candidate = (window.parent as unknown as { planEditorHost?: unknown }).planEditorHost;
    return isPlanHost(candidate) ? candidate : null;
  } catch {
    // A cross-origin parent throws on any property access.
    return null;
  }
}

export type HostLoadResult =
  | { status: "loaded"; file: ProjectFile }
  | { status: "empty" }
  | { status: "unavailable" }
  | { status: "corrupt"; error: ParseError };

function parseHostFile(text: string | null): HostLoadResult {
  if (text === null) return { status: "empty" };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: "corrupt", error: { code: "notJson" } };
  }
  const parsed = parseProjectFile(raw);
  return parsed.ok
    ? { status: "loaded", file: parsed.file }
    : { status: "corrupt", error: parsed.error };
}

export async function hostLoad(host: PlanHost, id: string | null): Promise<HostLoadResult> {
  try {
    return parseHostFile(id === null ? await host.loadCurrent() : await host.load(id));
  } catch {
    return { status: "unavailable" };
  }
}

export async function hostSave(
  host: PlanHost,
  project: Project,
): Promise<{ status: "saved"; savedAt: string } | { status: "failed"; message: string }> {
  const file = toProjectFile(project);
  try {
    const savedAt = await host.save(
      project.id,
      project.name,
      project.location,
      project.objects.length,
      JSON.stringify(file),
    );
    return { status: "saved", savedAt: typeof savedAt === "string" ? savedAt : file.savedAt };
  } catch (error) {
    return { status: "failed", message: messageOf(error) };
  }
}

export async function hostList(host: PlanHost): Promise<HostPlanSummary[]> {
  try {
    const parsed: unknown = JSON.parse(await host.list());
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is HostPlanSummary =>
        typeof entry === "object" &&
        entry !== null &&
        typeof (entry as HostPlanSummary).id === "string" &&
        typeof (entry as HostPlanSummary).name === "string",
    );
  } catch {
    return [];
  }
}

export async function hostRemove(host: PlanHost, id: string): Promise<boolean> {
  try {
    return (await host.remove(id)) === true;
  } catch {
    return false;
  }
}
