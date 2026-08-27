import { useEffect, useRef, useState } from "react";
import { saveAutosavedProject } from "../../persistence/projectStorage";
import type { Project } from "../../domain/types";

/**
 * What the user is told about the state of their saved work. Kept as a
 * union rather than a couple of booleans so the impossible combinations
 * (saving *and* failed, dirty *and* just-saved) can't be represented.
 */
export type SaveStatus =
  | { state: "idle" }
  | { state: "dirty" }
  | { state: "saving" }
  | { state: "saved"; savedAt: string }
  | { state: "unavailable" }
  | { state: "error"; reason: "quota" | "failed" };

/** How long the project must sit unchanged before it's written. Long enough that a drag or a burst of typing is one save, short enough that a closed tab loses nothing meaningful. */
const DEBOUNCE_MS = 700;

/**
 * Writes the project to local storage shortly after it stops changing.
 *
 * Two details matter more than the debounce:
 *
 * - **`enabled` gates the very first save.** The editor mounts before the
 *   previously-saved project has finished loading, so an ungated autosave
 *   would write the *starting* project over the user's real one within a
 *   second of launch — destroying exactly what this mission exists to
 *   protect. The caller passes `enabled` only once the restore attempt has
 *   settled.
 * - **The first project it sees is not dirty.** At startup that project is
 *   either the one just restored from storage or the untouched starting
 *   one; writing it straight back would be a pointless write and would
 *   announce a save the user didn't make. Later replacements (opening a
 *   file, starting a new project) *are* saved, deliberately: that document
 *   is the working document from then on, and a reload should return to
 *   it.
 */
export function useAutosave(project: Project, enabled: boolean): SaveStatus {
  const [status, setStatus] = useState<SaveStatus>({ state: "idle" });
  const lastSavedProjectRef = useRef<Project | null>(null);

  useEffect(() => {
    if (!enabled) return;

    // Adopt whatever project is current when autosaving switches on (or
    // when the document is swapped out from under us) as the baseline,
    // without writing it.
    if (lastSavedProjectRef.current === null) {
      lastSavedProjectRef.current = project;
      return;
    }
    if (lastSavedProjectRef.current === project) return;

    setStatus({ state: "dirty" });
    let cancelled = false;
    const timer = setTimeout(() => {
      setStatus({ state: "saving" });
      void saveAutosavedProject(project).then((result) => {
        if (cancelled) return;
        switch (result.status) {
          case "saved":
            lastSavedProjectRef.current = project;
            setStatus({ state: "saved", savedAt: result.savedAt });
            break;
          case "unavailable":
            setStatus({ state: "unavailable" });
            break;
          case "quotaExceeded":
            setStatus({ state: "error", reason: "quota" });
            break;
          case "failed":
            setStatus({ state: "error", reason: "failed" });
            break;
        }
      });
    }, DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [project, enabled]);

  return status;
}
