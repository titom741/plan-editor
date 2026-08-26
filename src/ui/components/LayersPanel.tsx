import type { Background, Layer } from "../../domain/types";

interface LayersPanelProps {
  background: Background;
  isBackgroundSelected: boolean;
  layers: Layer[];
  onToggleVisible: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
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
 */
export function LayersPanel({
  background,
  isBackgroundSelected,
  layers,
  onToggleVisible,
  onToggleLocked,
  onSelectBackground,
  onToggleBackgroundVisible,
  onToggleBackgroundLocked,
  onRequestImportBackground,
}: LayersPanelProps) {
  const orderedLayers = [...layers].sort((a, b) => a.order - b.order);

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
        {orderedLayers.map((layer) => (
          <li key={layer.id} className="layers-panel__row">
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
            <span className="layers-panel__name">{layer.name}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
