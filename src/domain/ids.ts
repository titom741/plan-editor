/**
 * Stable identifier generation for domain entities.
 *
 * Centralized here so the rest of the domain never reaches for `crypto` or
 * `Math.random` directly, and so the strategy can change later (e.g. to
 * sequential ids for deterministic tests) without touching call sites.
 */

/** Fallback generator used only when `crypto.randomUUID` is unavailable. */
function fallbackUuid(): string {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function uuid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return fallbackUuid();
}

/**
 * Creates a stable unique id, optionally namespaced with a readable prefix
 * (e.g. `createId("layer")` -> `"layer_3fa2..."`) to keep debug output and
 * persisted files legible.
 */
export function createId(prefix?: string): string {
  const id = uuid();
  return prefix ? `${prefix}_${id}` : id;
}
