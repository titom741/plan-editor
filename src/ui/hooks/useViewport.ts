import { useCallback, useEffect, useRef, useState } from "react";
import { createViewport, panViewport, zoomViewportAt } from "../../rendering/viewport";
import type { ScreenPoint, Viewport } from "../../rendering/viewport";

export interface StageSize {
  widthPx: number;
  heightPx: number;
}

/**
 * React-side wrapper around the pure `rendering/viewport` module: tracks
 * zoom/pan state and the canvas container's pixel size, and exposes
 * `zoomAt` / `pan` actions that delegate to the pure functions. All the
 * actual math stays in `rendering/`; this hook only owns React state.
 */
export function useViewport(basePixelsPerMeter: number) {
  const [viewport, setViewport] = useState<Viewport>(() => createViewport(basePixelsPerMeter));
  const [stageSize, setStageSize] = useState<StageSize>({ widthPx: 0, heightPx: 0 });
  const hasCenteredRef = useRef(false);
  const elementRef = useRef<HTMLDivElement | null>(null);

  const applySize = useCallback((width: number, height: number) => {
    if (width <= 0 || height <= 0) return;
    setStageSize({ widthPx: width, heightPx: height });
    // Center the world origin's neighborhood in the viewport once, on
    // first layout, so the demo object starts visible instead of at
    // (0, 0) in a corner.
    if (!hasCenteredRef.current) {
      hasCenteredRef.current = true;
      setViewport((current) => ({ ...current, offsetXPx: width / 4, offsetYPx: height / 4 }));
    }
  }, []);

  // A callback ref (rather than a plain ref object) measures the
  // container the instant it's attached to the DOM, during React's commit
  // phase — before any effect runs and before the first paint — so the
  // canvas gets a valid size on the very first render instead of relying
  // solely on ResizeObserver's first callback for it. Setting state from a
  // callback ref (a "synchronizing with an external system" moment, not a
  // render) is the standard React pattern for this.
  const containerRef = useCallback(
    (node: HTMLDivElement | null) => {
      elementRef.current = node;
      if (node) applySize(node.getBoundingClientRect().width, node.getBoundingClientRect().height);
    },
    [applySize],
  );

  // ResizeObserver picks up every *subsequent* size change (window
  // resize, layout shifts) — the callback ref above only covers the
  // initial mount.
  useEffect(() => {
    const container = elementRef.current;
    if (!container) return;
    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      applySize(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [applySize]);

  const zoomAt = useCallback((screenPoint: ScreenPoint, factor: number) => {
    setViewport((current) => zoomViewportAt(current, screenPoint, factor));
  }, []);

  const pan = useCallback((deltaXPx: number, deltaYPx: number) => {
    setViewport((current) => panViewport(current, deltaXPx, deltaYPx));
  }, []);

  return { viewport, containerRef, stageSize, zoomAt, pan };
}
