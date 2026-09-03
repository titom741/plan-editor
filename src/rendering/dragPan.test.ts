import { describe, expect, it } from "vitest";
import { idleDragPan, stepDragPan, type DragPanTracker, type PointerSamplePx } from "./dragPan";
import { createViewport, panViewport, worldToScreen } from "./viewport";

/** Runs a whole gesture and returns the deltas it produced, in order. */
function drag(samples: readonly PointerSamplePx[]): { deltaXPx: number; deltaYPx: number }[] {
  let tracker: DragPanTracker = idleDragPan();
  return samples.map((sample) => {
    const step = stepDragPan(tracker, sample);
    tracker = step.tracker;
    return { deltaXPx: step.deltaXPx, deltaYPx: step.deltaYPx };
  });
}

describe("stepDragPan", () => {
  it("moves nothing on the first sample of a gesture", () => {
    expect(stepDragPan(idleDragPan(), { x: 120, y: 80 })).toMatchObject({
      deltaXPx: 0,
      deltaYPx: 0,
    });
  });

  it("reports the step since the previous sample, not the whole journey", () => {
    expect(
      drag([
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 20, y: 0 },
        { x: 30, y: 0 },
      ]),
    ).toEqual([
      { deltaXPx: 0, deltaYPx: 0 },
      { deltaXPx: 10, deltaYPx: 0 },
      { deltaXPx: 10, deltaYPx: 0 },
      { deltaXPx: 10, deltaYPx: 0 },
    ]);
  });

  it("keeps the plan under the pointer: the deltas sum to the distance dragged", () => {
    const samples = [
      { x: 100, y: 100 },
      { x: 140, y: 90 },
      { x: 175, y: 60 },
      { x: 175, y: 61 },
      { x: 210, y: 20 },
    ];
    const steps = drag(samples);
    const total = steps.reduce(
      (sum, step) => ({ x: sum.x + step.deltaXPx, y: sum.y + step.deltaYPx }),
      { x: 0, y: 0 },
    );
    expect(total).toEqual({ x: 110, y: -80 });

    // The same thing said where it is felt: a point of the plan ends the
    // gesture exactly under the pointer that dragged it.
    let viewport = createViewport(40);
    for (const step of steps) viewport = panViewport(viewport, step.deltaXPx, step.deltaYPx);
    const moved = worldToScreen({ xM: 3, yM: 2 }, viewport);
    const before = worldToScreen({ xM: 3, yM: 2 }, createViewport(40));
    expect(moved.x - before.x).toBe(samples[4]!.x - samples[0]!.x);
    expect(moved.y - before.y).toBe(samples[4]!.y - samples[0]!.y);
  });

  it("follows the pointer back when the drag reverses", () => {
    expect(
      drag([
        { x: 50, y: 50 },
        { x: 60, y: 55 },
        { x: 40, y: 45 },
      ]),
    ).toEqual([
      { deltaXPx: 0, deltaYPx: 0 },
      { deltaXPx: 10, deltaYPx: 5 },
      { deltaXPx: -20, deltaYPx: -10 },
    ]);
  });

  it("stands still while the pointer does", () => {
    expect(
      drag([
        { x: 20, y: 20 },
        { x: 20, y: 20 },
      ])[1],
    ).toEqual({ deltaXPx: 0, deltaYPx: 0 });
  });

  it("does not carry the previous gesture's position into the next one", () => {
    const first = stepDragPan(stepDragPan(idleDragPan(), { x: 0, y: 0 }).tracker, {
      x: 300,
      y: 300,
    });
    expect(first.deltaXPx).toBe(300);
    // The button came up: the tracker goes idle, and a fresh press far
    // away starts from nothing instead of jumping the width of the gap.
    expect(stepDragPan(idleDragPan(), { x: 10, y: 10 })).toMatchObject({
      deltaXPx: 0,
      deltaYPx: 0,
    });
  });

  it("leaves the tracker it was given untouched", () => {
    const tracker = idleDragPan();
    stepDragPan(tracker, { x: 5, y: 5 });
    expect(tracker.last).toBeNull();
  });
});
