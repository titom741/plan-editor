import { useState, type FormEvent } from "react";
import { createId } from "../../domain/ids";
import type { Project } from "../../domain/types";

type Comment = NonNullable<Project["collaboration"]>["comments"][number];

/** Remembered so a user doesn't retype their name on every note. Per-browser, like every other preference here. */
const AUTHOR_STORAGE_KEY = "kl-implantation/comment-author";

function readStoredAuthor(): string {
  try {
    return localStorage.getItem(AUTHOR_STORAGE_KEY) ?? "";
  } catch {
    return "";
  }
}

interface CommentsDialogProps {
  project: Project;
  /** When exactly one object is selected, a new comment is attached to it. */
  selectedObjectId?: string;
  onChange: (comments: Comment[]) => void;
  onClose: () => void;
}

/**
 * Notes left on the plan — review remarks, open questions, things to check
 * on site. They travel inside the project file, so they reach whoever
 * opens it next; there is no server, so they never sync live.
 */
export function CommentsDialog({
  project,
  selectedObjectId,
  onChange,
  onClose,
}: CommentsDialogProps) {
  const comments = project.collaboration?.comments ?? [];
  const [text, setText] = useState("");
  const [author, setAuthor] = useState(readStoredAuthor);

  /** Objects are referenced by id in the model but shown by name — an id means nothing to the reader. */
  const objectNames = new Map(project.objects.map((object) => [object.id, object.name]));

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    const trimmedText = text.trim();
    if (!trimmedText) return;
    const trimmedAuthor = author.trim() || "Anonyme";
    try {
      localStorage.setItem(AUTHOR_STORAGE_KEY, trimmedAuthor);
    } catch {
      /* a full or disabled localStorage must not block the comment */
    }
    onChange([
      ...comments,
      {
        id: createId("comment"),
        author: trimmedAuthor,
        text: trimmedText,
        createdAt: new Date().toISOString(),
        resolved: false,
        ...(selectedObjectId ? { objectId: selectedObjectId } : {}),
      },
    ]);
    setText("");
  };

  const toggleResolved = (id: string) =>
    onChange(
      comments.map((candidate) =>
        candidate.id === id ? { ...candidate, resolved: !candidate.resolved } : candidate,
      ),
    );

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="comments-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="comments-title">Commentaires du projet</h2>
          <button type="button" className="dialog__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <form className="exchange-dialog__geo" onSubmit={handleSubmit}>
          <label className="calibration-dialog__field">
            <span>
              Nouveau commentaire
              {selectedObjectId
                ? ` sur « ${objectNames.get(selectedObjectId) ?? "la sélection"} »`
                : ""}
            </span>
            <textarea rows={3} value={text} onChange={(event) => setText(event.target.value)} />
          </label>
          <label className="calibration-dialog__field">
            <span>Auteur</span>
            <input type="text" value={author} onChange={(event) => setAuthor(event.target.value)} />
          </label>
          <div className="dialog__actions">
            <button type="submit" disabled={!text.trim()}>
              Ajouter
            </button>
          </div>
        </form>

        {comments.length === 0 ? (
          <p className="properties-panel__hint">Aucun commentaire.</p>
        ) : (
          <ul className="objects-list">
            {comments.map((comment) => (
              <li key={comment.id}>
                <div>
                  <strong>{comment.author}</strong> ·{" "}
                  {new Date(comment.createdAt).toLocaleString("fr-FR")}
                  {comment.objectId && (
                    <small> · {objectNames.get(comment.objectId) ?? "objet supprimé"}</small>
                  )}
                  <p className={comment.resolved ? "comment-resolved" : ""}>{comment.text}</p>
                </div>
                <button type="button" onClick={() => toggleResolved(comment.id)}>
                  {comment.resolved ? "Rouvrir" : "Résoudre"}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    onChange(comments.filter((candidate) => candidate.id !== comment.id))
                  }
                >
                  Supprimer
                </button>
              </li>
            ))}
          </ul>
        )}

        <p className="properties-panel__hint">
          Ces commentaires sont inclus dans le fichier KL et les versions locales. L’édition
          simultanée nécessite un serveur de synchronisation.
        </p>
      </section>
    </div>
  );
}
