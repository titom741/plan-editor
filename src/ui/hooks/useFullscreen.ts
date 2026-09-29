import { useCallback, useEffect, useState } from "react";
import {
  FULLSCREEN_CHANGE_EVENTS,
  isFullscreen,
  isFullscreenAvailable,
  toggleFullscreen,
  type FullscreenDocument,
} from "../fullscreen";

/** Whether full screen is on offer, whether it is on, and the toggle (KL-054). */
export function useFullscreen() {
  const doc = document as unknown as FullscreenDocument;
  const [available] = useState(() => isFullscreenAvailable(doc));
  const [active, setActive] = useState(() => isFullscreen(doc));

  useEffect(() => {
    // Esc, the green button, or the host leaving full screen all end it
    // without going through our toggle: the event is the one source of truth.
    const sync = () => setActive(isFullscreen(document as unknown as FullscreenDocument));
    for (const name of FULLSCREEN_CHANGE_EVENTS) document.addEventListener(name, sync);
    return () => {
      for (const name of FULLSCREEN_CHANGE_EVENTS) document.removeEventListener(name, sync);
    };
  }, []);

  const toggle = useCallback(() => {
    void toggleFullscreen(document as unknown as FullscreenDocument);
  }, []);

  return { available, active, toggle };
}
