import type { ElectricalRole } from "../../domain/electrical";
import { useMemo, useState } from "react";
import { getObjectDimensionSummary } from "../../domain/labels";
import { sortLayersByOrder } from "../../domain/layers";
import type { Layer, PlanObject } from "../../domain/types";

/** An electrical object is listed as what it is, with its tool's icon, not as the shape it is drawn with (KL-047). */
const ELECTRICAL_ROLE_ICONS: Record<ElectricalRole, string> = {
  source: "⏻",
  board: "▣",
  cable: "⌇",
  strip: "⋮",
  load: "⊗",
};

const TYPE_ICONS: Record<PlanObject["type"], string> = {
  rectangle: "▭",
  circle: "◯",
  line: "／",
  polygon: "⬠",
  text: "T",
  image: "🖼",
  symbol: "★",
};

interface ElementsPanelProps {
  layers: readonly Layer[];
  objects: readonly PlanObject[];
  selectedIds: readonly string[];
  onSelectObject: (id: string, additive: boolean) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}

/**
 * Every element of the plan, grouped by layer.
 *
 * The layers panel along the bottom can already expand a layer's contents,
 * but it is one row high and horizontal — fine for finding *a* layer,
 * useless for reading a plan of two hundred objects. This panel is the
 * inventory view: it is tall, it filters, and it says what each object is
 * and how big, which is what you need when you are checking that
 * everything that should be on the plan is on it.
 *
 * Selection goes through the editor's own handler, so clicking here and
 * clicking on the canvas are the same act — including `Shift` to extend,
 * and the group-follows-member rule.
 */
export function ElementsPanel({
  layers,
  objects,
  selectedIds,
  onSelectObject,
  collapsed,
  onToggleCollapsed,
}: ElementsPanelProps) {
  const [query, setQuery] = useState("");

  const selected = new Set(selectedIds);
  const normalizedQuery = query.trim().toLocaleLowerCase("fr");

  const groups = useMemo(() => {
    const byLayer = new Map<string, PlanObject[]>();
    for (const object of objects) {
      const bucket = byLayer.get(object.layerId);
      if (bucket) bucket.push(object);
      else byLayer.set(object.layerId, [object]);
    }
    // Drawing order, so the list reads the way the plan is stacked.
    return sortLayersByOrder(layers).map((layer) => ({
      layer,
      objects: byLayer.get(layer.id) ?? [],
    }));
  }, [layers, objects]);

  const matches = (object: PlanObject) =>
    normalizedQuery.length === 0 ||
    object.name.toLocaleLowerCase("fr").includes(normalizedQuery) ||
    (object.reference?.toLocaleLowerCase("fr").includes(normalizedQuery) ?? false) ||
    (object.category?.toLocaleLowerCase("fr").includes(normalizedQuery) ?? false);

  const visibleGroups = groups
    .map((group) => ({ ...group, objects: group.objects.filter(matches) }))
    .filter((group) => group.objects.length > 0 || normalizedQuery.length === 0);

  const total = objects.length;

  return (
    <aside className={`elements-panel${collapsed ? " is-collapsed" : ""}`}>
      <h2 className="panel__title">
        <button
          type="button"
          className="panel__collapse"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? "Déplier la liste des éléments" : "Replier la liste des éléments"}
        >
          {collapsed ? "‹" : "›"} Éléments {total > 0 && !collapsed ? `(${total})` : ""}
        </button>
      </h2>

      {!collapsed && (
        <div className="elements-panel__body">
          <label className="properties-panel__field">
            <span className="visually-hidden">Filtrer les éléments</span>
            <input
              type="search"
              value={query}
              placeholder="Filtrer par nom, référence…"
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          {total === 0 && (
            <p className="properties-panel__empty">Le plan ne contient encore aucun élément.</p>
          )}

          {visibleGroups.map(({ layer, objects: layerObjects }) => (
            <section key={layer.id} className="elements-panel__group">
              <h3 className="elements-panel__group-title">
                {layer.visible ? "" : "🚫 "}
                {layer.locked ? "🔒 " : ""}
                {layer.name}
                <span className="elements-panel__count">{layerObjects.length}</span>
              </h3>
              {layerObjects.length === 0 ? (
                <p className="elements-panel__empty-group">Calque vide</p>
              ) : (
                <ul className="elements-panel__list">
                  {layerObjects.map((object) => {
                    const dimensions = getObjectDimensionSummary(object);
                    return (
                      <li key={object.id}>
                        <button
                          type="button"
                          className={`elements-panel__item${selected.has(object.id) ? " is-selected" : ""}`}
                          aria-pressed={selected.has(object.id)}
                          title={dimensions ? `${object.name} — ${dimensions}` : object.name}
                          onClick={(event) =>
                            onSelectObject(
                              object.id,
                              event.shiftKey || event.metaKey || event.ctrlKey,
                            )
                          }
                        >
                          <span aria-hidden="true" className="elements-panel__icon">
                            {object.electrical
                              ? ELECTRICAL_ROLE_ICONS[object.electrical.role]
                              : TYPE_ICONS[object.type]}
                          </span>
                          <span className="elements-panel__name">{object.name}</span>
                          {dimensions && <span className="elements-panel__size">{dimensions}</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          ))}

          {normalizedQuery.length > 0 && visibleGroups.length === 0 && (
            <p className="properties-panel__empty">Aucun élément ne correspond à « {query} ».</p>
          )}
        </div>
      )}
    </aside>
  );
}
