import { useState, type FormEvent } from "react";
import { measureSubdivision, type SubdivisionOptions } from "../../domain/subdivision";
import { formatMeters } from "../../domain/labels";
import type { RectangleObject } from "../../domain/types";

interface SubdivideDialogProps {
  object: RectangleObject;
  onConfirm: (options: SubdivisionOptions) => void;
  onCancel: () => void;
}

/**
 * Cutting a surface into stands.
 *
 * The dialog's job is to show the one number the user is actually
 * choosing: "4 columns" means nothing on its own, "4,40 × 4,60 m each"
 * means everything. So the cell size is computed live and the confirm
 * button is disabled the moment the request stops fitting — no attempt
 * that produces a row of slivers ever reaches the plan.
 */
export function SubdivideDialog({ object, onConfirm, onCancel }: SubdivideDialogProps) {
  const [columns, setColumns] = useState("4");
  const [rows, setRows] = useState("2");
  const [gapM, setGapM] = useState("0.8");
  const [marginM, setMarginM] = useState("0");
  const [namePrefix, setNamePrefix] = useState("Stand");
  const [inheritStyle, setInheritStyle] = useState(true);

  const numbers = {
    columns: Number(columns),
    rows: Number(rows),
    gapM: Number(gapM),
    marginM: Number(marginM),
  };
  const size = measureSubdivision(object, numbers);

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!size) return;
    onConfirm({
      ...numbers,
      namePrefix,
      ...(inheritStyle && object.style ? { style: object.style } : {}),
    });
  };

  return (
    <div className="calibration-dialog__backdrop">
      <form className="calibration-dialog" onSubmit={handleSubmit}>
        <h2 className="calibration-dialog__title">Subdiviser « {object.name} »</h2>
        <p className="calibration-dialog__text">
          Crée un objet par case — nommé, sélectionnable et compté dans la nomenclature.
          L’objet d’origine est conservé.
        </p>

        <div className="properties-panel__style-grid">
          <label className="calibration-dialog__field">
            <span>Colonnes</span>
            <input type="number" min="1" step="1" autoFocus value={columns} onChange={(event) => setColumns(event.target.value)} />
          </label>
          <label className="calibration-dialog__field">
            <span>Rangées</span>
            <input type="number" min="1" step="1" value={rows} onChange={(event) => setRows(event.target.value)} />
          </label>
        </div>
        <div className="properties-panel__style-grid">
          <label className="calibration-dialog__field">
            <span>Allée entre cases (m)</span>
            <input type="number" min="0" step="0.1" value={gapM} onChange={(event) => setGapM(event.target.value)} />
          </label>
          <label className="calibration-dialog__field">
            <span>Retrait au pourtour (m)</span>
            <input type="number" min="0" step="0.1" value={marginM} onChange={(event) => setMarginM(event.target.value)} />
          </label>
        </div>
        <label className="calibration-dialog__field">
          <span>Préfixe des noms</span>
          <input type="text" value={namePrefix} onChange={(event) => setNamePrefix(event.target.value)} />
        </label>
        <label className="tools-panel__toggle">
          <input type="checkbox" checked={inheritStyle} onChange={(event) => setInheritStyle(event.target.checked)} />
          <span>Reprendre les couleurs de l’objet d’origine</span>
        </label>

        {size ? (
          <p className="calibration-dialog__text">
            <strong>{size.count}</strong> case{size.count > 1 ? "s" : ""} de{" "}
            <strong>
              {formatMeters(size.cellWidthM)} × {formatMeters(size.cellHeightM)} m
            </strong>{" "}
            — nommées {namePrefix.trim() ? `${namePrefix.trim()} A1` : "A1"}, {namePrefix.trim() ? `${namePrefix.trim()} A2` : "A2"}…
          </p>
        ) : (
          <p className="export-dialog__warning">
            Ce découpage ne tient pas dans l’objet. Réduisez le nombre de cases, l’allée ou le retrait.
          </p>
        )}

        <div className="calibration-dialog__actions">
          <button type="button" className="properties-panel__button" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="calibration-dialog__confirm" disabled={!size}>
            Subdiviser
          </button>
        </div>
      </form>
    </div>
  );
}
