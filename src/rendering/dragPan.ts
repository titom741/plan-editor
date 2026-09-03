/**
 * Turning a held-down drag into pan deltas.
 *
 * Small, but not incidental — it is the fix for a view that shot away
 * from the pointer. The canvas pans by making the Konva Stage draggable
 * and folding its displacement into the viewport's offset on every
 * `dragmove`, then snapping the node back to (0, 0) so the offset stays
 * the single source of truth for where the plan sits.
 *
 * The trap is what the node's position means. Konva computes it, every
 * move, as `pointer − offset`, where `offset` was measured *once* when
 * the gesture began. So it is the total displacement since the mouse went
 * down, not the step since the last event — and snapping the node back to
 * zero does not reset it, because the offset it is derived from is not
 * re-measured. Folding that number in as a step applies the whole journey
 * again at every frame: a straight, steady drag accelerates, and a slow
 * one that wanders is the erratic motion this replaces.
 *
 * The cure is to stop asking the node and track the pointer, which is
 * unambiguous: the step is where it is now minus where it was last time.
 * Kept here as pure functions so the arithmetic is tested without a
 * browser, a canvas or a mouse.
 */

export interface PointerSamplePx {
  x: number;
  y: number;
}

/** Where the pointer was at the previous move of the gesture in progress. `null` between gestures. */
export interface DragPanTracker {
  last: PointerSamplePx | null;
}

export interface DragPanStep {
  tracker: DragPanTracker;
  deltaXPx: number;
  deltaYPx: number;
}

/** A tracker with no gesture in progress — what a drag ends on, so the next one cannot inherit its last position. */
export function idleDragPan(): DragPanTracker {
  return { last: null };
}

/**
 * Advances the tracker with the pointer's current position and returns
 * the pan step it implies.
 *
 * The first sample of a gesture moves nothing: there is no previous
 * position to measure from, and inventing one from where the button went
 * down would jump the view by the few pixels Konva waits before calling
 * it a drag.
 */
export function stepDragPan(tracker: DragPanTracker, pointer: PointerSamplePx): DragPanStep {
  const next = { last: { x: pointer.x, y: pointer.y } };
  if (!tracker.last) return { tracker: next, deltaXPx: 0, deltaYPx: 0 };
  return {
    tracker: next,
    deltaXPx: pointer.x - tracker.last.x,
    deltaYPx: pointer.y - tracker.last.y,
  };
}
