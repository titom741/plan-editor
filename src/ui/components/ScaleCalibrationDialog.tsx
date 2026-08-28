import { useState, type FormEvent } from "react";

interface ScaleCalibrationDialogProps {
  onConfirm: (scale: number, dpi: number) => void;
  onCancel: () => void;
}

/** Calibration of a raster made from a paper plan whose scale and DPI are known. */
export function ScaleCalibrationDialog({ onConfirm, onCancel }: ScaleCalibrationDialogProps) {
  const [scaleText, setScaleText] = useState("100");
  const [dpiText, setDpiText] = useState("300");
  const scale = Number.parseFloat(scaleText);
  const dpi = Number.parseFloat(dpiText);
  const isValid = Number.isFinite(scale) && scale > 0 && Number.isFinite(dpi) && dpi > 0;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (isValid) onConfirm(scale, dpi);
  };

  return (
    <div className="calibration-dialog__backdrop">
      <form className="calibration-dialog" onSubmit={handleSubmit}>
        <h2 className="calibration-dialog__title">Calibrer par échelle connue</h2>
        <p className="calibration-dialog__text">
          Indiquez le dénominateur de l’échelle imprimée et la résolution utilisée pour numériser ou
          exporter le plan.
        </p>
        <label className="calibration-dialog__field">
          <span>Échelle (1 : …)</span>
          <input
            type="number"
            min={1}
            step={1}
            autoFocus
            value={scaleText}
            onChange={(event) => setScaleText(event.target.value)}
          />
        </label>
        <label className="calibration-dialog__field">
          <span>Résolution du document (DPI)</span>
          <input
            type="number"
            min={1}
            step={1}
            value={dpiText}
            onChange={(event) => setDpiText(event.target.value)}
          />
        </label>
        <p className="properties-panel__hint">
          Pour une photo ou une capture d’écran sans DPI fiable, utilisez plutôt la calibration par
          deux points.
        </p>
        <div className="calibration-dialog__actions">
          <button type="button" className="properties-panel__button" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="calibration-dialog__confirm" disabled={!isValid}>
            Valider
          </button>
        </div>
      </form>
    </div>
  );
}
