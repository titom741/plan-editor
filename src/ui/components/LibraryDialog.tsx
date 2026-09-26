import { useMemo, useState } from "react";
import { MATERIAL_CATALOG, groupCatalog, type CatalogItem } from "../../domain/catalog";
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
  // What the search and the hidden items leave, before the category is
  // applied: the tabs count *this*, so they say where the matches are.
  const searched = allItems.filter((item) => {
    if (!managing && hiddenIds.has(item.id)) return false;
    const haystack = `${item.name} ${item.reference} ${item.category}`.toLocaleLowerCase("fr");
    return haystack.includes(query.trim().toLocaleLowerCase("fr"));
  });
  const sections = groupCatalog(searched);
  const shown =
    category === "Toutes" ? sections : sections.filter((section) => section.category === category);
  const filtered = shown.flatMap((section) => section.groups.flatMap((group) => group.items));
  // Saved components have no category of their own: they show under
  // "Toutes" only, first, since they are what this user built.
  const matchingTemplates = templates.filter(
    (template) =>
      category === "Toutes" &&
      template.name.toLocaleLowerCase("fr").includes(query.trim().toLocaleLowerCase("fr")),
  );
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
        </div>
        {editing === null && (
          <div className="library-dialog__categories" role="tablist" aria-label="Catégories">
            {[
              { category: "Toutes", count: searched.length },
              // The tab of a category the search has emptied stays if it
              // is the one open, so the user isn't moved without asking.
              ...groupCatalog(allItems.filter((item) => managing || !hiddenIds.has(item.id)))
                .map((section) => ({
                  category: section.category,
                  count: sections.find((s) => s.category === section.category)?.count ?? 0,
                }))
                .filter((entry) => entry.count > 0 || entry.category === category),
            ].map((entry) => (
              <button
                key={entry.category}
                type="button"
                role="tab"
                aria-selected={category === entry.category}
                className={`library-dialog__category${category === entry.category ? " is-active" : ""}`}
                onClick={() => setCategory(entry.category)}
              >
                {entry.category} <span>{entry.count}</span>
              </button>
            ))}
          </div>
        )}
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
        ) : null}
        {editing === null && (
          <div className="library-dialog__sections">
            {matchingTemplates.length > 0 && (
              <section className="library-dialog__section">
                <h3 className="library-dialog__section-title">
                  Composants personnels <span>{matchingTemplates.length}</span>
                </h3>
                <div className="library-dialog__grid">
                  {matchingTemplates.map((template) => (
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
                </div>
              </section>
            )}
            {shown.map((section) => (
              <section key={section.category} className="library-dialog__section">
                {category === "Toutes" && (
                  <h3 className="library-dialog__section-title">
                    {section.category} <span>{section.count}</span>
                  </h3>
                )}
                {section.groups.map((group) => (
                  <div key={group.label ?? "all"}>
                    {group.label && <h4 className="library-dialog__group-title">{group.label}</h4>}
                    <div className="library-dialog__grid">
                      {group.items.map((item) => (
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
                              style={{
                                background: item.style.fill,
                                borderColor: item.style.stroke,
                              }}
                              aria-hidden="true"
                            />
                            <strong>{item.name}</strong>
                            {/* The section already names the category. */}
                            <span>{item.reference}</span>
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
                    </div>
                  </div>
                ))}
              </section>
            ))}
            {filtered.length === 0 && matchingTemplates.length === 0 && (
              <p>Aucun matériel ne correspond à la recherche.</p>
            )}
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
