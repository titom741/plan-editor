import { useEffect, useRef, useState } from "react";
import { resizeBackgroundFromHeight, resizeBackgroundFromWidth } from "../../domain/background";
import { getObjectDimensionSummary } from "../../domain/labels";
import type { BackgroundImage, PlanObject, PlanObjectPatch } from "../../domain/types";

interface PropertiesPanelProps {
  selected: PlanObject | null;
  selectedBackground: BackgroundImage | null;
  /** True when the selection's layer (or the background) is locked — properties become read-only. */
  isLocked: boolean;
  onBeginEdit: () => void;
  onLiveUpdate: (patch: PlanObjectPatch) => void;
  onBackgroundLiveUpdate: (patch: Partial<BackgroundImage>) => void;
  onDelete: () => void;
  onRequestReplaceBackground: () => void;
}

const TYPE_LABELS: Record<PlanObject["type"], string> = {
  rectangle: "Rectangle",
  circle: "Cercle",
  line: "Ligne",
  polygon: "Polygone",
  text: "Texte",
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
  selectedBackground,
  isLocked,
  onBeginEdit,
  onLiveUpdate,
  onBackgroundLiveUpdate,
  onDelete,
  onRequestReplaceBackground,
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

  if (selectedBackground) {
    const bg = selectedBackground;
    return (
      <aside className="properties-panel">
        <h2 className="panel__title">Propriétés</h2>
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

          <p className="properties-panel__hint">
            Taille approximative — la calibration précise arrivera dans une prochaine mission.
          </p>

          <div className="properties-panel__actions">
            <button type="button" className="properties-panel__button" onClick={onRequestReplaceBackground} disabled={isLocked}>
              🖼 Remplacer
            </button>
            <button type="button" className="properties-panel__delete" onClick={onDelete} disabled={isLocked}>
              🗑 Supprimer
            </button>
          </div>
        </div>
      </aside>
    );
  }

  return (
    <aside className="properties-panel">
      <h2 className="panel__title">Propriétés</h2>
      {!selected && <p className="properties-panel__empty">Sélectionnez un objet sur le plan.</p>}
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

          <NumberField
            label="Position X"
            valueM={selected.xM}
            disabled={isLocked}
            onCommit={(value) => applyPatch({ xM: value })}
          />
          <NumberField
            label="Position Y"
            valueM={selected.yM}
            disabled={isLocked}
            onCommit={(value) => applyPatch({ yM: value })}
          />

          {selected.type === "rectangle" && (
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
          )}

          {selected.type !== "circle" && (
            <NumberField
              label="Rotation (°)"
              valueM={selected.rotationDeg}
              step={1}
              disabled={isLocked}
              onCommit={(value) => applyPatch({ rotationDeg: value })}
            />
          )}

          {getObjectDimensionSummary(selected) && (
            <div className="properties-panel__static">
              <span>Dimensions</span>
              <span>{getObjectDimensionSummary(selected)}</span>
            </div>
          )}

          <button type="button" className="properties-panel__delete" onClick={onDelete} disabled={isLocked}>
            🗑 Supprimer
          </button>
        </div>
      )}
    </aside>
  );
}
