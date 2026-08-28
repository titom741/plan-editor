import { useCallback, useRef } from "react";
import { duplicateObjects } from "../../domain/clipboard";
import { getDefaultTargetLayer } from "../../domain/layers";
import { addObjects } from "../../domain/project";
import type { PlanObject, Project } from "../../domain/types";
import { deserializeProject, serializeProject } from "../../persistence/projectFile";

/** How far each successive paste is offset from the original, in metres, so copies fan out instead of stacking invisibly. */
const PASTE_OFFSET_M = 0.5;

interface UseClipboardOptions {
  project: Project;
  /** What a copy or duplicate acts on. */
  selectedObjects: readonly PlanObject[];
  /** The layer a pasted object falls back to when its own no longer exists. */
  fallbackLayerId: string | null;
  commitChange: (updater: (project: Project) => Project) => void;
  /** Called with the ids of the copies, so the user ends up editing what they just pasted. */
  onPasted: (ids: readonly string[]) => void;
}

/**
 * Copy, paste and duplicate.
 *
 * Two clipboards, on purpose. The in-memory one is authoritative and
 * always works; the system clipboard is written and read on a best-effort
 * basis so a selection can cross between two browser tabs of the app.
 * `navigator.clipboard.readText` is unavailable or permission-gated in
 * several browsers, and the text there is usually not ours at all — so
 * every failure path falls back to the in-memory copy rather than doing
 * nothing.
 *
 * What lands on the system clipboard is a real project file (minus the
 * backdrops, which would carry whole base64 images), so pasting it into
 * an editor gives something the app can also open.
 */
export function useClipboard({
  project,
  selectedObjects,
  fallbackLayerId,
  commitChange,
  onPasted,
}: UseClipboardOptions) {
  const clipboardRef = useRef<PlanObject[]>([]);
  /** How many times the current clipboard content has been pasted — drives the fan-out offset. */
  const pasteCountRef = useRef(0);

  /**
   * Adds copies of `sources` to the project and selects them, as one undo
   * step. `step` scales the offset so a repeated paste walks across the
   * plan instead of hiding each copy under the previous one.
   */
  const pasteObjects = useCallback(
    (sources: readonly PlanObject[], step: number) => {
      if (sources.length === 0) return;
      const fallbackLayer =
        project.layers.find((layer) => layer.id === fallbackLayerId) ?? getDefaultTargetLayer(project.layers);
      if (!fallbackLayer) return;
      const copies = duplicateObjects(sources, {
        offsetM: { xM: PASTE_OFFSET_M * step, yM: PASTE_OFFSET_M * step },
        existingLayerIds: new Set(project.layers.map((layer) => layer.id)),
        fallbackLayerId: fallbackLayer.id,
      });
      commitChange((current) => addObjects(current, copies));
      onPasted(copies.map((copy) => copy.id));
    },
    [project.layers, fallbackLayerId, commitChange, onPasted],
  );

  const copy = useCallback(() => {
    if (selectedObjects.length === 0) return;
    // Snapshot the objects as they are now: a later edit to the originals
    // must not reach into what has already been copied.
    clipboardRef.current = selectedObjects.map((object) => ({ ...object }));
    pasteCountRef.current = 0;
    if (navigator.clipboard?.writeText) {
      const payload = serializeProject({ ...project, backgrounds: [], objects: clipboardRef.current });
      void navigator.clipboard.writeText(payload).catch(() => undefined);
    }
  }, [selectedObjects, project]);

  const paste = useCallback(() => {
    const pasteNext = (objects: readonly PlanObject[]) => {
      pasteCountRef.current += 1;
      pasteObjects(objects, pasteCountRef.current);
    };
    if (!navigator.clipboard?.readText) {
      pasteNext(clipboardRef.current);
      return;
    }
    void navigator.clipboard
      .readText()
      .then((text) => {
        const parsed = deserializeProject(text);
        // Anything that isn't one of our own project files — ordinary text
        // the user copied elsewhere — leaves the in-memory clipboard alone.
        if (parsed.ok && parsed.file.project.objects.length > 0) {
          clipboardRef.current = parsed.file.project.objects;
          pasteNext(parsed.file.project.objects);
        } else {
          pasteNext(clipboardRef.current);
        }
      })
      .catch(() => pasteNext(clipboardRef.current));
  }, [pasteObjects]);

  /** Duplicate is a paste of the current selection that never touches either clipboard. */
  const duplicate = useCallback(() => pasteObjects(selectedObjects, 1), [pasteObjects, selectedObjects]);

  return { copy, paste, duplicate, pasteObjects };
}
