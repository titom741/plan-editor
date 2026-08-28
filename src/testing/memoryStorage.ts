/**
 * An in-memory `Storage` for tests.
 *
 * The test runner is plain Node with no DOM, so `localStorage` simply
 * isn't there. This is a few lines against a small, stable interface —
 * cheaper and clearer than pulling in a DOM implementation to get one
 * object, and it makes each test's starting state explicit.
 */
export function installMemoryStorage(): Map<string, string> {
  const entries = new Map<string, string>();
  globalThis.localStorage = {
    get length() {
      return entries.size;
    },
    clear: () => entries.clear(),
    getItem: (key: string) => entries.get(key) ?? null,
    key: (index: number) => [...entries.keys()][index] ?? null,
    removeItem: (key: string) => entries.delete(key),
    setItem: (key: string, value: string) => {
      entries.set(key, value);
    },
  } as Storage;
  return entries;
}

/** Replaces `localStorage` with one that refuses every write, as a full or disabled one does. */
export function installFullStorage(): void {
  installMemoryStorage();
  const storage = globalThis.localStorage;
  globalThis.localStorage = {
    ...storage,
    getItem: (key: string) => storage.getItem(key),
    setItem: () => {
      throw new DOMException("quota", "QuotaExceededError");
    },
  } as Storage;
}
