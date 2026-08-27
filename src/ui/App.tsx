import { useEffect, useState } from "react";
import { createDemoProject } from "../domain/project";
import type { Project } from "../domain/types";
import { loadAutosavedProject } from "../persistence/projectStorage";
import Editor from "./Editor";
import { describeParseError } from "./projectFileActions";
import "./App.css";

interface Restored {
  project: Project;
  /** Non-null when the previous session existed but couldn't be used — the user is told rather than quietly handed a blank plan. */
  notice: string | null;
}

/**
 * The app shell: it decides *which* project the editor opens with, then
 * gets out of the way.
 *
 * This exists as a separate component from `Editor` for one reason: the
 * saved project arrives asynchronously, and the editor's state (undo
 * history included) is seeded from its initial project. Mounting the
 * editor on a placeholder and swapping the project in afterwards would
 * mean a visible flash of the wrong plan, an undo stack straddling two
 * documents, and — worst — an autosave firing on the placeholder and
 * overwriting the very project still being read. Resolving first and
 * mounting once avoids all three.
 */
export default function App() {
  const [restored, setRestored] = useState<Restored | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void loadAutosavedProject().then((result) => {
      if (cancelled) return;
      switch (result.status) {
        case "loaded":
          setRestored({ project: result.file.project, notice: null });
          break;
        case "empty":
          // Nothing saved yet: first launch, or the user started a new
          // project. The demo plan doubles as an onboarding example.
          setRestored({ project: createDemoProject(), notice: null });
          break;
        case "unavailable":
          setRestored({
            project: createDemoProject(),
            notice:
              "La sauvegarde automatique est indisponible dans ce navigateur (navigation privée ou données de site désactivées). Pensez à enregistrer votre projet dans un fichier.",
          });
          break;
        case "corrupt":
          setRestored({
            project: createDemoProject(),
            notice: `Le projet enregistré n'a pas pu être rouvert : ${describeParseError(result.error)} Un nouveau projet a été ouvert ; l'enregistrement précédent sera remplacé à la prochaine modification.`,
          });
          break;
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // Adopt the load's notice once, into dismissible state.
  const [noticeAdopted, setNoticeAdopted] = useState(false);
  if (restored && !noticeAdopted) {
    setNoticeAdopted(true);
    setNotice(restored.notice);
  }

  if (!restored) {
    return (
      <div className="app-loading" role="status">
        Ouverture du projet…
      </div>
    );
  }

  return (
    <Editor
      initialProject={restored.project}
      autosaveEnabled
      restoreNotice={notice}
      onDismissRestoreNotice={() => setNotice(null)}
    />
  );
}
