import { describe, expect, it } from "vitest";
import { keyboardEventSignature } from "./shortcuts";

describe("keyboardEventSignature", () => {
  it("normalise Ctrl et Cmd en Mod et ordonne les modificateurs", () => {
    expect(keyboardEventSignature({ key: "Z", ctrlKey: true, metaKey: false, altKey: false, shiftKey: true })).toBe("Mod+Shift+z");
    expect(keyboardEventSignature({ key: "c", ctrlKey: false, metaKey: true, altKey: false, shiftKey: false })).toBe("Mod+c");
  });
});
