/**
 * The single place where meters turn into pixels and back.
 *
 * No component in `ui/` should compute a pixel position by hand — every
 * conversion goes through this module so the "world in meters, screen in
 * pixels" boundary from `docs/ARCHITECTURE.md` actually holds in practice.
 */

export interface ScreenPoint {
  x: number;
  y: number;
}

export interface WorldPoint {
  xM: number;
  yM: number;
}

/** Axis-aligned world extent used to keep navigation near a finite plan. */
export interface ViewportBounds {
  minXM: number;
  minYM: number;
  maxXM: number;
  maxYM: number;
}

export interface ViewportSize {
  widthPx: number;
  heightPx: number;
}

/**
 * A viewport is the runtime pan/zoom state — purely a display concern. It
 * never touches the business model: zooming or panning changes `zoom` /
 * `offsetXPx` / `offsetYPx` here, never `widthM`, `xM`, etc. on any
 * `PlanObject`.
 */
export interface Viewport {
  /** Screen pixels per meter at zoom = 1 — how big a meter is drawn, nothing more. */
  basePixelsPerMeter: number;
  zoom: number;
  /** Screen-space pixel position of the world origin (0m, 0m) at the current pan. */
  offsetXPx: number;
  offsetYPx: number;
}

/**
 * How many screen pixels one meter occupies at zoom = 1. Deliberately a
 * *display* constant, unrelated to `Calibration.pixelsPerMeter`: since
 * KL-005 that one means "pixels of the background image per meter", which
 * is a property of the imported photo/scan, not of how big the user wants
 * a meter drawn on their monitor. Conflating the two (as the code did
 * before calibration existed) would make calibrating a plan silently
 * change the on-screen zoom level.
 */
export const DEFAULT_SCREEN_PIXELS_PER_METER = 20;

export const DEFAULT_MIN_ZOOM = 0.05;
export const DEFAULT_MAX_ZOOM = 40;

export function createViewport(basePixelsPerMeter: number): Viewport {
  return { basePixelsPerMeter, zoom: 1, offsetXPx: 0, offsetYPx: 0 };
}

/** The effective, current pixels-per-meter scale (calibration × zoom). */
export function getEffectivePixelsPerMeter(viewport: Viewport): number {
  return viewport.basePixelsPerMeter * viewport.zoom;
}

export function metersToPixels(meters: number, viewport: Viewport): number {
  return meters * getEffectivePixelsPerMeter(viewport);
}

export function pixelsToMeters(pixels: number, viewport: Viewport): number {
  return pixels / getEffectivePixelsPerMeter(viewport);
}

export function worldToScreen(point: WorldPoint, viewport: Viewport): ScreenPoint {
  const scale = getEffectivePixelsPerMeter(viewport);
  return {
    x: viewport.offsetXPx + point.xM * scale,
    y: viewport.offsetYPx + point.yM * scale,
  };
}

export function screenToWorld(point: ScreenPoint, viewport: Viewport): WorldPoint {
  const scale = getEffectivePixelsPerMeter(viewport);
  return {
    xM: (point.x - viewport.offsetXPx) / scale,
    yM: (point.y - viewport.offsetYPx) / scale,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Returns a new viewport zoomed by `zoomFactor`, keeping the world point
 * currently under `screenPoint` fixed on screen — the usual "zoom towards
 * the cursor" behavior. Pure: the input viewport is left untouched.
 */
export function zoomViewportAt(
  viewport: Viewport,
  screenPoint: ScreenPoint,
  zoomFactor: number,
  options?: { minZoom?: number; maxZoom?: number },
): Viewport {
  const minZoom = options?.minZoom ?? DEFAULT_MIN_ZOOM;
  const maxZoom = options?.maxZoom ?? DEFAULT_MAX_ZOOM;
  const newZoom = clamp(viewport.zoom * zoomFactor, minZoom, maxZoom);

  const worldUnderCursor = screenToWorld(screenPoint, viewport);
  const zoomedViewport: Viewport = { ...viewport, zoom: newZoom };
  const screenAfterZoom = worldToScreen(worldUnderCursor, zoomedViewport);

  return {
    ...zoomedViewport,
    offsetXPx: zoomedViewport.offsetXPx + (screenPoint.x - screenAfterZoom.x),
    offsetYPx: zoomedViewport.offsetYPx + (screenPoint.y - screenAfterZoom.y),
  };
}

/** Returns a new viewport panned by the given screen-pixel delta. */
export function panViewport(viewport: Viewport, deltaXPx: number, deltaYPx: number): Viewport {
  return {
    ...viewport,
    offsetXPx: viewport.offsetXPx + deltaXPx,
    offsetYPx: viewport.offsetYPx + deltaYPx,
  };
}

/**
 * Keeps a finite world extent reachable without allowing it to be thrown
 * completely off screen. When an axis of the plan is smaller than the
 * viewport it is centred on that axis, so repeated panning cannot drift
 * into an empty, effectively infinite canvas.
 */
export function constrainViewportToBounds(
  viewport: Viewport,
  bounds: ViewportBounds,
  size: ViewportSize,
  paddingPx = 24,
): Viewport {
  if (size.widthPx <= 0 || size.heightPx <= 0) return viewport;
  const scale = getEffectivePixelsPerMeter(viewport);
  const constrainAxis = (minM: number, maxM: number, screenSizePx: number, offsetPx: number) => {
    const extentPx = Math.max(0, maxM - minM) * scale;
    const usablePx = Math.max(0, screenSizePx - paddingPx * 2);
    if (extentPx <= usablePx) return (screenSizePx - extentPx) / 2 - minM * scale;
    const minimumOffset = screenSizePx - paddingPx - maxM * scale;
    const maximumOffset = paddingPx - minM * scale;
    return clamp(offsetPx, minimumOffset, maximumOffset);
  };
  return {
    ...viewport,
    offsetXPx: constrainAxis(bounds.minXM, bounds.maxXM, size.widthPx, viewport.offsetXPx),
    offsetYPx: constrainAxis(bounds.minYM, bounds.maxYM, size.heightPx, viewport.offsetYPx),
  };
}

/** Fits an entire finite extent into the viewport with a small margin. */
export function fitViewportToBounds(
  viewport: Viewport,
  bounds: ViewportBounds,
  size: ViewportSize,
  paddingPx = 32,
): Viewport {
  const widthM = Math.max(1e-6, bounds.maxXM - bounds.minXM);
  const heightM = Math.max(1e-6, bounds.maxYM - bounds.minYM);
  const availableWidthPx = Math.max(1, size.widthPx - paddingPx * 2);
  const availableHeightPx = Math.max(1, size.heightPx - paddingPx * 2);
  const effectiveScale = Math.min(availableWidthPx / widthM, availableHeightPx / heightM);
  const zoom = clamp(effectiveScale / viewport.basePixelsPerMeter, DEFAULT_MIN_ZOOM, DEFAULT_MAX_ZOOM);
  const fitted = { ...viewport, zoom };
  const scale = getEffectivePixelsPerMeter(fitted);
  return {
    ...fitted,
    offsetXPx: size.widthPx / 2 - ((bounds.minXM + bounds.maxXM) / 2) * scale,
    offsetYPx: size.heightPx / 2 - ((bounds.minYM + bounds.maxYM) / 2) * scale,
  };
}
