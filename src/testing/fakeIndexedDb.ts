/**
 * A minimal IndexedDB stand-in for tests.
 *
 * Node has no IndexedDB, and `persistence/projectStorage.ts` is the one
 * module that needs it — the autosave, where a defect costs the user
 * their work. Rather than add a dependency for a single module, this
 * implements exactly the surface that module touches: `open` with an
 * upgrade callback, `transaction`/`objectStore`, and `get`, `put`,
 * `delete`, `getAll`, `getAllKeys`.
 *
 * Two behaviours are load-bearing and deliberately faithful:
 *
 * - **Requests resolve asynchronously.** Callers assign `onsuccess` after
 *   the request is returned, so firing synchronously would silently skip
 *   every handler and make the tests pass for the wrong reason.
 * - **`getAll` and `getAllKeys` agree on order.** The module zips them by
 *   index, which is only valid because real IndexedDB returns both in key
 *   order. The fake sorts, so a change that broke that assumption would
 *   fail here rather than in production.
 *
 * Values are structured-cloned in and out, as the real store does, so a
 * caller mutating what it saved cannot reach into the database.
 */

export interface FakeIndexedDb {
  /** The stored records, keyed as the module keys them. Read and seed directly. */
  entries: Map<string, unknown>;
  /** Makes every subsequent write fail as a full quota does. */
  fillUp(): void;
  /** How many times a connection has been opened — the module opens one per call. */
  openCount(): number;
  restore(): void;
}

interface FakeRequest<T> {
  result: T;
  error: DOMException | null;
  onsuccess: (() => void) | null;
  onerror: (() => void) | null;
}

function settle<T>(request: FakeRequest<T>, error?: DOMException): void {
  queueMicrotask(() => {
    if (error) {
      request.error = error;
      request.onerror?.();
    } else {
      request.onsuccess?.();
    }
  });
}

function succeed<T>(result: T): FakeRequest<T> {
  const request: FakeRequest<T> = { result, error: null, onsuccess: null, onerror: null };
  settle(request);
  return request;
}

/**
 * Installs the fake on `globalThis`. `options.unavailable` makes every
 * open fail, which is what a private window with site data disabled looks
 * like — the case the module claims to survive.
 */
export function installFakeIndexedDb(options: { unavailable?: boolean } = {}): FakeIndexedDb {
  const entries = new Map<string, unknown>();
  const stores = new Set<string>();
  let full = false;
  let opens = 0;
  const previous = (globalThis as { indexedDB?: IDBFactory }).indexedDB;

  const makeStore = () => ({
    get(key: string) {
      return succeed(entries.has(key) ? structuredClone(entries.get(key)) : undefined);
    },
    put(value: unknown, key: string) {
      if (full) {
        const request: FakeRequest<undefined> = {
          result: undefined,
          error: null,
          onsuccess: null,
          onerror: null,
        };
        settle(request, new DOMException("quota exceeded", "QuotaExceededError"));
        return request;
      }
      entries.set(key, structuredClone(value));
      return succeed(key);
    },
    delete(key: string) {
      entries.delete(key);
      return succeed(undefined);
    },
    getAllKeys() {
      return succeed([...entries.keys()].sort());
    },
    getAll() {
      return succeed([...entries.keys()].sort().map((key) => structuredClone(entries.get(key))));
    },
  });

  const database = {
    objectStoreNames: { contains: (name: string) => stores.has(name) },
    createObjectStore: (name: string) => {
      stores.add(name);
      return makeStore();
    },
    transaction: () => ({ objectStore: () => makeStore() }),
    close: () => {},
  };

  (globalThis as { indexedDB?: unknown }).indexedDB = {
    open() {
      opens += 1;
      const request = {
        result: database,
        error: null as DOMException | null,
        onupgradeneeded: null as (() => void) | null,
        onsuccess: null as (() => void) | null,
        onerror: null as (() => void) | null,
        onblocked: null as (() => void) | null,
      };
      queueMicrotask(() => {
        if (options.unavailable) {
          request.onerror?.();
          return;
        }
        if (stores.size === 0) request.onupgradeneeded?.();
        request.onsuccess?.();
      });
      return request;
    },
  };

  return {
    entries,
    fillUp: () => {
      full = true;
    },
    openCount: () => opens,
    restore: () => {
      (globalThis as { indexedDB?: IDBFactory | undefined }).indexedDB = previous;
    },
  };
}
