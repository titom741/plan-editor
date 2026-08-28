/**
 * Offline shell for the web build.
 *
 * Network-first, on purpose: the app is code-split, and a cache-first
 * worker happily pairs a fresh index.html with a chunk that no longer
 * exists — the exact failure the error boundaries were added to survive.
 * Going to the network first means the cache only ever answers when there
 * is no network at all, which is what "offline" is supposed to mean here.
 */

const CACHE_NAME = "kl-implantation-shell-v1";
const SHELL = ["/", "/index.html", "/favicon.svg", "/app-icon.svg", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok && new URL(event.request.url).origin === self.location.origin) {
          const copy = response.clone();
          void caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(event.request).then((cached) => {
          if (cached) return cached;
          // Only a page falls back to the shell. Answering a missing script or
          // stylesheet with HTML turns a clean network error into a MIME-type
          // one, which is far harder to read in a console.
          if (event.request.mode === "navigate") return caches.match("/index.html");
          return Response.error();
        }),
      ),
  );
});
