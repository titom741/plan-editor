import { COMMANDS, COMMAND_GROUP_LABELS, type CommandGroup, type CommandId } from "../commands";

interface CommandMenuProps {
  group: CommandGroup;
  onRun: (id: CommandId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  /** Ids currently pinned to the top bar, shown as a marker so the two views agree. */
  pinnedIds: readonly CommandId[];
}

/**
 * One of the left-hand menus — "Fichier", "Projet".
 *
 * The toolbar used to carry all fifteen of these actions in one row, which
 * made none of them findable. Here they are grouped and named in full,
 * with the top bar left for the handful the user pins. A 📌 marks the ones
 * already up there, so the two views never contradict each other.
 *
 * Collapsed state is per-menu and lives in the parent, so a user who only
 * ever opens files can fold the rest away and keep the room for the plan.
 */
export function CommandMenu({ group, onRun, collapsed, onToggleCollapsed, pinnedIds }: CommandMenuProps) {
  const commands = COMMANDS.filter((command) => command.group === group);
  const pinned = new Set(pinnedIds);
  const title = COMMAND_GROUP_LABELS[group];

  return (
    <section className={`command-menu${collapsed ? " is-collapsed" : ""}`}>
      <h2 className="panel__title">
        <button
          type="button"
          className="panel__collapse"
          onClick={onToggleCollapsed}
          aria-expanded={!collapsed}
          title={collapsed ? `Déplier ${title}` : `Replier ${title}`}
        >
          {title} {collapsed ? "›" : "‹"}
        </button>
      </h2>
      {!collapsed && (
        <ul className="command-menu__list">
          {commands.map((command) => (
            <li key={command.id}>
              <button
                type="button"
                className="command-menu__button"
                onClick={() => onRun(command.id)}
                title={command.title}
              >
                <span aria-hidden="true">{command.icon}</span>
                <span className="command-menu__label">{command.label}</span>
                {pinned.has(command.id) && (
                  <span className="command-menu__pin" title="Épinglé dans la barre du haut" aria-label="épinglé">
                    📌
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
