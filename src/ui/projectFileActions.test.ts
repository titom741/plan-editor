import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { serializeProject } from "../persistence/projectFile";
import { installDownloadCapture, type DownloadCapture } from "../testing/downloadCapture";
import {
  describeParseError,
  downloadProjectFile,
  openProjectFileNatively,
  readProjectFile,
  describeSaveDestination,
  saveProjectFile,
  saveProjectFileAs,
  suggestedFileName,
  PROJECT_FILE_EXTENSIONS,
} from "./projectFileActions";
import { installNativeBridge } from "../testing/nativeBridgeStub";

const named = (name: string) => createEmptyProject({ name });

let capture: DownloadCapture | null = null;

afterEach(() => {
  capture?.restore();
  capture = null;
  delete (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker;
  delete (globalThis as { webkit?: unknown }).webkit;
});

describe("suggestedFileName", () => {
  it("folds accents rather than emitting them into a filename", () => {
    // A cross-platform filename with combining marks in it is a support
    // ticket waiting to happen.
    expect(suggestedFileName(named("Aérodrome d'Aix"))).toBe("aerodrome-d-aix.kli");
    expect(suggestedFileName(named("Fête à Noël"))).toBe("fete-a-noel.kli");
  });

  it("collapses runs of punctuation into a single dash and trims the ends", () => {
    expect(suggestedFileName(named("  Plan // 2027 — v2  "))).toBe("plan-2027-v2.kli");
  });

  it("falls back to a generic name when nothing usable survives", () => {
    expect(suggestedFileName(named("🎪🎪🎪"))).toBe("projet.kli");
    expect(suggestedFileName(named("   "))).toBe("projet.kli");
  });

  it("caps the slug so the name stays a filename", () => {
    const name = suggestedFileName(named("a".repeat(200)));
    expect(name).toBe(`${"a".repeat(60)}.kli`);
  });

  it("always carries the extension the open dialog filters on", () => {
    expect(suggestedFileName(named("Test")).endsWith(".kli")).toBe(true);
    expect(PROJECT_FILE_EXTENSIONS[0]).toBe(".kli");
  });

  it("still lists the pre-rename extension, so old files stay openable", () => {
    // A project file is the only copy the user owns; an extension change
    // must never be the reason one stops opening.
    expect(PROJECT_FILE_EXTENSIONS).toContain(".kl.json");
  });
});

describe("downloadProjectFile", () => {
  it("downloads the serialized project under the suggested name", async () => {
    capture = installDownloadCapture();
    const project = named("Aérodrome");
    downloadProjectFile(project);

    expect(capture.fileName).toBe("aerodrome.kli");
    expect(capture.blob?.type).toBe("application/json");
    const text = await capture.blob!.text();
    expect(JSON.parse(text).project.name).toBe("Aérodrome");
  });

  it("frees the blob url once the download has started", async () => {
    capture = installDownloadCapture();
    downloadProjectFile(named("Test"));
    // Revoked on the next tick, not synchronously: revoking straight away
    // cancels the download in some browsers.
    expect(capture.liveUrls.size).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture.liveUrls.size).toBe(0);
  });
});

describe("saveProjectFileAs", () => {
  it("writes through the browser's native dialog when it has one", async () => {
    let written = "";
    let closed = false;
    let suggested = "";
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = (options: {
      suggestedName: string;
    }) => {
      suggested = options.suggestedName;
      return Promise.resolve({
        name: "aerodrome.kli",
        createWritable: () =>
          Promise.resolve({
            write: (data: string) => {
              written = data;
              return Promise.resolve();
            },
            close: () => {
              closed = true;
              return Promise.resolve();
            },
          }),
      });
    };

    const outcome = await saveProjectFileAs(named("Aérodrome"));
    // The file is named back, and only the file: a browser never tells the
    // page which folder the panel landed in.
    expect(outcome).toEqual({
      status: "saved",
      destination: { kind: "picked", name: "aerodrome.kli" },
    });
    expect(suggested).toBe("aerodrome.kli");
    expect(JSON.parse(written).project.name).toBe("Aérodrome");
    // An unclosed writable never reaches the disk.
    expect(closed).toBe(true);
  });

  it("reports a cancelled dialog as cancelled, not as a failure", async () => {
    // The user dismissing the picker is a decision, and telling them
    // "l'enregistrement a échoué" for it is simply wrong.
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = () =>
      Promise.reject(new DOMException("abort", "AbortError"));
    expect(await saveProjectFileAs(named("Test"))).toEqual({ status: "cancelled" });
  });

  it("lets a real failure through", async () => {
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = () =>
      Promise.reject(new Error("disk on fire"));
    await expect(saveProjectFileAs(named("Test"))).rejects.toThrow("disk on fire");
  });

  it("falls back to a download where there is no dialog at all", async () => {
    // Safari and Firefox: a fallback, not an error path.
    capture = installDownloadCapture();
    const outcome = await saveProjectFileAs(named("Aérodrome"));
    expect(outcome).toEqual({
      status: "saved",
      destination: { kind: "downloaded", name: "aerodrome.kli" },
    });
    expect(capture.fileName).toBe("aerodrome.kli");
  });

  it("reports the name the user actually settled on, not the one suggested", async () => {
    // Renaming the file in the panel is ordinary, and reporting the
    // suggestion back would name a file that does not exist.
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = () =>
      Promise.resolve({
        name: "virade-2026.kli",
        createWritable: () =>
          Promise.resolve({ write: () => Promise.resolve(), close: () => Promise.resolve() }),
      });
    expect(await saveProjectFileAs(named("Aérodrome"))).toEqual({
      status: "saved",
      destination: { kind: "picked", name: "virade-2026.kli" },
    });
  });
});

