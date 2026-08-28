import type { ShortcutAction, ShortcutMap } from "../shortcuts";
import { DEFAULT_SHORTCUTS, SHORTCUT_LABELS, keyboardEventSignature } from "../shortcuts";

interface ShortcutsDialogProps {
  shortcuts: ShortcutMap;
  onChange: (shortcuts: ShortcutMap) => void;
  onClose: () => void;
}

/**
 * Rebinding the editor's shortcuts.
 *
 * Each field is read-only and captures a key press rather than accepting
 * typed text: a shortcut is a key combination, not a string, and letting
 * someone type "Ctrl+Z" by hand would allow combinations the matcher can
 * never produce. The signature written into the map comes from the very
 * function that matches it at runtime, so what is recorded is exactly what
 * will fire.
 */
export function ShortcutsDialog({ shortcuts, onChange, onClose }: ShortcutsDialogProps) {
  const actions = Object.keys(SHORTCUT_LABELS) as ShortcutAction[];

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="shortcuts-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="shortcuts-title">Raccourcis clavier</h2>
          <button type="button" className="dialog__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="properties-panel__hint">
          Cliquez dans un champ puis pressez la nouvelle combinaison. Les flèches déplacent toujours la
          sélection de 0,1 m (Maj : 1 m).
        </p>

        {actions.map((action) => (
          <label key={action} className="calibration-dialog__field">
            <span>{SHORTCUT_LABELS[action]}</span>
            <input
              readOnly
              value={shortcuts[action]}
              onKeyDown={(event) => {
                event.preventDefault();
                const signature = keyboardEventSignature(event.nativeEvent);
                if (signature) onChange({ ...shortcuts, [action]: signature });
              }}
            />
          </label>
        ))}

        <div className="dialog__actions">
          <button type="button" onClick={() => onChange({ ...DEFAULT_SHORTCUTS })}>
            Valeurs par défaut
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
