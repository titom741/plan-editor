import { useEffect, useRef, useState } from "react";
import { getObjectDimensionSummary } from "../../domain/labels";
import type { PlanObject, PlanObjectPatch } from "../../domain/types";

interface PropertiesPanelProps {
  selected: PlanObject | null;
  /** True when the selected object's layer is locked — properties become read-only. */
  isLocked: boolean;
  onBeginEdit: () => void;
  onLiveUpdate: (patch: PlanObjectPatch) => void;
  onDelete: () => void;
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

export function PropertiesPanel({ selected, isLocked, onBeginEdit, onLiveUpdate, onDelete }: PropertiesPanelProps) {
  // Snapshots undo history at most once per focus session across all
  // fields: the first change after a field gains focus pushes the "before"
  // snapshot, subsequent keystrokes just live-update. Resets whenever a
  // different object is selected.
  const hasSnapshotRef = useRef(false);
  useEffect(() => {
    hasSnapshotRef.current = false;
  }, [selected?.id]);

  const applyPatch = (patch: PlanObjectPatch) => {
    if (!hasSnapshotRef.current) {
      onBeginEdit();
      hasSnapshotRef.current = true;
    }
    onLiveUpdate(patch);
  };
  const resetSnapshotOnFocus = () => {
    hasSnapshotRef.current = false;
  };

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
