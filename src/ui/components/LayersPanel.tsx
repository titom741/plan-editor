import { useState } from "react";
import { sortLayersByOrder } from "../../domain/layers";
import type { Background, Layer } from "../../domain/types";

interface LayersPanelProps {
  background: Background;
  isBackgroundSelected: boolean;
  layers: Layer[];
  /** How many objects sit on each layer, keyed by layer id — shown on the row and used to warn before a delete. */
  objectCounts: ReadonlyMap<string, number>;
  /** The layer new objects are created on. */
  activeLayerId: string | null;
  onSetActiveLayer: (layerId: string) => void;
  onToggleVisible: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
  onRenameLayer: (layerId: string, name: string) => void;
  onMoveLayer: (layerId: string, direction: -1 | 1) => void;
  onDeleteLayer: (layerId: string) => void;
  onAddLayer: () => void;
  onSelectBackground: () => void;
  onToggleBackgroundVisible: () => void;
  onToggleBackgroundLocked: () => void;
  onRequestImportBackground: () => void;
}

/**
 * Lists the project's layers, plus the background as a separate,
 * clickable-to-select row — the background is modeled independently of
 * `layers` (see `docs/ARCHITECTURE.md`) even though it is presented here
 * as if it were one. When there is no background yet, the row becomes an
 * "Importer" button.
 *
 * The bar reads left to right in *draw order*: the leftmost layer is
 * drawn first and therefore sits at the back. The background row comes
 * first because it is always behind everything.
 */
export function LayersPanel({
  background,
  isBackgroundSelected,
  layers,
  objectCounts,
  activeLayerId,
  onSetActiveLayer,
  onToggleVisible,
  onToggleLocked,
  onRenameLayer,
  onMoveLayer,
  onDeleteLayer,
  onAddLayer,
  onSelectBackground,
  onToggleBackgroundVisible,
  onToggleBackgroundLocked,
  onRequestImportBackground,
}: LayersPanelProps) {
  /** Id of the layer currently being renamed inline, with its in-progress text. */
  const [editing, setEditing] = useState<{ layerId: string; name: string } | null>(null);
  const orderedLayers = sortLayersByOrder(layers);

  const commitRename = () => {
    if (editing) onRenameLayer(editing.layerId, editing.name);
    setEditing(null);
  };

  return (
    <section className="layers-panel">
      <h2 className="panel__title">Calques</h2>
      <ul className="layers-panel__list">
        {background ? (
          <li
            className={`layers-panel__row layers-panel__row--background${isBackgroundSelected ? " is-selected" : ""}`}
          >
            <button
              type="button"
              className="layers-panel__icon-button"
              onClick={onToggleBackgroundVisible}
              title={background.visible ? "Masquer le fond de plan" : "Afficher le fond de plan"}
            >
              {background.visible ? "👁" : "🚫"}
            </button>
            <button
              type="button"
              className="layers-panel__icon-button"
              onClick={onToggleBackgroundLocked}
              title={background.locked ? "Déverrouiller le fond de plan" : "Verrouiller le fond de plan"}
            >
              {background.locked ? "🔒" : "🔓"}
            </button>
            <button type="button" className="layers-panel__name layers-panel__name-button" onClick={onSelectBackground}>
              🖼 Fond de plan
            </button>
          </li>
        ) : (
          <li className="layers-panel__row layers-panel__row--background">
            <button type="button" className="layers-panel__name layers-panel__name-button" onClick={onRequestImportBackground}>
              🖼 Importer un fond de plan…
            </button>
          </li>
        )}
        {orderedLayers.map((layer, index) => {
          const count = objectCounts.get(layer.id) ?? 0;
          const isActive = layer.id === activeLayerId;
          return (
            <li key={layer.id} className={`layers-panel__row${isActive ? " is-active" : ""}`}>
              <button
                type="button"
                className="layers-panel__icon-button"
                onClick={() => onToggleVisible(layer.id)}
                title={layer.visible ? "Masquer le calque" : "Afficher le calque"}
              >
                {layer.visible ? "👁" : "🚫"}
              </button>
              <button
                type="button"
                className="layers-panel__icon-button"
                onClick={() => onToggleLocked(layer.id)}
                title={layer.locked ? "Déverrouiller le calque" : "Verrouiller le calque"}
              >
                {layer.locked ? "🔒" : "🔓"}
              </button>
              {editing?.layerId === layer.id ? (
                <input
                  className="layers-panel__rename"
                  value={editing.name}
                  autoFocus
                  onChange={(e) => setEditing({ layerId: layer.id, name: e.target.value })}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    // Escape abandons the edit; the layer keeps the name it had.
                    else if (e.key === "Escape") setEditing(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="layers-panel__name layers-panel__name-button"
                  onClick={() => onSetActiveLayer(layer.id)}
                  onDoubleClick={() => setEditing({ layerId: layer.id, name: layer.name })}
                  title={
                    isActive
                      ? "Calque actif — les nouveaux objets y sont créés. Double-cliquez pour renommer."
                      : "Rendre actif (les nouveaux objets y seront créés). Double-cliquez pour renommer."
                  }
                >
                  {isActive ? "● " : ""}
                  {layer.name}
                  {count > 0 ? ` (${count})` : ""}
                </button>
              )}
              <button
                type="button"
                className="layers-panel__icon-button"
                onClick={() => onMoveLayer(layer.id, -1)}
                disabled={index === 0}
                title="Reculer d'un rang (dessiné plus tôt)"
              >
                ◀
              </button>
              <button
                type="button"
                className="layers-panel__icon-button"
                onClick={() => onMoveLayer(layer.id, 1)}
                disabled={index === orderedLayers.length - 1}
                title="Avancer d'un rang (dessiné plus tard)"
              >
                ▶
              </button>
              <button
                type="button"
                className="layers-panel__icon-button"
                onClick={() => onDeleteLayer(layer.id)}
                disabled={orderedLayers.length <= 1}
                title={
                  orderedLayers.length <= 1
                    ? "Impossible de supprimer le dernier calque"
                    : "Supprimer le calque (ses objets descendent d'un rang)"
                }
              >
                ✕
              </button>
            </li>
          );
        })}
        <li className="layers-panel__row layers-panel__row--add">
          <button type="button" className="layers-panel__name-button" onClick={onAddLayer} title="Ajouter un calque">
            ＋ Calque
          </button>
        </li>
      </ul>
    </section>
  );
}
