import { useEffect, useState } from "react";
import { deleteStoredProject, duplicateStoredProject, listProjectVersions, listStoredProjects, loadProjectVersion, loadStoredProject, renameStoredProject, saveProjectVersion, type StoredProjectSummary, type StoredVersionSummary } from "../../persistence/projectStorage";
import type { Project } from "../../domain/types";

interface ProjectsDialogProps { currentProject: Project; onOpen: (project: Project) => void; onClose: () => void }

function dateLabel(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Date inconnue" : date.toLocaleString("fr-FR", { dateStyle: "medium", timeStyle: "short" });
}

export function ProjectsDialog({ currentProject, onOpen, onClose }: ProjectsDialogProps) {
  const [projects, setProjects] = useState<StoredProjectSummary[] | null>(null);
  const [versions, setVersions] = useState<StoredVersionSummary[]>([]);
  const [versionsFor, setVersionsFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { void listStoredProjects().then(setProjects); }, []);
  const open = async (id: string) => {
    const result = await loadStoredProject(id);
    if (result.status === "loaded") onOpen(result.file.project);
    else setError("Ce projet local ne peut pas être ouvert.");
  };
  const remove = async (project: StoredProjectSummary) => {
    if (!window.confirm(`Supprimer la copie locale de « ${project.name} » ? Cette action n'efface pas les fichiers .kl.json déjà exportés.`)) return;
    if (await deleteStoredProject(project.id)) setProjects((current) => current?.filter((item) => item.id !== project.id) ?? []);
    else setError("La suppression locale a échoué.");
  };
  const rename = async (project: StoredProjectSummary) => {
    const name = window.prompt("Nouveau nom du projet", project.name)?.trim();
    if (!name || name === project.name) return;
    if (await renameStoredProject(project.id, name)) setProjects((current) => current?.map((item) => item.id === project.id ? { ...item, name } : item) ?? []);
    else setError("Le renommage a échoué.");
  };
  const duplicate = async (project: StoredProjectSummary) => {
    const copy = await duplicateStoredProject(project.id);
    if (!copy) { setError("La duplication a échoué."); return; }
    setProjects(await listStoredProjects());
  };
  const toggleVersions = async (projectId: string) => {
    if (versionsFor === projectId) { setVersionsFor(null); return; }
    setVersionsFor(projectId);
    setVersions(await listProjectVersions(projectId));
  };
  const createVersion = async () => {
    const result = await saveProjectVersion(currentProject);
    if (result.status !== "saved") { setError("La création de la version a échoué."); return; }
    setVersionsFor(currentProject.id);
    setVersions(await listProjectVersions(currentProject.id));
  };
  const restoreVersion = async (key: string) => {
    const result = await loadProjectVersion(key);
    if (result.status !== "loaded") { setError("Cette version ne peut pas être restaurée."); return; }
    const restored = { ...result.file.project, updatedAt: new Date().toISOString() };
    onOpen(restored);
  };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog projects-dialog" role="dialog" aria-modal="true" aria-labelledby="projects-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog__header"><h2 id="projects-title">Projets récents</h2><button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">✕</button></div>
        {error && <p className="projects-dialog__error" role="alert">{error}</p>}
        <div className="projects-dialog__toolbar"><button type="button" onClick={() => void createVersion()}>Créer une version datée du projet ouvert</button></div>
        {projects === null ? <p>Chargement…</p> : projects.length === 0 ? <p>Aucun projet n’est encore enregistré dans ce navigateur. Une première modification déclenchera l’autosauvegarde.</p> : (
          <ul className="projects-dialog__list">{projects.map((project) => (
            <li key={project.id} className={project.id === currentProject.id ? "is-current" : ""}>
              <div><strong>{project.name}</strong>{project.id === currentProject.id && <span> · ouvert</span>}<small>{project.location || "Sans lieu"} · {project.objectCount} élément(s) · {dateLabel(project.savedAt)}</small>
                {versionsFor === project.id && <div className="projects-dialog__versions">{versions.length === 0 ? <small>Aucune version datée.</small> : versions.map((version) => <button key={version.key} type="button" onClick={() => void restoreVersion(version.key)}>Restaurer {dateLabel(version.savedAt)} · {version.objectCount} élément(s){version.automatic ? " · automatique" : " · manuelle"}</button>)}</div>}
              </div>
              <div className="projects-dialog__actions">
                <button type="button" onClick={() => void open(project.id)} disabled={project.id === currentProject.id}>Ouvrir</button>
                <button type="button" onClick={() => void rename(project)} disabled={project.id === currentProject.id}>Renommer</button>
                <button type="button" onClick={() => void duplicate(project)}>Dupliquer</button>
                <button type="button" onClick={() => void toggleVersions(project.id)}>Versions</button>
                <button type="button" onClick={() => void remove(project)} disabled={project.id === currentProject.id} aria-label={`Supprimer ${project.name}`}>🗑</button>
              </div>
            </li>
          ))}</ul>
        )}
        <div className="dialog__actions"><button type="button" onClick={onClose}>Fermer</button></div>
      </section>
    </div>
  );
}
