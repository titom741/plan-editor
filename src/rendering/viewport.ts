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

/**
 * A viewport is the runtime pan/zoom state layered on top of a project's
 * calibration. It never touches the business model: zooming or panning
 * changes `zoom` / `offsetXPx` / `offsetYPx` here, never `widthM`, `xM`,
 * etc. on any `PlanObject`.
 */
export interface Viewport {
  /** Pixels per meter at zoom = 1, coming from the project's calibration. */
  basePixelsPerMeter: number;
  zoom: number;
  /** Screen-space pixel position of the world origin (0m, 0m) at the current pan. */
  offsetXPx: number;
  offsetYPx: number;
}

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
