import { useState } from "react";

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
export function NumberField({ label, valueM, step = 0.1, disabled, onCommit }: NumberFieldProps) {
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
