import type { PlanObject } from "./types";

/**
 * Which pieces of information an object writes on the plan.
 *
 * This is a *printing* decision more than a drawing one: the same plan
 * goes to a client (names only), to a fitter (names and dimensions) and
 * to a buyer (references and quantities), and redrawing it three times is
 * absurd. So the label is composed on demand from whatever is switched
 * on, and nothing about it is ever stored on the object.
 *
 * Settings live at two levels. The project carries the default, which is
 * what almost everyone wants to change; an individual object may carry a
 * full override, for the one crate that needs its reference called out on
 * a plan that otherwise shows none.
 */
export interface LabelDisplay {
  name: boolean;
  dimensions: boolean;
  reference: boolean;
  quantity: boolean;
  /** The stand names written inside a marquee. No effect on an object without a grid. */
  stands: boolean;
}

export const DEFAULT_LABEL_DISPLAY: LabelDisplay = {
  name: true,
  dimensions: true,
  reference: false,
  quantity: false,
  // On by default: someone who has laid out stands wants to see them.
  // The switch is there to take them off a client's copy, not to opt in.
  stands: true,
};

export const LABEL_DISPLAY_KEYS: readonly (keyof LabelDisplay)[] = [
  "name",
  "dimensions",
  "reference",
  "quantity",
  "stands",
];

export const LABEL_DISPLAY_LABELS: Record<keyof LabelDisplay, string> = {
  name: "Nom",
  dimensions: "Dimensions",
  reference: "Référence",
  quantity: "Quantité",
  stands: "Stands",
};

/** The settings that actually apply to one object: its own override if it has one, the project's default otherwise. */
export function resolveLabelDisplay(
  object: Pick<PlanObject, "display">,
  projectDefault: LabelDisplay,
): LabelDisplay {
  return object.display ?? projectDefault;
}

/** True when nothing at all would be drawn, so callers can skip the label node entirely. */
export function isLabelHidden(display: LabelDisplay): boolean {
  return LABEL_DISPLAY_KEYS.every((key) => !display[key]);
}
