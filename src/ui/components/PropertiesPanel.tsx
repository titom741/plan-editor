import { useEffect, useRef, useState } from "react";
import { cropBackgroundByMargins, getBackgroundCropMargins, resizeBackgroundFromHeight, resizeBackgroundFromWidth } from "../../domain/background";
import { boundsSizeM } from "../../domain/bounds";
import type { BoundsM } from "../../domain/bounds";
import { formatMeters, getObjectDimensionSummary } from "../../domain/labels";
import { LABEL_DISPLAY_KEYS, LABEL_DISPLAY_LABELS, type LabelDisplay } from "../../domain/display";
import { rotateObjectToDeg } from "../../domain/geometry";
import { sortLayersByOrder } from "../../domain/layers";
import type { BackgroundImage, Calibration, Layer, PlanObject, PlanObjectPatch } from "../../domain/types";

interface PropertiesPanelProps {
  /** The single selected object, or `null` when nothing — or more than one thing — is selected. */
  selected: PlanObject | null;
  /** How many objects are selected. Above one, the panel shows a summary of the group instead of editable fields. */
  selectionCount: number;
  /** Extent of a multi-selection, for the summary. `null` for zero or one object. */
  selectionBounds: BoundsM | null;
  layers: Layer[];
  /** The layer the whole selection sits on, or `null` when it straddles several — the picker then shows no choice rather than a wrong one. */
  selectionLayerId: string | null;
  onAssignLayer: (layerId: string) => void;
  selectedBackground: BackgroundImage | null;
  /** Only read to describe the background's current size source (default guess vs. a known measured distance) — irrelevant to the object branch. */
  calibration: Calibration;
  /** True when the selection's layer (or the background) is locked — properties become read-only. */
  isLocked: boolean;
  /** The plan-wide label setting, shown as the baseline an object may override. */
  labelDisplay: LabelDisplay;
  onBeginEdit: () => void;
  onLiveUpdate: (patch: PlanObjectPatch) => void;
  onBackgroundLiveUpdate: (patch: Partial<BackgroundImage>) => void;
  onDelete: () => void;
  onDuplicate: () => void;
  onRequestReplaceBackground: () => void;
  onRequestCalibration: () => void;
  onRequestScaleCalibration: () => void;
  onCreateGroup: () => void;
  onUngroup: () => void;
  onTransformSelection: (scale: number, rotationDeg: number) => void;
  onDistributeSelection: (axis: "x" | "y") => void;
  onSaveComponent: () => void;
  /** Offered for rectangles only: a grid inside a polygon needs clipping, which is a different problem. */
  onSubdivide: () => void;
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
}

const TYPE_LABELS: Record<PlanObject["type"], string> = {
  rectangle: "Rectangle",
  circle: "Cercle",
  line: "Ligne",
  polygon: "Polygone",
  text: "Texte",
  image: "Image",
};

function formatForInput(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
}

interface NumberFieldProps {
  label: string;
  valueM: number;
  step?: number;
  disabled?: boolean;
  onCommit: (value: number) => void;
}

/**
 * A numeric input bound to a live domain value. While the user is
 * actively typing, the field keeps their in-progress text as local state
 * instead of reformatting it on every keystroke (which would fight the
 * cursor) — it only re-syncs from the domain value when not focused, e.g.
 * after an undo or a different object being selected.
 *
 * The resync happens by comparing `valueM` to the last value we synced
 * from, right in the render body (React's documented pattern for
 * "adjusting state when a prop changes") rather than in a `useEffect` —
 * a `useEffect` here would just be reacting to a prop with `setState`,
 * causing an extra, unnecessary render instead of adjusting eagerly
 * within the same one.
 */
function NumberField({ label, valueM, step = 0.1, disabled, onCommit }: NumberFieldProps) {
  const [text, setText] = useState(() => formatForInput(valueM));
  const [isFocused, setIsFocused] = useState(false);
  const [lastSyncedValueM, setLastSyncedValueM] = useState(valueM);

  if (!isFocused && valueM !== lastSyncedValueM) {
    setLastSyncedValueM(valueM);
    setText(formatForInput(valueM));
  }

  return (
    <label className="properties-panel__field">
      <span>{label}</span>
      <input
        type="number"
        step={step}
        value={text}
        disabled={disabled}
        onFocus={() => setIsFocused(true)}
        onBlur={() => setIsFocused(false)}
        onChange={(e) => {
          setText(e.target.value);
          const parsed = Number.parseFloat(e.target.value);
          if (Number.isFinite(parsed)) onCommit(parsed);
        }}
      />
    </label>
  );
}

