import { useState, type FormEvent } from "react";
import type { Layer, ObjectStyle } from "../../domain/types";

/**
 * The two layer operations that need more than a click.
 *
 * Both replace a `window.prompt` chain. Deleting a populated layer used to
 * ask the user to *type* the destination layer's name, which could fail on
 * a typo ("Calque de destination introuvable") and, worse, accepted the
 * word "SUPPRIMER" to destroy every object on it — a hundred objects one
 * misreading away. A `<select>` of the layers that actually exist and an
 * explicit radio for the destructive branch make both the choice and its
 * consequence visible before it happens.
 *
 * Same overlay shape as `CalibrationDialog`: no dialog library for
 * something this small.
 */

interface DeleteLayerDialogProps {
  layer: Layer;
  /** The layers the objects may be moved to — never includes the one being deleted. */
  destinations: readonly Layer[];
  objectCount: number;
  onConfirm: (choice: { destinationLayerId: string } | { deleteObjects: true }) => void;
  onCancel: () => void;
}

export function DeleteLayerDialog({
  layer,
  destinations,
  objectCount,
  onConfirm,
  onCancel,
}: DeleteLayerDialogProps) {
  const [mode, setMode] = useState<"move" | "delete">("move");
  const [destinationLayerId, setDestinationLayerId] = useState(destinations[0]?.id ?? "");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (mode === "delete") onConfirm({ deleteObjects: true });
    else if (destinationLayerId) onConfirm({ destinationLayerId });
  };

  return (
    <div className="calibration-dialog__backdrop">
      <form className="calibration-dialog" onSubmit={handleSubmit}>
        <h2 className="calibration-dialog__title">Supprimer le calque « {layer.name} »</h2>
        <p className="calibration-dialog__text">
          Ce calque contient <strong>{objectCount} objet{objectCount > 1 ? "s" : ""}</strong>. Que
          faut-il en faire ?
        </p>
        <label className="calibration-dialog__field calibration-dialog__field--inline">
          <input
            type="radio"
            name="delete-layer-mode"
            checked={mode === "move"}
            onChange={() => setMode("move")}
          />
          <span>Les déplacer vers un autre calque</span>
        </label>
        <label className="calibration-dialog__field">
          <span>Calque de destination</span>
          <select
            value={destinationLayerId}
            disabled={mode !== "move"}
            onChange={(event) => setDestinationLayerId(event.target.value)}
          >
            {destinations.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.name}
              </option>
            ))}
          </select>
        </label>
        <label className="calibration-dialog__field calibration-dialog__field--inline">
          <input
            type="radio"
            name="delete-layer-mode"
            checked={mode === "delete"}
            onChange={() => setMode("delete")}
          />
          <span>Les supprimer définitivement</span>
        </label>
        <div className="calibration-dialog__actions">
          <button type="button" className="properties-panel__button" onClick={onCancel}>
            Annuler
          </button>
          <button
            type="submit"
            className={mode === "delete" ? "properties-panel__delete" : "calibration-dialog__confirm"}
            disabled={mode === "move" && !destinationLayerId}
          >
            {mode === "delete" ? `Supprimer le calque et ses ${objectCount} objets` : "Supprimer le calque"}
          </button>
        </div>
      </form>
    </div>
  );
}

interface LayerStyleDialogProps {
  layer: Layer;
  onConfirm: (style: ObjectStyle) => void;
  onCancel: () => void;
}

/** The style new objects drawn on this layer start from. Colour pickers, not hex typed into a prompt. */
export function LayerStyleDialog({ layer, onConfirm, onCancel }: LayerStyleDialogProps) {
  const [fill, setFill] = useState(layer.defaultStyle?.fill ?? "#dbeafe");
  const [stroke, setStroke] = useState(layer.defaultStyle?.stroke ?? "#2563eb");

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onConfirm({ ...layer.defaultStyle, fill, stroke });
  };

  return (
    <div className="calibration-dialog__backdrop">
      <form className="calibration-dialog" onSubmit={handleSubmit}>
        <h2 className="calibration-dialog__title">Style par défaut — « {layer.name} »</h2>
        <p className="calibration-dialog__text">
          S&apos;applique aux objets créés ensuite sur ce calque ; les objets existants ne changent pas.
        </p>
        <label className="calibration-dialog__field">
          <span>Remplissage</span>
          <input type="color" value={fill} onChange={(event) => setFill(event.target.value)} />
        </label>
        <label className="calibration-dialog__field">
          <span>Contour</span>
          <input type="color" value={stroke} onChange={(event) => setStroke(event.target.value)} />
        </label>
        <div className="calibration-dialog__actions">
          <button type="button" className="properties-panel__button" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="calibration-dialog__confirm">
            Appliquer
          </button>
        </div>
      </form>
    </div>
  );
}
