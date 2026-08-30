import { afterEach, describe, expect, it } from "vitest";
import { installNativeBridge } from "../testing/nativeBridgeStub";
import {
  isNativeBridgeAvailable,
  nativeOpen,
  nativeSave,
  nativeSaveAs,
  onNativeFileOpened,
  type NativeOpenedFile,
} from "./nativeBridge";

afterEach(() => {
  delete (globalThis as { webkit?: unknown }).webkit;
  delete (globalThis as { planEditorOpenFile?: unknown }).planEditorOpenFile;
});

describe("isNativeBridgeAvailable", () => {
  it("is false in a browser, which is where the app usually runs", () => {
    expect(isNativeBridgeAvailable()).toBe(false);
  });

  it("is false when the web view exists but never installed our channel", () => {
    // A WKWebView with some other handler registered: the bridge is
    // addressed by name, so a neighbour on the same object is not ours.
    (globalThis as { webkit?: unknown }).webkit = { messageHandlers: { somethingElse: {} } };
    expect(isNativeBridgeAvailable()).toBe(false);
  });

  it("is true once the shell has installed the channel", () => {
    const stub = installNativeBridge({});
    expect(isNativeBridgeAvailable()).toBe(true);
    stub.restore();
  });
});

describe("what crosses the bridge", () => {
  it("names the action and carries what each one needs", async () => {
    const seen: Record<string, unknown>[] = [];
    const record = (message: Record<string, unknown>) => {
      seen.push(message);
      return { path: "/tmp/plan.kli", name: "plan.kli" };
    };
    const stub = installNativeBridge({ saveAs: record, save: record, open: record });

    await nativeSaveAs("plan.kli", "{}");
    await nativeSave("/tmp/plan.kli", "{}");
    await nativeOpen();
    stub.restore();

    expect(seen).toEqual([
      { action: "saveAs", suggestedName: "plan.kli", contents: "{}" },
      { action: "save", path: "/tmp/plan.kli", contents: "{}" },
      { action: "open" },
    ]);
  });

  it("reports the absence of the bridge rather than throwing", async () => {
    // Nothing calls these without checking first, but a failure that
    // reports itself beats one that takes the editor down.
    expect(await nativeSave("/tmp/plan.kli", "{}")).toEqual({
      status: "failed",
      message: "Pont natif indisponible.",
    });
  });

  it("turns a rejected postMessage into a reported failure", async () => {
    const stub = installNativeBridge({
      open: () => Promise.reject(new Error("le pont a été retiré")),
    });
    expect(await nativeOpen()).toEqual({ status: "failed", message: "le pont a été retiré" });
    stub.restore();
  });
});

describe("reading the shell's reply", () => {
  const replyWith = async (reply: unknown) => {
    const stub = installNativeBridge({ open: () => reply });
    const result = await nativeOpen();
    stub.restore();
    return result;
  };

  it("passes a complete reply through, contents included", async () => {
    expect(await replyWith({ path: "/tmp/plan.kli", name: "plan.kli", contents: "{}" })).toEqual({
      status: "ok",
      path: "/tmp/plan.kli",
      name: "plan.kli",
      contents: "{}",
    });
  });

  it("omits contents rather than inventing an empty file, as a save's reply does", async () => {
    // A save answers with the path it wrote and no contents; the caller
    // distinguishes that from a file that really is empty.
    const result = await replyWith({ path: "/tmp/plan.kli", name: "plan.kli" });
    expect(result).toEqual({ status: "ok", path: "/tmp/plan.kli", name: "plan.kli" });
    expect("contents" in result).toBe(false);
  });

  it("treats a dismissed panel as cancelled, not as a failure", async () => {
    expect(await replyWith({ cancelled: true })).toEqual({ status: "cancelled" });
  });

  it("carries the shell's own wording when it reports an error", async () => {
    expect(await replyWith({ error: "Vous n'avez pas la permission d'écrire ici." })).toEqual({
      status: "failed",
      message: "Vous n'avez pas la permission d'écrire ici.",
    });
  });

  it("refuses a reply that lost its path or its name", async () => {
    // Both are required: the path is where a later plain save writes, the
    // name is what the window is called. A reply carrying one of them is
    // not half a result, it is a broken one.
    const incomplete = { status: "failed", message: "Réponse incomplète du pont natif." };
    expect(await replyWith({ name: "plan.kli" })).toEqual(incomplete);
    expect(await replyWith({ path: "/tmp/plan.kli" })).toEqual(incomplete);
  });

  it("refuses a reply that isn't a dictionary at all", async () => {
    expect(await replyWith("plan.kli")).toEqual({
      status: "failed",
      message: "Réponse inattendue du pont natif.",
    });
    expect(await replyWith(null)).toEqual({
      status: "failed",
      message: "Réponse inattendue du pont natif.",
    });
  });
});

describe("onNativeFileOpened", () => {
  const globals = globalThis as { planEditorOpenFile?: (payload: unknown) => void };

  it("hands over a document the shell opened from the Finder", () => {
    const opened: NativeOpenedFile[] = [];
    const stop = onNativeFileOpened((file) => opened.push(file));

    globals.planEditorOpenFile?.({ path: "/tmp/plan.kli", name: "plan.kli", contents: "{}" });
    stop();

    expect(opened).toEqual([{ path: "/tmp/plan.kli", name: "plan.kli", contents: "{}" }]);
  });

  it("ignores a payload missing any of the three fields", () => {
    // The shell is trusted, but this is a global anyone can call: a
    // half-formed payload must be dropped, not turned into a document
    // that replaces the one on screen.
    const opened: NativeOpenedFile[] = [];
    const stop = onNativeFileOpened((file) => opened.push(file));

    globals.planEditorOpenFile?.({ path: "/tmp/plan.kli", name: "plan.kli" });
    globals.planEditorOpenFile?.({ name: "plan.kli", contents: "{}" });
    globals.planEditorOpenFile?.({ path: "/tmp/plan.kli", contents: "{}" });
    globals.planEditorOpenFile?.("plan.kli");
    globals.planEditorOpenFile?.(null);
    stop();

    expect(opened).toEqual([]);
  });

  it("stops delivering once unregistered", () => {
    const opened: NativeOpenedFile[] = [];
    const stop = onNativeFileOpened((file) => opened.push(file));
    stop();

    expect(globals.planEditorOpenFile).toBeUndefined();
    expect(opened).toEqual([]);
  });

  it("leaves the newer registration alone when an older one cleans up", () => {
    // The effect re-runs: React installs the replacement before tearing
    // the previous one down. Deleting blindly there would leave the shell
    // calling into nothing and a double-clicked file opening nowhere.
    const first: NativeOpenedFile[] = [];
    const second: NativeOpenedFile[] = [];
    const stopFirst = onNativeFileOpened((file) => first.push(file));
    const stopSecond = onNativeFileOpened((file) => second.push(file));

    stopFirst();
    globals.planEditorOpenFile?.({ path: "/tmp/plan.kli", name: "plan.kli", contents: "{}" });
    stopSecond();

    expect(first).toEqual([]);
    expect(second).toHaveLength(1);
    expect(globals.planEditorOpenFile).toBeUndefined();
  });
});
