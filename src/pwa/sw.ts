/**
 * Offline shell for the web build. The decisions live in `swCore.ts`.
 *
 * Network-first, on purpose: the app is code-split, and a cache-first
 * worker happily pairs a fresh index.html with a chunk that no longer
 * exists — the exact failure the error boundaries were added to survive.
 * Going to the network first means the cache only ever answers when there
 * is no network at all, which is what "offline" is supposed to mean here.
 */
import {
  CACHE_NAME,
  handlesRequest,
  offlineFallbackUrl,
  shellUrls,
  shouldCacheResponse,
  staleCacheNames,
} from "./swCore.ts";

/**
 * The worker's own globals, declared rather than imported.
 *
 * The project type-checks against the DOM lib; adding `WebWorker` to
 * `lib` next to it makes TypeScript report every shared global twice.
 * The surface this file touches is six members wide, so it is cheaper to
 * name them than to reshape the compiler options of the whole app.
 */
interface WorkerLifecycleEvent {
  waitUntil(work: Promise<unknown>): void;
}

interface WorkerFetchEvent {
  request: Request;
  respondWith(response: Promise<Response>): void;
}

interface WorkerScope {
  registration: { scope: string };
  skipWaiting(): Promise<void>;
  clients: { claim(): Promise<void> };
  addEventListener(
    type: "install" | "activate",
    listener: (event: WorkerLifecycleEvent) => void,
  ): void;
  addEventListener(type: "fetch", listener: (event: WorkerFetchEvent) => void): void;
}

const worker = self as unknown as WorkerScope;

/**
 * Seeds the shell one file at a time.
 *
 * `cache.addAll` is atomic: one missing file fails the install, the worker
 * never activates, and the app loses offline support entirely — silently,
 * for a favicon. Best-effort leaves the user offline-capable minus
 * whatever went missing.
 */
async function seedShell(): Promise<void> {
  const cache = await caches.open(CACHE_NAME);
  await Promise.allSettled(shellUrls(worker.registration.scope).map((url) => cache.add(url)));
}

async function dropStaleCaches(): Promise<void> {
  const keys = await caches.keys();
  await Promise.all(staleCacheNames(keys).map((key) => caches.delete(key)));
}

async function networkFirst(request: Request): Promise<Response> {
  try {
    const response = await fetch(request);
    if (shouldCacheResponse(request.url, response.ok, worker.registration.scope)) {
      const copy = response.clone();
      void caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;

    const fallback = offlineFallbackUrl(request.mode, worker.registration.scope);
    if (fallback) {
      const shell = await caches.match(fallback);
      if (shell) return shell;
    }
    return Response.error();
  }
}

worker.addEventListener("install", (event) => {
  event.waitUntil(seedShell().then(() => worker.skipWaiting()));
});

worker.addEventListener("activate", (event) => {
  event.waitUntil(dropStaleCaches().then(() => worker.clients.claim()));
});

worker.addEventListener("fetch", (event) => {
  if (!handlesRequest(event.request.method)) return;
  event.respondWith(networkFirst(event.request));
});
