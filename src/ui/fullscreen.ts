/**
 * Full screen for the whole editor (KL-054).
 *
 * The plan is drawn on a canvas that is never big enough, and the editor
 * often lives inside something else — a browser tab, the macOS shell, or a
 * frame in the Virade application, beside its own menu. The Fullscreen API
 * hands the editor the whole screen whatever it is embedded in, provided the
 * host allows it: a frame needs `allow="fullscreen"`, and a WKWebView needs
 * its element-fullscreen preference switched on. Where that isn't the case,
 * `fullscreenEnabled` is false and the button is simply not offered.
 *
 * WebKit has long spoken a prefixed dialect of the API; the prefixed names
 * are read as a fallback so an older Safari or web view still gets the button.
 *
 * Every function takes the document as a parameter, so they are tested with a
 * stand-in rather than a browser.
 */

export interface FullscreenDocument {
  fullscreenEnabled?: boolean;
  fullscreenElement?: Element | null;
  exitFullscreen?: () => Promise<void>;
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => void;
  documentElement: {
    requestFullscreen?: () => Promise<void>;
    webkitRequestFullscreen?: () => void;
  };
}

export function isFullscreenAvailable(doc: FullscreenDocument): boolean {
  return doc.fullscreenEnabled === true || doc.webkitFullscreenEnabled === true;
}

export function isFullscreen(doc: FullscreenDocument): boolean {
  return (doc.fullscreenElement ?? doc.webkitFullscreenElement ?? null) !== null;
}

/**
 * Enters full screen, or leaves it. Resolves once the request has been made;
 * a refusal (no user gesture, a host that says no) is swallowed, since the
 * state listener reports what actually happened and there is nothing else a
 * button can do about it.
 */
export async function toggleFullscreen(doc: FullscreenDocument): Promise<void> {
  try {
    if (isFullscreen(doc)) {
      if (doc.exitFullscreen) await doc.exitFullscreen();
      else doc.webkitExitFullscreen?.();
      return;
    }
    const root = doc.documentElement;
    if (root.requestFullscreen) await root.requestFullscreen();
    else root.webkitRequestFullscreen?.();
  } catch {
    /* refused: the change listener keeps the button honest */
  }
}

/** The events that announce a change, standard and prefixed. */
export const FULLSCREEN_CHANGE_EVENTS = ["fullscreenchange", "webkitfullscreenchange"] as const;
