import { describe, expect, it } from "vitest";
import {
  isFullscreen,
  isFullscreenAvailable,
  toggleFullscreen,
  type FullscreenDocument,
} from "./fullscreen";

/** A document speaking the standard API, recording what was asked of it. */
function standardDoc(options: { enabled?: boolean; refuse?: boolean } = {}) {
  const calls: string[] = [];
  const root = {} as Element;
  const doc: FullscreenDocument = {
    fullscreenEnabled: options.enabled ?? true,
    fullscreenElement: null,
    exitFullscreen: async () => {
      calls.push("exit");
      doc.fullscreenElement = null;
    },
    documentElement: {
      requestFullscreen: async () => {
        calls.push("request");
        if (options.refuse) throw new TypeError("Permissions check failed");
        doc.fullscreenElement = root;
      },
    },
  };
  return { doc, calls };
}

describe("full screen (KL-054)", () => {
  it("is offered only where the host allows it", () => {
    expect(isFullscreenAvailable(standardDoc().doc)).toBe(true);
    // A frame without allow="fullscreen", a web view without the preference.
    expect(isFullscreenAvailable(standardDoc({ enabled: false }).doc)).toBe(false);
    expect(isFullscreenAvailable({ documentElement: {} })).toBe(false);
  });

  it("enters, then leaves, on the same button", async () => {
    const { doc, calls } = standardDoc();
    await toggleFullscreen(doc);
    expect(isFullscreen(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(isFullscreen(doc)).toBe(false);
    expect(calls).toEqual(["request", "exit"]);
  });

  it("swallows a refusal instead of throwing into a click handler", async () => {
    const { doc } = standardDoc({ refuse: true });
    await expect(toggleFullscreen(doc)).resolves.toBeUndefined();
    expect(isFullscreen(doc)).toBe(false);
  });

  it("falls back to WebKit's prefixed dialect", async () => {
    const calls: string[] = [];
    const doc: FullscreenDocument = {
      webkitFullscreenEnabled: true,
      webkitFullscreenElement: null,
      webkitExitFullscreen: () => {
        calls.push("webkit-exit");
        doc.webkitFullscreenElement = null;
      },
      documentElement: {
        webkitRequestFullscreen: () => {
          calls.push("webkit-request");
          doc.webkitFullscreenElement = {} as Element;
        },
      },
    };
    expect(isFullscreenAvailable(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(isFullscreen(doc)).toBe(true);
    await toggleFullscreen(doc);
    expect(calls).toEqual(["webkit-request", "webkit-exit"]);
  });
});