export function PropertiesPanel({
  selected,
  selectionCount,
  selectionBounds,
  layers,
  selectionLayerId,
  onAssignLayer,
  selectedBackground,
  calibration,
  isLocked,
  labelDisplay,
  onBeginEdit,
  onLiveUpdate,
  onBackgroundLiveUpdate,
  onDelete,
  onDuplicate,
  onRequestReplaceBackground,
  onRequestCalibration,
  onRequestScaleCalibration,
  onCreateGroup,
  onUngroup,
  onTransformSelection,
  onDistributeSelection,
  onSaveComponent,
  onSubdivide,
  collapsed = false,
  onToggleCollapsed,
}: PropertiesPanelProps) {
  // Snapshots undo history at most once per focus session across all
  // fields: the first change after a field gains focus pushes the
  // "before" snapshot, subsequent keystrokes just live-update. Resets
  // whenever the selection changes (a different object, the background,
  // or nothing).
  const hasSnapshotRef = useRef(false);
  const selectionKey = selectedBackground ? "background" : selected?.id;
  useEffect(() => {
    hasSnapshotRef.current = false;
  }, [selectionKey]);

  const withSnapshot = (apply: () => void) => {
    if (!hasSnapshotRef.current) {
      onBeginEdit();
      hasSnapshotRef.current = true;
    }
    apply();
  };
  const applyPatch = (patch: PlanObjectPatch) => withSnapshot(() => onLiveUpdate(patch));
  const applyBackgroundPatch = (patch: Partial<BackgroundImage>) =>
    withSnapshot(() => onBackgroundLiveUpdate(patch));
  const resetSnapshotOnFocus = () => {
    hasSnapshotRef.current = false;
  };

  if (collapsed) return <aside className="properties-panel is-collapsed"><h2 className="panel__title"><button type="button" className="panel__collapse" onClick={onToggleCollapsed} aria-expanded={false} title="Déplier les propriétés">⚙</button></h2></aside>;

  if (selectedBackground) {
    const bg = selectedBackground;
    const cropMargins = getBackgroundCropMargins(bg);
    const updateCropMargin = (key: keyof typeof cropMargins, value: number) => applyBackgroundPatch(cropBackgroundByMargins(bg, { ...cropMargins, [key]: value }));
    return (
      <aside className="properties-panel">
        <h2 className="panel__title"><button type="button" className="panel__collapse" onClick={onToggleCollapsed} aria-expanded={true}>› Propriétés</button></h2>
        <div className="properties-panel__body">
          {isLocked && <p className="properties-panel__locked-notice">🔒 Fond de plan verrouillé — lecture seule.</p>}

          <div className="properties-panel__static">
            <span>Type</span>
            <span>Fond de plan</span>
          </div>

          <NumberField label="Position X" valueM={bg.xM} disabled={isLocked} onCommit={(v) => applyBackgroundPatch({ xM: v })} />
          <NumberField label="Position Y" valueM={bg.yM} disabled={isLocked} onCommit={(v) => applyBackgroundPatch({ yM: v })} />
          <NumberField
            label="Largeur"
            valueM={bg.widthM}
            disabled={isLocked}
            onCommit={(v) => applyBackgroundPatch(resizeBackgroundFromWidth(bg, Math.max(0.1, v)))}
          />
          <NumberField
            label="Hauteur"
            valueM={bg.heightM}
            disabled={isLocked}
            onCommit={(v) => applyBackgroundPatch(resizeBackgroundFromHeight(bg, Math.max(0.1, v)))}
          />
          <NumberField
            label="Rotation (°)"
            valueM={bg.rotationDeg}
            step={0.5}
            disabled={isLocked}
            onCommit={(v) => applyBackgroundPatch({ rotationDeg: v })}
          />

          <label className="properties-panel__field">
            <span>Opacité ({Math.round(bg.opacity * 100)} %)</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={bg.opacity}
              disabled={isLocked}
              onFocus={resetSnapshotOnFocus}
              onChange={(e) => applyBackgroundPatch({ opacity: Number.parseFloat(e.target.value) })}
            />
          </label>

          <NumberField
            label="Luminosité (-1 à 1)"
            valueM={bg.brightness}
            step={0.05}
            disabled={isLocked}
            onCommit={(v) => applyBackgroundPatch({ brightness: Math.max(-1, Math.min(1, v)) })}
          />
          <NumberField
            label="Contraste (-100 à 100)"
            valueM={bg.contrast}
            step={5}
            disabled={isLocked}
            onCommit={(v) => applyBackgroundPatch({ contrast: Math.max(-100, Math.min(100, v)) })}
          />
          <label className="tools-panel__toggle">
            <input
              type="checkbox"
              checked={bg.grayscale}
              disabled={isLocked}
              onFocus={resetSnapshotOnFocus}
              onChange={(e) => applyBackgroundPatch({ grayscale: e.target.checked })}
            />
            <span>Niveaux de gris</span>
          </label>
          <label className="tools-panel__toggle">
            <input type="checkbox" checked={bg.whiteRemoval} disabled={isLocked} onFocus={resetSnapshotOnFocus} onChange={(e) => applyBackgroundPatch({ whiteRemoval: e.target.checked })} />
            <span>Supprimer le blanc</span>
          </label>
          {bg.whiteRemoval && <NumberField label="Seuil du blanc (0–255)" valueM={bg.whiteThreshold} step={1} disabled={isLocked} onCommit={(v) => applyBackgroundPatch({ whiteThreshold: Math.max(0, Math.min(255, v)) })} />}

          <p className="properties-panel__hint">Recadrage non destructif en pourcentage de l’image source :</p>
          <div className="properties-panel__style-grid">
            <NumberField label="Gauche (%)" valueM={cropMargins.left} step={1} disabled={isLocked} onCommit={(v) => updateCropMargin("left", v)} />
            <NumberField label="Droite (%)" valueM={cropMargins.right} step={1} disabled={isLocked} onCommit={(v) => updateCropMargin("right", v)} />
            <NumberField label="Haut (%)" valueM={cropMargins.top} step={1} disabled={isLocked} onCommit={(v) => updateCropMargin("top", v)} />
            <NumberField label="Bas (%)" valueM={cropMargins.bottom} step={1} disabled={isLocked} onCommit={(v) => updateCropMargin("bottom", v)} />
          </div>

          <p className="properties-panel__hint">
            {calibration.source.type === "knownDistance"
              ? `Calibré : ${calibration.pixelsPerMeter.toFixed(1)} px image / m (mesuré : ${calibration.source.realDistanceM} m).`
              : "Taille approximative — cliquez « Calibrer » et indiquez une distance réelle connue sur le plan pour l'ajuster précisément."}
          </p>

          <div className="properties-panel__actions">
            <button type="button" className="properties-panel__button" onClick={onRequestCalibration} disabled={isLocked}>
              📏 Par distance
            </button>
            <button type="button" className="properties-panel__button" onClick={onRequestScaleCalibration} disabled={isLocked}>
              1:100 Par échelle
            </button>
            <button type="button" className="properties-panel__button" onClick={onRequestReplaceBackground} disabled={isLocked}>
              🖼 Remplacer
            </button>
            <button type="button" className="properties-panel__button" onClick={() => applyBackgroundPatch({ brightness: 0, contrast: 0, grayscale: false, whiteRemoval: false })} disabled={isLocked}>
              Réinitialiser l’image
            </button>
          </div>
          <div className="properties-panel__actions">
            <button type="button" className="properties-panel__delete" onClick={onDelete} disabled={isLocked}>
              🗑 Supprimer
            </button>
          </div>
        </div>
      </aside>
    );
  }

  const layerPicker = (disabled: boolean) => (
    <label className="properties-panel__field">
      <span>Calque</span>
      <select
        value={selectionLayerId ?? ""}
        disabled={disabled}
        onChange={(e) => onAssignLayer(e.target.value)}
      >
        {selectionLayerId === null && <option value="">— plusieurs calques —</option>}
        {sortLayersByOrder(layers).map((layer) => (
          <option key={layer.id} value={layer.id}>
            {layer.name}
            {layer.locked ? " 🔒" : ""}
          </option>
        ))}
      </select>
    </label>
  );

  if (selectionCount > 1) {
    const size = selectionBounds ? boundsSizeM(selectionBounds) : null;
    return (
      <aside className="properties-panel">
        <h2 className="panel__title"><button type="button" className="panel__collapse" onClick={onToggleCollapsed} aria-expanded={true}>› Propriétés</button></h2>
        <div className="properties-panel__body">
          <div className="properties-panel__static">
            <span>Sélection</span>
            <span>{selectionCount} objets</span>
          </div>
          {size && (
            <div className="properties-panel__static">
              <span>Emprise</span>
              <span>
                {formatMeters(size.widthM)} × {formatMeters(size.heightM)} m
              </span>
            </div>
          )}
          {isLocked && <p className="properties-panel__locked-notice">🔒 Sélection verrouillée — lecture seule.</p>}
          {layerPicker(isLocked)}
          <p className="properties-panel__hint">
            Déplacez le groupe en le faisant glisser ou avec les flèches (Maj = pas de 1 m). Les champs
            de position et de dimension reviennent dès qu&apos;un seul objet est sélectionné.
          </p>
          <div className="properties-panel__actions">
            <button type="button" className="properties-panel__button" onClick={() => onTransformSelection(0.9, 0)} disabled={isLocked}>−10 %</button>
            <button type="button" className="properties-panel__button" onClick={() => onTransformSelection(1.1, 0)} disabled={isLocked}>+10 %</button>
            <button type="button" className="properties-panel__button" onClick={() => onTransformSelection(1, -15)} disabled={isLocked}>↶ 15°</button>
            <button type="button" className="properties-panel__button" onClick={() => onTransformSelection(1, 15)} disabled={isLocked}>↷ 15°</button>
            <button type="button" className="properties-panel__button" onClick={() => onDistributeSelection("x")} disabled={isLocked || selectionCount < 3}>Espacer ↔</button>
            <button type="button" className="properties-panel__button" onClick={() => onDistributeSelection("y")} disabled={isLocked || selectionCount < 3}>Espacer ↕</button>
          </div>
          <div className="properties-panel__actions">
            <button type="button" className="properties-panel__button" onClick={onCreateGroup} disabled={isLocked}>Grouper…</button>
            <button type="button" className="properties-panel__button" onClick={onUngroup} disabled={isLocked}>Dégrouper</button>
            <button type="button" className="properties-panel__button" onClick={onSaveComponent}>Enregistrer comme modèle…</button>
            <button type="button" className="properties-panel__button" onClick={onDuplicate}>
              ⧉ Dupliquer
            </button>
          </div>
          <button type="button" className="properties-panel__delete" onClick={onDelete} disabled={isLocked}>
            🗑 Supprimer
          </button>
        </div>
      </aside>
    );
  }

  return (
    <aside className="properties-panel">
      <h2 className="panel__title"><button type="button" className="panel__collapse" onClick={onToggleCollapsed} aria-expanded={true}>› Propriétés</button></h2>
      {!selected && (
        <p className="properties-panel__empty">
          Sélectionnez un objet sur le plan. Maj + clic pour en ajouter, Maj + glisser pour encadrer
          plusieurs objets.
        </p>
      )}
      {selected && (
        <div className="properties-panel__body">
          {isLocked && <p className="properties-panel__locked-notice">🔒 Calque verrouillé — lecture seule.</p>}

          <label className="properties-panel__field">
            <span>Nom</span>
            <input
              type="text"
              value={selected.name}
              disabled={isLocked}
              onFocus={resetSnapshotOnFocus}
              onChange={(e) => applyPatch({ name: e.target.value })}
            />
          </label>

          <div className="properties-panel__static">
            <span>Type</span>
            <span>{TYPE_LABELS[selected.type]}</span>
          </div>
          {selected.groupName && (
            <div className="properties-panel__static"><span>Groupe</span><span>{selected.groupName}</span></div>
          )}

          <label className="properties-panel__field">
            <span>Catégorie</span>
            <input type="text" value={selected.category ?? ""} disabled={isLocked} onFocus={resetSnapshotOnFocus} onChange={(e) => applyPatch({ category: e.target.value || undefined })} />
          </label>
          <label className="properties-panel__field">
            <span>Référence</span>
            <input type="text" value={selected.reference ?? ""} disabled={isLocked} onFocus={resetSnapshotOnFocus} onChange={(e) => applyPatch({ reference: e.target.value || undefined })} />
          </label>
          <div className="properties-panel__style-grid">
            <NumberField label="Quantité" valueM={selected.quantity ?? 1} step={1} disabled={isLocked} onCommit={(value) => applyPatch({ quantity: Math.max(0.01, value) })} />
            <label className="properties-panel__field">
              <span>Unité</span>
              <input type="text" value={selected.unit ?? "u"} disabled={isLocked} onFocus={resetSnapshotOnFocus} onChange={(e) => applyPatch({ unit: e.target.value || undefined })} />
            </label>
          </div>

          {layerPicker(isLocked)}

          <fieldset className="properties-panel__display">
            <legend>Étiquette sur le plan</legend>
            <label className="tools-panel__toggle">
              <input
                type="checkbox"
                checked={selected.display !== undefined}
                disabled={isLocked}
                onChange={(event) =>
                  applyPatch({ display: event.target.checked ? { ...labelDisplay } : undefined })
                }
              />
              <span>Réglage propre à cet objet</span>
            </label>
            {LABEL_DISPLAY_KEYS.map((key) => (
              <label key={key} className="tools-panel__toggle">
                <input
                  type="checkbox"
                  checked={(selected.display ?? labelDisplay)[key]}
                  disabled={isLocked || selected.display === undefined}
                  onChange={(event) =>
                    applyPatch({
                      display: { ...(selected.display ?? labelDisplay), [key]: event.target.checked },
                    })
                  }
                />
                <span>{LABEL_DISPLAY_LABELS[key]}</span>
              </label>
            ))}
            {selected.display === undefined && (
              <p className="properties-panel__hint">
                Suit le réglage général du plan (panneau Outils).
              </p>
            )}
          </fieldset>

          {(selected.type === "rectangle" || selected.type === "image") && (
            <>
              <NumberField
                label="Largeur"
                valueM={selected.widthM}
                disabled={isLocked}
                onCommit={(value) => applyPatch({ widthM: Math.max(0.1, value) })}
              />
              <NumberField
                label="Hauteur"
                valueM={selected.heightM}
                disabled={isLocked}
                onCommit={(value) => applyPatch({ heightM: Math.max(0.1, value) })}
              />
            </>
          )}

          {selected.type === "circle" && (
            <NumberField
              label="Rayon"
              valueM={selected.radiusM}
              disabled={isLocked}
              onCommit={(value) => applyPatch({ radiusM: Math.max(0.05, value) })}
            />
          )}

          {selected.type === "text" && (
            <>
              <label className="properties-panel__field">
                <span>Texte</span>
                <input
                  type="text"
                  value={selected.text}
                  disabled={isLocked}
                  onFocus={resetSnapshotOnFocus}
                  onChange={(e) => applyPatch({ text: e.target.value })}
                />
              </label>
              <NumberField
                label="Taille du texte (m)"
                valueM={selected.fontSizeM}
                step={0.05}
                disabled={isLocked}
                onCommit={(value) => applyPatch({ fontSizeM: Math.max(0.05, value) })}
              />
              <label className="properties-panel__field"><span>Police</span><select value={selected.style?.fontFamily ?? "Arial"} disabled={isLocked} onChange={(e) => applyPatch({ style: { ...selected.style, fontFamily: e.target.value as "Arial" | "Helvetica" | "Georgia" | "Courier New" } })}><option>Arial</option><option>Helvetica</option><option>Georgia</option><option>Courier New</option></select></label>
              <div className="properties-panel__style-grid">
                <label className="tools-panel__toggle"><input type="checkbox" checked={selected.style?.fontWeight === "bold"} disabled={isLocked} onChange={(e) => applyPatch({ style: { ...selected.style, fontWeight: e.target.checked ? "bold" : "normal" } })} /><span>Gras</span></label>
                <label className="tools-panel__toggle"><input type="checkbox" checked={selected.style?.fontStyle === "italic"} disabled={isLocked} onChange={(e) => applyPatch({ style: { ...selected.style, fontStyle: e.target.checked ? "italic" : "normal" } })} /><span>Italique</span></label>
              </div>
              <label className="properties-panel__field"><span>Alignement</span><select value={selected.style?.textAlign ?? "left"} disabled={isLocked} onChange={(e) => applyPatch({ style: { ...selected.style, textAlign: e.target.value as "left" | "center" | "right" } })}><option value="left">Gauche</option><option value="center">Centré</option><option value="right">Droite</option></select></label>
            </>
          )}

          <div className="properties-panel__style-grid">
            {selected.type !== "line" && selected.type !== "text" && (
              <label className="properties-panel__field">
                <span>Remplissage</span>
                <input
                  type="color"
                  value={selected.style?.fill ?? (selected.type === "rectangle" ? "#dbeafe" : selected.type === "circle" ? "#dcfce7" : "#fef9c3")}
                  disabled={isLocked}
                  onFocus={resetSnapshotOnFocus}
                  onChange={(e) => applyPatch({ style: { ...selected.style, fill: e.target.value } })}
                />
              </label>
            )}
            <label className="properties-panel__field">
              <span>{selected.type === "text" ? "Couleur" : "Contour"}</span>
              <input
                type="color"
                value={selected.type === "text" ? (selected.style?.fill ?? "#0f172a") : (selected.style?.stroke ?? "#0f172a")}
                disabled={isLocked}
                onFocus={resetSnapshotOnFocus}
                onChange={(e) => applyPatch({ style: { ...selected.style, [selected.type === "text" ? "fill" : "stroke"]: e.target.value } })}
              />
            </label>
          </div>
          {selected.type !== "text" && (
            <>
              <NumberField
                label={selected.type === "line" ? "Largeur du tracé / câble (px)" : "Épaisseur du contour (px)"}
                valueM={selected.style?.strokeWidth ?? 2}
                step={0.5}
                disabled={isLocked}
                onCommit={(value) => applyPatch({ style: { ...selected.style, strokeWidth: Math.max(0.5, value) } })}
              />
              <label className="properties-panel__field">
                <span>Style du trait</span>
                <select value={selected.style?.dash ?? "solid"} disabled={isLocked} onFocus={resetSnapshotOnFocus} onChange={(e) => applyPatch({ style: { ...selected.style, dash: e.target.value as "solid" | "dashed" | "dotted" } })}>
                  <option value="solid">Continu</option><option value="dashed">Tirets</option><option value="dotted">Pointillé</option>
                </select>
              </label>
            </>
          )}
          {selected.type === "line" && (
            <>
              <div className="properties-panel__style-grid">
                <label className="tools-panel__toggle"><input type="checkbox" checked={selected.style?.arrowStart ?? false} disabled={isLocked} onChange={(e) => applyPatch({ style: { ...selected.style, arrowStart: e.target.checked } })} /><span>Flèche au début</span></label>
                <label className="tools-panel__toggle"><input type="checkbox" checked={selected.style?.arrowEnd ?? false} disabled={isLocked} onChange={(e) => applyPatch({ style: { ...selected.style, arrowEnd: e.target.checked } })} /><span>Flèche à la fin</span></label>
              </div>
              {selected.measurement && (
                <label className="properties-panel__field">
                  <span>Type de cote</span>
                  <select value={selected.measurement.kind} disabled={isLocked} onChange={(e) => applyPatch({ measurement: { ...selected.measurement, kind: e.target.value as "length" | "angle" } })}>
                    <option value="length">Longueur ouverte</option>
                    <option value="angle" disabled={selected.pointsM.length < 3}>Angle (3 points)</option>
                  </select>
                </label>
              )}
            </>
          )}
          <label className="properties-panel__field">
            <span>Opacité ({Math.round((selected.style?.opacity ?? 1) * 100)} %)</span>
            <input
              type="range"
              min={0.1}
              max={1}
              step={0.05}
              value={selected.style?.opacity ?? 1}
              disabled={isLocked}
              onFocus={resetSnapshotOnFocus}
              onChange={(e) => applyPatch({ style: { ...selected.style, opacity: Number.parseFloat(e.target.value) } })}
            />
          </label>

          {selected.type !== "circle" && (
            <NumberField
              label="Rotation (°)"
              valueM={selected.rotationDeg}
              step={1}
              disabled={isLocked}
              /* Rotates about the object's centre, like the handle does — typing an angle and dragging to it must not land in different places. */
              onCommit={(value) => applyPatch(rotateObjectToDeg(selected, value))}
            />
          )}

          {selected.type === "rectangle" && (
            <button type="button" className="properties-panel__button" onClick={onSubdivide} disabled={isLocked}>
              ▦ Subdiviser en stands…
            </button>
          )}

          {getObjectDimensionSummary(selected) && (
            <div className="properties-panel__static">
              <span>Dimensions</span>
              <span>{getObjectDimensionSummary(selected)}</span>
            </div>
          )}

          <div className="properties-panel__actions">
            <button type="button" className="properties-panel__button" onClick={onDuplicate} disabled={isLocked}>
              ⧉ Dupliquer
            </button>
          </div>
          <button type="button" className="properties-panel__delete" onClick={onDelete} disabled={isLocked}>
            🗑 Supprimer
          </button>
        </div>
      )}
    </aside>
  );
}
