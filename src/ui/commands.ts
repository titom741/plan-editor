/**
 * Every action the app offers outside the drawing tools, in one list.
 *
 * Before this, the same fifteen actions were hard-coded as fifteen
 * buttons in a single toolbar row, which is why the toolbar had become
 * unreadable. They are now data: the left-hand menus group them, the top
 * bar shows only the ones the user pinned, and the customisation dialog
 * offers exactly this list. Adding an action means adding one entry here
 * — nothing has to be kept in step by hand.
 *
 * `undo`, `redo` and `fitPlan` are deliberately *not* in this list: they
 * are permanent fixtures of the toolbar with their own enabled state, not
 * things to pin or unpin.
 */

export type CommandId =
  | "newProject"
  | "openProject"
  | "recentProjects"
  | "saveFile"
  | "saveFileAs"
  | "export"
  | "library"
  | "importObjectImage"
  | "schedule"
  | "exchange"
  | "comments"
  | "shortcuts"
  | "customizeToolbar"
  | "diagnostic";

/** Which left-hand menu a command lives in. */
export type CommandGroup = "file" | "project";

export const COMMAND_GROUP_LABELS: Record<CommandGroup, string> = {
  file: "Fichier",
  project: "Projet",
};

/** Shown in place of the name once a menu is folded to the rail's icon width. */
export const COMMAND_GROUP_ICONS: Record<CommandGroup, string> = {
  file: "📁",
  project: "🧩",
};

export interface CommandDefinition {
  id: CommandId;
  /** Wording in the menu, where there is room for it. */
  label: string;
  /** Wording on the pinned toolbar button, where there is not. */
  shortLabel: string;
  icon: string;
  group: CommandGroup;
  title: string;
}

export const COMMANDS: readonly CommandDefinition[] = [
  {
    id: "newProject",
    label: "Nouveau",
    shortLabel: "Nouveau",
    icon: "✦",
    group: "file",
    title: "Nouveau projet",
  },
  {
    id: "openProject",
    label: "Ouvrir…",
    shortLabel: "Ouvrir",
    icon: "📂",
    group: "file",
    title: "Ouvrir un projet (.kli)",
  },
  {
    id: "recentProjects",
    label: "Récents…",
    shortLabel: "Récents",
    icon: "🕘",
    group: "file",
    title: "Ouvrir un projet conservé dans ce navigateur",
  },
  {
    id: "saveFile",
    label: "Enregistrer",
    shortLabel: "Enregistrer",
    icon: "💾",
    group: "file",
    title: "Enregistrer le projet dans un fichier",
  },
  {
    id: "saveFileAs",
    label: "Enregistrer sous…",
    shortLabel: "Enreg. sous",
    icon: "🗂",
    group: "file",
    title: "Enregistrer sous un autre nom de fichier",
  },
  {
    id: "export",
    label: "Exporter…",
    shortLabel: "Exporter",
    icon: "🖨",
    group: "file",
    title: "Exporter le plan en PDF ou PNG, à l'échelle",
  },
  {
    id: "library",
    label: "Bibliothèque…",
    shortLabel: "Biblio.",
    icon: "🧰",
    group: "project",
    title: "Insérer un élément de la bibliothèque métier",
  },
  {
    id: "importObjectImage",
    label: "Image objet…",
    shortLabel: "Image",
    icon: "🖼",
    group: "project",
    title: "Importer une image ou un pictogramme comme objet",
  },
  {
    id: "schedule",
    label: "Nomenclature…",
    shortLabel: "Nomencl.",
    icon: "📋",
    group: "project",
    title: "Afficher les quantités du plan",
  },
  {
    id: "exchange",
    label: "Échanges vectoriels…",
    shortLabel: "Échanges",
    icon: "🔁",
    group: "project",
    title: "Exporter en SVG, DXF ou GeoJSON",
  },
  {
    id: "comments",
    label: "Commentaires…",
    shortLabel: "Comment.",
    icon: "💬",
    group: "project",
    title: "Commentaires persistants du projet",
  },
  {
    id: "shortcuts",
    label: "Raccourcis clavier…",
    shortLabel: "Raccourcis",
    icon: "⌨",
    group: "project",
    title: "Consulter et personnaliser les raccourcis clavier",
  },
  {
    id: "customizeToolbar",
    label: "Personnaliser la barre…",
    shortLabel: "Barre",
    icon: "⚙",
    group: "project",
    title: "Choisir les boutons épinglés dans la barre du haut",
  },
  {
    id: "diagnostic",
    label: "Rapport de diagnostic",
    shortLabel: "Diagnostic",
    icon: "🩺",
    group: "project",
    title: "Exporter un rapport technique local sans contenu du plan",
  },
];

const COMMANDS_BY_ID = new Map(COMMANDS.map((command) => [command.id, command]));

export function getCommand(id: CommandId): CommandDefinition | undefined {
  return COMMANDS_BY_ID.get(id);
}

/**
 * What the toolbar shows before anyone customises it: the handful of
 * actions a plan is actually made with, rather than everything that
 * exists.
 */
export const DEFAULT_PINNED_COMMANDS: readonly CommandId[] = ["saveFile", "export", "library"];

const STORAGE_KEY = "kl-implantation/toolbar/v1";

/**
 * Reads the pinned set, dropping ids this build no longer knows — a
 * toolbar preference written by a later version must not leave a dead
 * button behind.
 */
export function loadPinnedCommands(): CommandId[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return [...DEFAULT_PINNED_COMMANDS];
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [...DEFAULT_PINNED_COMMANDS];
    return parsed.filter(
      (id): id is CommandId => typeof id === "string" && COMMANDS_BY_ID.has(id as CommandId),
    );
  } catch {
    return [...DEFAULT_PINNED_COMMANDS];
  }
}

export function savePinnedCommands(ids: readonly CommandId[]): CommandId[] {
  const next = [...ids];
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    /* best effort — a full or disabled localStorage must not block the UI */
  }
  return next;
}

/** Adds or removes one id, keeping the canonical `COMMANDS` order so the toolbar never reshuffles itself. */
export function togglePinnedCommand(ids: readonly CommandId[], id: CommandId): CommandId[] {
  const wanted = new Set(ids);
  if (wanted.has(id)) wanted.delete(id);
  else wanted.add(id);
  return COMMANDS.filter((command) => wanted.has(command.id)).map((command) => command.id);
}
