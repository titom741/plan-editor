/**
 * Every decision the service worker makes, as pure functions.
 *
 * The worker itself (`sw.ts`) is event wiring around these: a caching
 * mistake costs an offline user their app, and a `ServiceWorkerGlobalScope`
 * is not something a test can stand up. Same move as `panelSections.ts`
 * for the panel rails — the rule leaves the framework, the wiring stays
 * dumb enough to read.
 *
 * Nothing here knows where the app is deployed. The worker's own scope is
 * passed in, so the same build works at a domain root, under
 * `/plan-editor/` on GitHub Pages, and behind the macOS shell's
 * `planeditor://app/` scheme.
 */

/** Bumping this drops every cache the previous build wrote. */
export const CACHE_NAME = "plan-editor-shell-v2";

/**
 * The files worth having offline, absolute against `scope`.
 *
 * Deliberately short: the hashed chunks are cached as they are requested,
 * so listing them here would only mean naming files whose names change
 * every build. What this covers is the shell that has to exist before the
 * first request can be made at all.
 */
export function shellUrls(scope: string): string[] {
  return [
    "",
    "index.html",
    "manifest.webmanifest",
    "favicon.svg",
    "icon-192.png",
    "icon-512.png",
  ].map((path) => new URL(path, scope).href);
}

/** The caches to delete on activate: every one this build does not own. */
export function staleCacheNames(
  existing: readonly string[],
  current: string = CACHE_NAME,
): string[] {
  return existing.filter((name) => name !== current);
}

/**
 * Whether a response that came back from the network is worth keeping.
 *
 * Measured against the worker's own scope rather than its origin, for two
 * reasons. A cross-origin response is opaque, so caching one stores a body
 * this code cannot read; and on a shared host — `titom741.github.io` carries
 * every project page of the account — the origin is not this app, the
 * sub-directory is. `URL.origin` would also be no help under the macOS
 * shell, where a non-special scheme reports the string "null".
 *
 * A failed response is refused too: caching a 404 means serving that 404
 * from then on, offline, forever.
 */
export function shouldCacheResponse(
  requestUrl: string,
  responseOk: boolean,
  scope: string,
): boolean {
  if (!responseOk) return false;
  try {
    return new URL(requestUrl).href.startsWith(scope);
  } catch {
    return false;
  }
}

/**
 * What answers a request the network refused and the cache does not hold.
 *
 * Only a page falls back to the shell. Answering a missing script or
 * stylesheet with HTML turns a clean network error into a MIME-type one,
 * which is far harder to read in a console — the same trap KL-031 found
 * in the hand-written worker.
 */
export function offlineFallbackUrl(requestMode: string, scope: string): string | null {
  return requestMode === "navigate" ? new URL("index.html", scope).href : null;
}

/** The worker leaves anything but a plain read alone. */
export function handlesRequest(method: string): boolean {
  return method === "GET";
}
