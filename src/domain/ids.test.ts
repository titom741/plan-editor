import { afterEach, describe, expect, it } from "vitest";
import { createId } from "./ids";

const realCrypto = globalThis.crypto;

afterEach(() => {
  Object.defineProperty(globalThis, "crypto", { value: realCrypto, configurable: true });
});

/** Hides `crypto.randomUUID`, as an older browser or a non-secure context does. */
function withoutRandomUuid(): void {
  Object.defineProperty(globalThis, "crypto", { value: {}, configurable: true });
}

describe("createId", () => {
  it("namespaces the id with the prefix it is given", () => {
    // The prefix is what makes a persisted file and a debug session
    // readable — "layer_3fa2…" says what it is at a glance.
    expect(createId("layer")).toMatch(/^layer_[0-9a-f-]{36}$/);
    expect(createId("obj")).toMatch(/^obj_/);
  });

  it("works without a prefix", () => {
    expect(createId()).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("does not repeat itself", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createId("obj")));
    expect(ids.size).toBe(500);
  });

  describe("without crypto.randomUUID", () => {
    it("still produces a well-formed, unique id", () => {
      withoutRandomUuid();
      const ids = new Set(Array.from({ length: 500 }, () => createId("layer")));
      expect(ids.size).toBe(500);
      expect([...ids][0]).toMatch(
        /^layer_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });
  });
});