describe("saveProjectFileAs through the macOS bridge", () => {
  it("prefers the system save panel over everything else", async () => {
    // The bridge is the only route that yields a real path, which is the
    // whole reason it exists: WKWebView has no File System Access, so
    // every save in the app used to land in Downloads.
    capture = installDownloadCapture();
    let pickerCalled = false;
    (globalThis as { showSaveFilePicker?: unknown }).showSaveFilePicker = () => {
      pickerCalled = true;
      return Promise.reject(new Error("should not be reached"));
    };
    const bridge = installNativeBridge({
      saveAs: () => ({ path: "/Users/tom/Plans/aerodrome.kli", name: "aerodrome.kli" }),
    });

    const outcome = await saveProjectFileAs(named("Aérodrome"));
    expect(outcome).toEqual({
      status: "saved",
      destination: { kind: "path", path: "/Users/tom/Plans/aerodrome.kli", name: "aerodrome.kli" },
    });
    expect(pickerCalled).toBe(false);
    expect(capture.fileName).toBeNull();
    expect(JSON.parse(bridge.lastContents!).project.name).toBe("Aérodrome");
    bridge.restore();
  });

  it("reports a dismissed panel as cancelled", async () => {
    const bridge = installNativeBridge({ saveAs: () => ({ cancelled: true }) });
    expect(await saveProjectFileAs(named("Test"))).toEqual({ status: "cancelled" });
    bridge.restore();
  });

  it("reports a write that failed, with the reason the shell gave", async () => {
    const bridge = installNativeBridge({ saveAs: () => ({ error: "Volume en lecture seule" }) });
    expect(await saveProjectFileAs(named("Test"))).toEqual({
      status: "failed",
      message: "Volume en lecture seule",
    });
    bridge.restore();
  });
});

describe("saveProjectFile", () => {
  it("writes back to the known file without asking again", async () => {
    const bridge = installNativeBridge({ save: () => ({ path: "/p/a.kli", name: "a.kli" }) });
    const destination = { kind: "path" as const, path: "/p/a.kli", name: "a.kli" };

    const outcome = await saveProjectFile(named("Aérodrome"), destination);
    expect(outcome).toEqual({ status: "saved", destination });
    // The save panel must not appear on a plain save.
    expect(bridge.actions).toEqual(["save"]);
    bridge.restore();
  });

  it("asks where to save when nothing is known yet", async () => {
    const bridge = installNativeBridge({ saveAs: () => ({ path: "/p/a.kli", name: "a.kli" }) });
    await saveProjectFile(named("Aérodrome"), null);
    expect(bridge.actions).toEqual(["saveAs"]);
    bridge.restore();
  });

  it("falls through to a download in a browser, which has no path to write to", async () => {
    capture = installDownloadCapture();
    const outcome = await saveProjectFile(named("Aérodrome"), {
      kind: "path",
      path: "/p/a.kli",
      name: "a.kli",
    });
    expect(outcome).toEqual({
      status: "saved",
      destination: { kind: "downloaded", name: "aerodrome.kli" },
    });
    expect(capture.fileName).toBe("aerodrome.kli");
  });
});

