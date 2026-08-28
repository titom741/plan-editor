import { useMemo, useState } from "react";
import { MATERIAL_CATALOG, type CatalogItem } from "../../domain/catalog";
import type { ComponentTemplate } from "../../persistence/componentStorage";
import {
  addCustomCatalogItem,
  deleteCustomCatalogItem,
  loadCustomCatalog,
  loadHiddenCatalogIds,
  toggleHiddenCatalogId,
  updateCustomCatalogItem,
} from "../../persistence/catalogStorage";
import { CatalogItemForm } from "./CatalogItemForm";
import { formatAreaM2, formatLengthM, polygonAreaM2, polylineLengthM } from "../../domain/measure";

interface LibraryDialogProps {
  onInsert: (item: CatalogItem) => void;
  onClose: () => void;
  templates: readonly ComponentTemplate[];
  onInsertTemplate: (template: ComponentTemplate) => void;
  onDeleteTemplate: (id: string) => void;
}

/**
 * The material library: the built-in catalogue, the user's own items, and
 * the components they have saved from the plan.
 *
 * Everything here is *insertable*; the customisation is deliberately kept
 * to a mode of the same dialog rather than a separate one, because the
 * moment you want a material of your own is the moment you have just
 * failed to find it in this list.
 */

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

export function LibraryDialog({
  onInsert,
  onClose,
  templates,
  onInsertTemplate,
  onDeleteTemplate,
}: LibraryDialogProps) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("Toutes");
  const [customItems, setCustomItems] = useState<CatalogItem[]>(() => loadCustomCatalog());
  const [hiddenIds, setHiddenIds] = useState<ReadonlySet<string>>(() => loadHiddenCatalogIds());
  /** `null` = browsing, `"new"` = creating, otherwise the id being edited. */
  const [editing, setEditing] = useState<string | null>(null);
  /** While on, hidden built-ins are shown so they can be brought back. */
  const [managing, setManaging] = useState(false);

  const customIds = new Set(customItems.map((item) => item.id));
  const allItems = useMemo(() => [...customItems, ...MATERIAL_CATALOG], [customItems]);
  const categories = useMemo(
    () => ["Toutes", ...new Set(allItems.map((item) => item.category))],
    [allItems],
  );
  const filtered = allItems.filter((item) => {
    if (!managing && hiddenIds.has(item.id)) return false;
    const matchesCategory = category === "Toutes" || item.category === category;
    const haystack = `${item.name} ${item.reference} ${item.category}`.toLocaleLowerCase("fr");
    return matchesCategory && haystack.includes(query.trim().toLocaleLowerCase("fr"));
  });
  const editedItem =
    editing && editing !== "new" ? customItems.find((item) => item.id === editing) : undefined;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog library-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="library-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="library-title">Bibliothèque de matériels</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>
        <div className="library-dialog__filters">
          <input
            autoFocus
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Rechercher un matériel…"
            aria-label="Rechercher"
          />
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            aria-label="Catégorie"
          >
            {categories.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </div>
        {editing !== null ? (
          <CatalogItemForm
            item={editedItem}
            onCancel={() => setEditing(null)}
            onSubmit={(draft) => {
              setCustomItems(
                editing === "new"
                  ? addCustomCatalogItem(draft)
                  : updateCustomCatalogItem(editing, draft),
              );
              setEditing(null);
            }}
          />
        ) : (
          <div className="library-dialog__grid">
            {templates
              .filter(
                (template) =>
                  category === "Toutes" &&
                  template.name
                    .toLocaleLowerCase("fr")
                    .includes(query.trim().toLocaleLowerCase("fr")),
              )
              .map((template) => (
                <div key={template.id} className="library-card">
                  <button
                    type="button"
                    className="library-card__template"
                    onClick={() => onInsertTemplate(template)}
                  >
                    <strong>{template.name}</strong>
                    <span>Composant personnel</span>
                    <small>{template.objects.length} objet(s)</small>
                  </button>
                  <button
                    type="button"
                    className="dialog__close"
                    onClick={() => onDeleteTemplate(template.id)}
                    aria-label={`Supprimer ${template.name}`}
                  >
                    🗑
                  </button>
                </div>
              ))}
            {filtered.map((item) => (
              <div
                key={item.id}
                className={`library-card${hiddenIds.has(item.id) ? " is-hidden-item" : ""}`}
              >
                <button
                  type="button"
                  className="library-card__insert"
                  onClick={() => onInsert(item)}
                >
                  <span
                    className="library-card__preview"
                    style={{ background: item.style.fill, borderColor: item.style.stroke }}
                    aria-hidden="true"
                  />
                  <strong>{item.name}</strong>
                  <span>
                    {item.category} · {item.reference}
                  </span>
                  <small>{describeCatalogSize(item)}</small>
                </button>
                {managing && (
                  <div className="library-card__actions">
                    <button
                      type="button"
                      onClick={() => setHiddenIds(toggleHiddenCatalogId(item.id))}
                      title={
                        hiddenIds.has(item.id)
                          ? "Rétablir dans la bibliothèque"
                          : "Masquer de la bibliothèque"
                      }
                    >
                      {hiddenIds.has(item.id) ? "👁" : "🚫"}
                    </button>
                    {customIds.has(item.id) && (
                      <>
                        <button
                          type="button"
                          onClick={() => setEditing(item.id)}
                          title="Modifier ce matériel"
                        >
                          ✎
                        </button>
                        <button
                          type="button"
                          onClick={() => setCustomItems(deleteCustomCatalogItem(item.id))}
                          title="Supprimer ce matériel"
                        >
                          🗑
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            ))}
            {filtered.length === 0 && <p>Aucun matériel ne correspond à la recherche.</p>}
          </div>
        )}
        {editing === null && (
          <div className="dialog__actions">
            <button type="button" onClick={() => setEditing("new")}>
              ＋ Nouveau matériel…
            </button>
            <button type="button" onClick={() => setManaging((value) => !value)}>
              {managing
                ? "Terminer"
                : `Masquer / rétablir des matériels${hiddenIds.size > 0 ? ` (${hiddenIds.size})` : ""}`}
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
