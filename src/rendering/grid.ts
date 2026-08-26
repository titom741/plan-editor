import type { Viewport } from "./viewport";
import { getEffectivePixelsPerMeter, screenToWorld, worldToScreen } from "./viewport";

/** A grid line in screen pixels, ready to hand to Konva. */
export interface GridLine {
  points: [number, number, number, number];
  /** True for the line running through the world origin (0m). */
  isAxis: boolean;
}

export interface GridResult {
  spacingM: number;
  vertical: GridLine[];
  horizontal: GridLine[];
}

/** "Nice" grid spacings, in meters, to choose between as the user zooms. */
const NICE_STEPS_M = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500, 1000];

/**
 * Picks a grid spacing (in meters) so that, at the viewport's current zoom,
 * grid lines land at least `targetPx` apart on screen. This is what keeps
 * the grid computed from the metric system rather than a fixed pixel step.
 */
export function pickGridSpacingM(viewport: Viewport, targetPx = 60): number {
  const scale = getEffectivePixelsPerMeter(viewport);
  for (const step of NICE_STEPS_M) {
    if (step * scale >= targetPx) return step;
  }
  return NICE_STEPS_M[NICE_STEPS_M.length - 1] ?? 1000;
}

/**
 * Computes the grid lines visible in a `screenWidthPx` × `screenHeightPx`
 * viewport, in screen pixels. Line positions are derived from world-meter
 * coordinates via `worldToScreen`, never hardcoded in pixels.
 */
export function computeGridLines(
  viewport: Viewport,
  screenWidthPx: number,
  screenHeightPx: number,
  options?: { targetPx?: number },
): GridResult {
  const spacingM = pickGridSpacingM(viewport, options?.targetPx);

  const topLeft = screenToWorld({ x: 0, y: 0 }, viewport);
  const bottomRight = screenToWorld({ x: screenWidthPx, y: screenHeightPx }, viewport);

  const startXIndex = Math.floor(topLeft.xM / spacingM);
  const endXIndex = Math.ceil(bottomRight.xM / spacingM);
  const startYIndex = Math.floor(topLeft.yM / spacingM);
  const endYIndex = Math.ceil(bottomRight.yM / spacingM);

  const vertical: GridLine[] = [];
  for (let i = startXIndex; i <= endXIndex; i++) {
    const xM = i * spacingM;
    const xPx = worldToScreen({ xM, yM: 0 }, viewport).x;
    vertical.push({ points: [xPx, 0, xPx, screenHeightPx], isAxis: i === 0 });
  }

  const horizontal: GridLine[] = [];
  for (let i = startYIndex; i <= endYIndex; i++) {
    const yM = i * spacingM;
    const yPx = worldToScreen({ xM: 0, yM }, viewport).y;
    horizontal.push({ points: [0, yPx, screenWidthPx, yPx], isAxis: i === 0 });
  }

  return { spacingM, vertical, horizontal };
}
