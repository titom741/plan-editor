import { useState, type FormEvent } from "react";
import type { CatalogItem, CatalogShape } from "../../domain/catalog";
import type { CatalogItemDraft } from "../../persistence/catalogStorage";

const SHAPE_LABELS: Record<CatalogShape, string> = {
  rectangle: "Rectangle",
  circle: "Cercle",
  line: "Ligne",
  polygon: "Polygone",
};

interface CatalogItemFormProps {
  /** The item being edited, or `undefined` when creating one. */
  item?: CatalogItem;
  onSubmit: (draft: CatalogItemDraft) => void;
  onCancel: () => void;
}

/**
 * Creating or editing a material of one's own.
 *
 * Only rectangles and circles are offered: a line or polygon item needs a
 * point list, which is drawn on the plan and saved as a *component*
 * (the "Enregistrer comme modèle…" path), not typed into a form. Offering
 * the shape here with no way to give it a geometry would be a dead end.
 */
export function CatalogItemForm({ item, onSubmit, onCancel }: CatalogItemFormProps) {
  const [name, setName] = useState(item?.name ?? "");
  const [category, setCategory] = useState(item?.category ?? "Personnel");
  const [reference, setReference] = useState(item?.reference ?? "");
  const [shape, setShape] = useState<CatalogShape>(item?.shape === "circle" ? "circle" : "rectangle");
  const [widthM, setWidthM] = useState(String(item?.widthM ?? 1));
  const [heightM, setHeightM] = useState(String(item?.heightM ?? 1));
  const [radiusM, setRadiusM] = useState(String(item?.radiusM ?? 0.5));
  const [unit, setUnit] = useState(item?.unit ?? "u");
  const [fill, setFill] = useState(item?.style.fill ?? "#dbeafe");
  const [stroke, setStroke] = useState(item?.style.stroke ?? "#2563eb");

  const width = Number(widthM);
  const height = Number(heightM);
  const radius = Number(radiusM);
  const sizeIsValid =
    shape === "circle" ? Number.isFinite(radius) && radius > 0 : Number.isFinite(width) && width > 0 && Number.isFinite(height) && height > 0;
  const isValid = name.trim().length > 0 && sizeIsValid;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValid) return;
    onSubmit({
      name: name.trim(),
      category: category.trim() || "Personnel",
      reference: reference.trim(),
      shape,
      ...(shape === "circle" ? { radiusM: radius } : { widthM: width, heightM: height }),
      unit: unit.trim() || "u",
      style: { fill, stroke, strokeWidth: 0.08, opacity: 0.9 },
    });
  };

  return (
    <form className="exchange-dialog__geo" onSubmit={handleSubmit}>
      <label className="calibration-dialog__field">
        <span>Désignation</span>
        <input type="text" autoFocus value={name} onChange={(event) => setName(event.target.value)} />
      </label>
      <div className="properties-panel__style-grid">
        <label className="calibration-dialog__field">
          <span>Catégorie</span>
          <input type="text" value={category} onChange={(event) => setCategory(event.target.value)} />
        </label>
        <label className="calibration-dialog__field">
          <span>Référence</span>
          <input type="text" value={reference} onChange={(event) => setReference(event.target.value)} />
        </label>
      </div>
      <div className="properties-panel__style-grid">
        <label className="calibration-dialog__field">
          <span>Forme</span>
          <select value={shape} onChange={(event) => setShape(event.target.value as CatalogShape)}>
            <option value="rectangle">{SHAPE_LABELS.rectangle}</option>
            <option value="circle">{SHAPE_LABELS.circle}</option>
          </select>
        </label>
        <label className="calibration-dialog__field">
          <span>Unité</span>
          <input type="text" value={unit} onChange={(event) => setUnit(event.target.value)} />
        </label>
      </div>
      {shape === "circle" ? (
        <label className="calibration-dialog__field">
          <span>Rayon (m)</span>
          <input type="number" step="0.01" min="0.01" value={radiusM} onChange={(event) => setRadiusM(event.target.value)} />
        </label>
      ) : (
        <div className="properties-panel__style-grid">
          <label className="calibration-dialog__field">
            <span>Largeur (m)</span>
            <input type="number" step="0.01" min="0.01" value={widthM} onChange={(event) => setWidthM(event.target.value)} />
          </label>
          <label className="calibration-dialog__field">
            <span>Hauteur (m)</span>
            <input type="number" step="0.01" min="0.01" value={heightM} onChange={(event) => setHeightM(event.target.value)} />
          </label>
        </div>
      )}
      <div className="properties-panel__style-grid">
        <label className="calibration-dialog__field">
          <span>Remplissage</span>
          <input type="color" value={fill} onChange={(event) => setFill(event.target.value)} />
        </label>
        <label className="calibration-dialog__field">
          <span>Contour</span>
          <input type="color" value={stroke} onChange={(event) => setStroke(event.target.value)} />
        </label>
      </div>
      <div className="dialog__actions">
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" disabled={!isValid}>
          {item ? "Enregistrer" : "Ajouter à la bibliothèque"}
        </button>
      </div>
    </form>
  );
}
