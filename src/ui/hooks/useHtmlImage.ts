import { useEffect, useState } from "react";

/**
 * Loads a plain `HTMLImageElement` from a URL (a data: URL, in this app's
 * case — see `App.tsx`'s import handler) for use with react-konva's
 * `<Image>`, which needs an actual image element rather than a URL
 * string. Small enough not to justify pulling in a package for it.
 */
export function useHtmlImage(url: string | null): HTMLImageElement | null {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [trackedUrl, setTrackedUrl] = useState(url);

  // url went away (e.g. the background was removed) — clear synchronously
  // during render rather than in an effect, since this is just adjusting
  // state to match a prop, not synchronizing with an external system.
  if (url === null && trackedUrl !== null) {
    setTrackedUrl(null);
    setImage(null);
  }

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    const img = new Image();
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.src = url;
    return () => {
      cancelled = true;
    };
  }, [url]);

  return image;
}
