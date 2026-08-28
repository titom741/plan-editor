import {
  COMMANDS,
  COMMAND_GROUP_LABELS,
  DEFAULT_PINNED_COMMANDS,
  type CommandGroup,
  type CommandId,
} from "../commands";

interface ToolbarCustomizeDialogProps {
  pinnedIds: readonly CommandId[];
  onToggle: (id: CommandId) => void;
  onReset: () => void;
  onClose: () => void;
}

const GROUP_ORDER: CommandGroup[] = ["file", "project"];

/** Which actions get a button in the top bar. Everything stays reachable from the left-hand menus either way. */
export function ToolbarCustomizeDialog({
  pinnedIds,
  onToggle,
  onReset,
  onClose,
}: ToolbarCustomizeDialogProps) {
  const pinned = new Set(pinnedIds);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="customize-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="customize-title">Personnaliser la barre du haut</h2>
          <button type="button" className="dialog__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p className="properties-panel__hint">
          Cochez les actions à épingler. Les autres restent accessibles dans les menus de gauche.
          Annuler, Rétablir, Cadrer le plan et le zoom sont toujours présents.
        </p>

        {GROUP_ORDER.map((group) => (
          <fieldset key={group} className="customize-dialog__group">
            <legend>{COMMAND_GROUP_LABELS[group]}</legend>
            {COMMANDS.filter((command) => command.group === group).map((command) => (
              <label key={command.id} className="tools-panel__toggle" title={command.title}>
                <input
                  type="checkbox"
                  checked={pinned.has(command.id)}
                  onChange={() => onToggle(command.id)}
                />
                <span>
                  <span aria-hidden="true">{command.icon}</span> {command.label}
                </span>
              </label>
            ))}
          </fieldset>
        ))}

        <div className="dialog__actions">
          <button type="button" onClick={onReset}>
            Valeurs par défaut ({DEFAULT_PINNED_COMMANDS.length} boutons)
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
