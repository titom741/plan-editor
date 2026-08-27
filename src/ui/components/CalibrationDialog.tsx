import { useState, type FormEvent } from "react";

interface CalibrationDialogProps {
  /** The segment's length in the project's current (possibly still-approximate) world scale — shown for context only, never sent anywhere. */
  measuredDistanceM: number;
  onConfirm: (realDistanceM: number) => void;
  onCancel: () => void;
}

/**
 * The second half of the calibration gesture: `PlanCanvas` already
 * collected two clicked points and reports their distance in the
 * project's *current* (possibly wrong) scale; this dialog asks what that
 * segment actually measures in real life. `App.tsx` turns the two numbers
 * into a `Calibration` (see `domain/calibration.ts`) and commits it.
 *
 * A plain fixed-position overlay rather than a portal/library dialog —
 * consistent with this app's "no extra dependency for something this
 * small" stance (see `useHtmlImage`). It intentionally blocks all canvas
 * interaction while open: the calibration tool stays active underneath,
 * and `PlanCanvas` ignores further clicks once two points are picked, but
 * the backdrop also stops stray clicks from ever reaching the canvas or
 * the other panels until the user confirms or cancels.
 */
export function CalibrationDialog({ measuredDistanceM, onConfirm, onCancel }: CalibrationDialogProps) {
  const [text, setText] = useState("");
  const parsed = Number.parseFloat(text);
  const isValid = Number.isFinite(parsed) && parsed > 0;

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (isValid) onConfirm(parsed);
  };

  return (
    <div className="calibration-dialog__backdrop">
      <form className="calibration-dialog" onSubmit={handleSubmit}>
        <h2 className="calibration-dialog__title">Calibrer le fond de plan</h2>
        <p className="calibration-dialog__text">
          Segment mesuré sur le plan (échelle actuelle, approximative) :{" "}
          <strong>{measuredDistanceM.toFixed(2)} m</strong>. Quelle est sa distance réelle ?
        </p>
        <label className="calibration-dialog__field">
          <span>Distance réelle (m)</span>
          <input
            type="number"
            step={0.01}
            min={0.01}
            autoFocus
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </label>
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
