import type { Background, Layer } from "../../domain/types";

interface LayersPanelProps {
  background: Background;
  layers: Layer[];
  onToggleVisible: (layerId: string) => void;
  onToggleLocked: (layerId: string) => void;
}

/**
 * Lists the project's layers, plus the background as a separate,
 * non-toggleable row — the background is modeled independently of
 * `layers` (see `docs/ARCHITECTURE.md`) even though it is presented here
 * as if it were one.
 */
export function LayersPanel({ background, layers, onToggleVisible, onToggleLocked }: LayersPanelProps) {
  const orderedLayers = [...layers].sort((a, b) => a.order - b.order);

  return (
    <section className="layers-panel">
      <h2 className="panel__title">Calques</h2>
      <ul className="layers-panel__list">
        <li className="layers-panel__row layers-panel__row--background">
          <span aria-hidden="true">🖼</span>
          <span className="layers-panel__name">{background ? "Fond de plan" : "Fond de plan (aucun)"}</span>
        </li>
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
