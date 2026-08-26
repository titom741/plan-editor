/**
 * A small, generic undo/redo stack — "past / present / future", the
 * standard shape for linear undo history. Deliberately generic (`<T>`) and
 * framework-free: it knows nothing about `Project` or React, so it's
 * reusable and trivially testable in isolation. See
 * `src/ui/hooks/useProjectHistory.ts` for how the editor binds it to
 * `Project` state, and `docs/ARCHITECTURE.md` for why this lives in its
 * own top-level module rather than inside `domain/` or `ui/`.
 */
export interface HistoryState<T> {
  past: T[];
  present: T;
  future: T[];
}

/** Past entries beyond this are dropped, oldest first — keeps memory bounded for a long editing session. */
const MAX_HISTORY_ENTRIES = 100;

export function createHistory<T>(initial: T): HistoryState<T> {
  return { past: [], present: initial, future: [] };
}

/**
 * Pushes the CURRENT present onto `past` as an undo point, then sets
 * `nextPresent` as the new present. Clears `future` — the standard
 * "a new action invalidates redo" rule.
 */
export function pushHistory<T>(state: HistoryState<T>, nextPresent: T): HistoryState<T> {
  const past = [...state.past, state.present].slice(-MAX_HISTORY_ENTRIES);
  return { past, present: nextPresent, future: [] };
}

/**
 * Replaces `present` in place, touching neither `past` nor `future`. For
 * live/intermediate updates within a gesture whose "before" snapshot was
 * already pushed via `pushHistory` — see `useProjectHistory.beginEdit`.
 */
export function replacePresent<T>(state: HistoryState<T>, nextPresent: T): HistoryState<T> {
  return { ...state, present: nextPresent };
}

export function undo<T>(state: HistoryState<T>): HistoryState<T> {
  const lastIndex = state.past.length - 1;
  if (lastIndex < 0) return state;
  const previous = state.past[lastIndex];
  if (previous === undefined) return state;
  return {
    past: state.past.slice(0, lastIndex),
    present: previous,
    future: [state.present, ...state.future],
  };
}

export function redo<T>(state: HistoryState<T>): HistoryState<T> {
  const [next, ...rest] = state.future;
  if (next === undefined) return state;
  return {
    past: [...state.past, state.present],
    present: next,
    future: rest,
  };
}

export function canUndo<T>(state: HistoryState<T>): boolean {
  return state.past.length > 0;
}

export function canRedo<T>(state: HistoryState<T>): boolean {
  return state.future.length > 0;
}
