import { useState, type FormEvent } from "react";
import {
  DEFAULT_STAND_GRID,
  defaultStandLabels,
  measureStandGrid,
  resizeStandLabels,
} from "../../domain/stands";
import type { StandGrid } from "../../domain/stands";
import { formatMeters } from "../../domain/labels";
import type { RectangleObject } from "../../domain/types";

interface StandsDialogProps {
  object: RectangleObject;
  onConfirm: (grid: StandGrid) => void;
  /** Takes the grid off the marquee entirely; only offered when it has one. */
  onRemove: () => void;
  onCancel: () => void;
}

/**
 * The stands inside a marquee.
 *
 * Laid out column by column because that is how a site is walked and how
 * an organiser reads their own list — the first column of pitches, then
 * the second. A flat list of eight boxes would need the user to hold the
 * grid in their head to know which box is which stand; here the shape of
 * the form is the shape of the plan.
 *
 * The cell size is computed live and the confirm button goes away the
 * moment the grid stops fitting. It matters more than it did when
 * KL-030 drew boxes: with text only, this number is the sole indication
 * that the stands actually fit inside the tent.
 */
export function StandsDialog({ object, onConfirm, onRemove, onCancel }: StandsDialogProps) {
  const existing = object.stands;
  const [columns, setColumns] = useState(String(existing?.columns ?? DEFAULT_STAND_GRID.columns));
  const [rows, setRows] = useState(String(existing?.rows ?? DEFAULT_STAND_GRID.rows));
  const [gapM, setGapM] = useState(String(existing?.gapM ?? DEFAULT_STAND_GRID.gapM));
  const [marginM, setMarginM] = useState(String(existing?.marginM ?? DEFAULT_STAND_GRID.marginM));
  /**
   * The labels, and the grid shape they are currently laid out for. The
   * second half is not redundant: resizing has to move each label to the
   * same (row, column) of the new grid, which needs the old dimensions —
   * padding a flat array would quietly rewrite the user's text into the
   * wrong squares.
   */
  const [labels, setLabels] = useState<string[]>(
    existing?.labels ?? defaultStandLabels(DEFAULT_STAND_GRID.columns, DEFAULT_STAND_GRID.rows),
  );
  const [shape, setShape] = useState({
    columns: existing?.columns ?? DEFAULT_STAND_GRID.columns,
    rows: existing?.rows ?? DEFAULT_STAND_GRID.rows,
  });

  const numbers = {
    columns: Number(columns),
    rows: Number(rows),
    gapM: Number(gapM),
    marginM: Number(marginM),
  };
  const size = measureStandGrid(object, numbers);

  /** Re-lays the labels as soon as a dimension parses to something usable. */
  const reshape = (next: { columns: number; rows: number }) => {
    if (!Number.isInteger(next.columns) || !Number.isInteger(next.rows)) return;
    if (next.columns < 1 || next.rows < 1) return;
    if (next.columns === shape.columns && next.rows === shape.rows) return;
    setLabels((current) => resizeStandLabels(current, shape, next));
    setShape(next);
  };

  const setLabelAt = (index: number, text: string) => {
    setLabels((current) => current.map((label, i) => (i === index ? text : label)));
  };

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!size) return;
    onConfirm({
      ...numbers,
      // The stored labels always match the grid being saved, whatever the
      // user typed into the number fields on the way here.
      labels: resizeStandLabels(labels, shape, numbers),
    });
  };

  const columnIndexes = Array.from({ length: shape.columns }, (_, index) => index);
  const rowIndexes = Array.from({ length: shape.rows }, (_, index) => index);

  return (
    <div className="calibration-dialog__backdrop">
      <form className="calibration-dialog calibration-dialog--wide" onSubmit={handleSubmit}>
        <h2 className="calibration-dialog__title">Stands de « {object.name} »</h2>
        <p className="calibration-dialog__text">
          Écrit un nom dans chaque case, à l’échelle et à sa place. Rien n’est créé sur le plan :
          c’est du texte, que l’on affiche ou masque avec la case « Stands » des étiquettes.
        </p>

        <div className="properties-panel__style-grid">
          <label className="calibration-dialog__field">
            <span>Colonnes</span>
            <input
              type="number"
              min="1"
              step="1"
              autoFocus
              value={columns}
              onChange={(event) => {
                setColumns(event.target.value);
                reshape({ columns: Number(event.target.value), rows: shape.rows });
              }}
            />
          </label>
          <label className="calibration-dialog__field">
            <span>Rangées</span>
            <input
              type="number"
              min="1"
              step="1"
              value={rows}
              onChange={(event) => {
                setRows(event.target.value);
                reshape({ columns: shape.columns, rows: Number(event.target.value) });
              }}
            />
          </label>
        </div>
        <div className="properties-panel__style-grid">
          <label className="calibration-dialog__field">
            <span>Allée entre cases (m)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={gapM}
              onChange={(event) => setGapM(event.target.value)}
            />
          </label>
          <label className="calibration-dialog__field">
            <span>Retrait au pourtour (m)</span>
            <input
              type="number"
              min="0"
              step="0.1"
              value={marginM}
              onChange={(event) => setMarginM(event.target.value)}
            />
          </label>
        </div>

        {size ? (
          <p className="calibration-dialog__text">
            <strong>{size.count}</strong> case{size.count > 1 ? "s" : ""} de{" "}
            <strong>
              {formatMeters(size.cellWidthM)} × {formatMeters(size.cellHeightM)} m
            </strong>
          </p>
        ) : (
          <p className="export-dialog__warning">
            Ce découpage ne tient pas dans l’objet. Réduisez le nombre de cases, l’allée ou le
            retrait.
          </p>
        )}

        <div className="stands-dialog__header">
          <span>Noms des stands</span>
          <span className="stands-dialog__header-actions">
            <button
              type="button"
              className="properties-panel__button"
              onClick={() => setLabels(defaultStandLabels(shape.columns, shape.rows))}
            >
              Remplir A1, A2…
            </button>
            <button
              type="button"
              className="properties-panel__button"
              onClick={() => setLabels(labels.map(() => ""))}
            >
              Tout effacer
            </button>
          </span>
        </div>
        <p className="properties-panel__hint">
          Une case laissée vide n’écrit rien — c’est ainsi qu’on réserve un coin technique ou une
          buvette.
        </p>

        <div className="stands-dialog__grid">
          {columnIndexes.map((column) => (
            <div key={column} className="stands-dialog__column">
              <span className="stands-dialog__column-title">Colonne {column + 1}</span>
              {rowIndexes.map((row) => {
                const index = row * shape.columns + column;
                return (
                  <input
                    key={row}
                    type="text"
                    className="stands-dialog__cell"
                    aria-label={`Colonne ${column + 1}, rangée ${row + 1}`}
                    value={labels[index] ?? ""}
                    onChange={(event) => setLabelAt(index, event.target.value)}
                  />
                );
              })}
            </div>
          ))}
        </div>

        <div className="calibration-dialog__actions">
          {existing && (
            <button type="button" className="properties-panel__button" onClick={onRemove}>
              Retirer les stands
            </button>
          )}
          <button type="button" className="properties-panel__button" onClick={onCancel}>
            Annuler
          </button>
          <button type="submit" className="calibration-dialog__confirm" disabled={!size}>
            Enregistrer
          </button>
        </div>
      </form>
    </div>
  );
}