describe("openProjectFileNatively", () => {
  it("returns null in a browser, so the caller uses its file input", async () => {
    expect(await openProjectFileNatively()).toBeNull();
  });

  it("reads the file the system panel returned", async () => {
    const bridge = installNativeBridge({
      open: () => ({
        path: "/Users/tom/Plans/vieux.kl.json",
        name: "vieux.kl.json",
        contents: serializeProject(named("Ancien plan")),
      }),
    });
    const opened = await openProjectFileNatively();
    expect(opened).not.toBeNull();
    if (opened === null || "cancelled" in opened) throw new Error("expected a file");
    expect(opened.result.ok).toBe(true);
    expect(opened.destination).toEqual({
      kind: "path",
      path: "/Users/tom/Plans/vieux.kl.json",
      name: "vieux.kl.json",
    });
    bridge.restore();
  });

  it("reports a dismissed panel without disturbing the open document", async () => {
    const bridge = installNativeBridge({ open: () => ({ cancelled: true }) });
    expect(await openProjectFileNatively()).toEqual({ cancelled: true });
    bridge.restore();
  });

  it("treats an unreadable reply as bad input rather than crashing", async () => {
    const bridge = installNativeBridge({ open: () => ({ error: "Fichier illisible" }) });
    const opened = await openProjectFileNatively();
    if (opened === null || "cancelled" in opened) throw new Error("expected a result");
    expect(opened.result).toEqual({ ok: false, error: { code: "notJson" } });
    bridge.restore();
  });
});

describe("readProjectFile", () => {
  const asFile = (text: string) => new File([text], "plan.kli", { type: "application/json" });

  it("opens a file this app wrote", async () => {
    const result = await readProjectFile(asFile(serializeProject(named("Aérodrome"))));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.project.name).toBe("Aérodrome");
  });

  it("opens a file written under the old extension", async () => {
    // The extension is a label; what decides is the content. A rename
    // must never orphan the files the user already has.
    const legacy = new File([serializeProject(named("Ancien plan"))], "plan.kl.json", {
      type: "application/json",
    });
    const result = await readProjectFile(legacy);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.project.name).toBe("Ancien plan");
  });

  it("reports bad input instead of throwing", async () => {
    const result = await readProjectFile(asFile("{ not json"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe("notJson");
  });

  it("refuses a JSON file that isn't a project", async () => {
    const result = await readProjectFile(asFile('{"hello":"world"}'));
    expect(result.ok).toBe(false);
  });

  it("treats an unreadable file as bad input like any other", async () => {
    const unreadable = {
      text: () => Promise.reject(new Error("permission denied")),
    } as unknown as File;
    expect(await readProjectFile(unreadable)).toEqual({ ok: false, error: { code: "notJson" } });
  });
});

describe("describeParseError", () => {
  it("explains every code in French, without a code leaking through", () => {
    const messages = [
      describeParseError({ code: "notJson" }),
      describeParseError({ code: "notAnObject" }),
      describeParseError({ code: "unknownFormat" }),
      describeParseError({ code: "unsupportedVersion", found: 3, supported: 2 }),
      describeParseError({ code: "invalidField", path: "objects[0].widthM" }),
      describeParseError({ code: "danglingLayerRef", objectId: "obj_1", layerId: "layer_9" }),
    ];
    for (const message of messages) {
      expect(message.length).toBeGreaterThan(20);
      expect(message).not.toMatch(/undefined/);
    }
  });

  it("names what is actually wrong, so the message is actionable", () => {
    expect(describeParseError({ code: "invalidField", path: "objects[0].widthM" })).toContain(
      "objects[0].widthM",
    );
    expect(
      describeParseError({ code: "danglingLayerRef", objectId: "obj_1", layerId: "layer_9" }),
    ).toContain("layer_9");
  });

  it("tells the user which way the version mismatch runs", () => {
    // "Update the app" is only the right advice because the file is
    // newer; the message has to carry both numbers to say so.
    const message = describeParseError({ code: "unsupportedVersion", found: 3, supported: 2 });
    expect(message).toContain("3");
    expect(message).toContain("2");
    expect(message).toContain("plus récente");
  });
});

describe("describeSaveDestination", () => {
  it("shows the real path when the macOS panel gave one", () => {
    expect(
      describeSaveDestination({ kind: "path", path: "/Users/tom/Plans/a.kli", name: "a.kli" }),
    ).toEqual({ label: "/Users/tom/Plans/a.kli", detail: null });
  });

  it("names the file, and says why there is no folder, after a browser panel", () => {
    // Not a gap to work around: a page is never told where the panel
    // landed. Showing a bare file name and letting the user wonder why is
    // worse than saying so.
    const described = describeSaveDestination({ kind: "picked", name: "virade.kli" });
    expect(described?.label).toBe("virade.kli");
    expect(described?.detail).toMatch(/dossier/);
  });

  it("says a download went to the downloads folder, which is knowable", () => {
    const described = describeSaveDestination({ kind: "downloaded", name: "virade.kli" });
    expect(described?.label).toBe("virade.kli");
    expect(described?.detail).toMatch(/télécharg/i);
  });

  it("has nothing to say before the first save", () => {
    expect(describeSaveDestination(null)).toBeNull();
  });
});
