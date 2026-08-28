import { useMemo, useState } from "react";
import { MATERIAL_CATALOG, type CatalogItem } from "../../domain/catalog";
import type { ComponentTemplate } from "../../persistence/componentStorage";
import { formatAreaM2, formatLengthM, polygonAreaM2, polylineLengthM } from "../../domain/measure";

interface LibraryDialogProps {
  onInsert: (item: CatalogItem) => void;
  onClose: () => void;
  templates: readonly ComponentTemplate[];
  onInsertTemplate: (template: ComponentTemplate) => void;
  onDeleteTemplate: (id: string) => void;
}

/**
 * A one-line size for a catalogue card. Line and polygon items (an arc, a
 * sector) have no width or height at all, and printing their absent fields
 * produced "undefined × undefined m" on every such card — so each shape
 * states the measurement it actually has.
 */
function describeCatalogSize(item: CatalogItem): string {
  switch (item.shape) {
    case "circle":
      return `Ø ${((item.radiusM ?? 0) * 2).toLocaleString("fr-FR")} m`;
    case "rectangle":
      return `${(item.widthM ?? 0).toLocaleString("fr-FR")} × ${(item.heightM ?? 0).toLocaleString("fr-FR")} m`;
    case "line":
      return `${formatLengthM(polylineLengthM(item.pointsM ?? []))} de tracé`;
    case "polygon":
      return `${formatAreaM2(polygonAreaM2(item.pointsM ?? []))}`;
  }
}

export function LibraryDialog({ onInsert, onClose, templates, onInsertTemplate, onDeleteTemplate }: LibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Toutes");
  const categories = useMemo(() => ["Toutes", ...new Set(MATERIAL_CATALOG.map((item) => item.category))], []);
  const filtered = MATERIAL_CATALOG.filter((item) => {
    const matchesCategory = category === "Toutes" || item.category === category;
    const haystack = `${item.name} ${item.reference} ${item.category}`.toLocaleLowerCase("fr");
    return matchesCategory && haystack.includes(query.trim().toLocaleLowerCase("fr"));
  });

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog library-dialog" role="dialog" aria-modal="true" aria-labelledby="library-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog__header">
          <h2 id="library-title">Bibliothèque de matériels</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">✕</button>
        </div>
        <div className="library-dialog__filters">
          <input autoFocus type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher un matériel…" aria-label="Rechercher" />
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Catégorie">
            {categories.map((value) => <option key={value}>{value}</option>)}
          </select>
        </div>
        <div className="library-dialog__grid">
          {templates.filter((template) => category === "Toutes" && template.name.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr"))).map((template) => (
            <div key={template.id} className="library-card"><button type="button" className="library-card__template" onClick={() => onInsertTemplate(template)}><strong>{template.name}</strong><span>Composant personnel</span><small>{template.objects.length} objet(s)</small></button><button type="button" className="dialog__close" onClick={() => onDeleteTemplate(template.id)} aria-label={`Supprimer ${template.name}`}>🗑</button></div>
          ))}
          {filtered.map((item) => (
            <button key={item.id} type="button" className="library-card" onClick={() => onInsert(item)}>
              <span className="library-card__preview" style={{ background: item.style.fill, borderColor: item.style.stroke }} aria-hidden="true" />
              <strong>{item.name}</strong>
              <span>{item.category} · {item.reference}</span>
              <small>{describeCatalogSize(item)}</small>
            </button>
          ))}
          {filtered.length === 0 && <p>Aucun matériel ne correspond à la recherche.</p>}
        </div>
      </section>
    </div>
  );
}
