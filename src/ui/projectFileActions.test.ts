import { afterEach, describe, expect, it } from "vitest";
import { createEmptyProject } from "../domain/project";
import { serializeProject } from "../persistence/projectFile";
import { installDownloadCapture, type DownloadCapture } from "../testing/downloadCapture";
import {
  describeParseError,
  downloadProjectFile,
  readProjectFile,
  saveProjectFileAs,
  suggestedFileName,
} from "./projectFileActions";

const named = (name: string) => createEmptyProject({ name });

let capture: DownloadCapture | null = null;

afterEach(() => {
  capture?.restore();
  capture = null;
  delete (globalThis as { window?: unknown }).window;
});

describe("suggestedFileName", () => {
  it("folds accents rather than emitting them into a filename", () => {
    // A cross-platform filename with combining marks in it is a support
    // ticket waiting to happen.
    expect(suggestedFileName(named("Aérodrome d'Aix"))).toBe("aerodrome-d-aix.kl.json");
    expect(suggestedFileName(named("Fête à Noël"))).toBe("fete-a-noel.kl.json");
  });

  it("collapses runs of punctuation into a single dash and trims the ends", () => {
    expect(suggestedFileName(named("  Plan // 2027 — v2  "))).toBe("plan-2027-v2.kl.json");
  });

  it("falls back to a generic name when nothing usable survives", () => {
    expect(suggestedFileName(named("🎪🎪🎪"))).toBe("projet.kl.json");
    expect(suggestedFileName(named("   "))).toBe("projet.kl.json");
  });

  it("caps the slug so the name stays a filename", () => {
    const name = suggestedFileName(named("a".repeat(200)));
    expect(name).toBe(`${"a".repeat(60)}.kl.json`);
  });

  it("always carries the extension the open dialog filters on", () => {
    expect(suggestedFileName(named("Test")).endsWith(".kl.json")).toBe(true);
  });
});

describe("downloadProjectFile", () => {
  it("downloads the serialized project under the suggested name", async () => {
    capture = installDownloadCapture();
    const project = named("Aérodrome");
    downloadProjectFile(project);

    expect(capture.fileName).toBe("aerodrome.kl.json");
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
  it("writes through the native dialog when the browser has one", async () => {
    let written = "";
    let closed = false;
    let suggested = "";
    (globalThis as { window?: unknown }).window = {
      showSaveFilePicker: (options: { suggestedName: string }) => {
        suggested = options.suggestedName;
        return Promise.resolve({
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
      },
    };

    expect(await saveProjectFileAs(named("Aérodrome"))).toBe(true);
    expect(suggested).toBe("aerodrome.kl.json");
    expect(JSON.parse(written).project.name).toBe("Aérodrome");
    // An unclosed writable never reaches the disk.
    expect(closed).toBe(true);
  });

  it("reports a cancelled dialog as not-saved, not as a failure", async () => {
    // The user dismissing the picker is a decision, and telling them
    // "l'enregistrement a échoué" for it is simply wrong.
    (globalThis as { window?: unknown }).window = {
      showSaveFilePicker: () => Promise.reject(new DOMException("abort", "AbortError")),
    };
    expect(await saveProjectFileAs(named("Test"))).toBe(false);
  });

  it("lets a real failure through", async () => {
    (globalThis as { window?: unknown }).window = {
      showSaveFilePicker: () => Promise.reject(new Error("disk on fire")),
    };
    await expect(saveProjectFileAs(named("Test"))).rejects.toThrow("disk on fire");
  });

  it("falls back to a download where there is no native dialog", async () => {
    // Safari and the macOS WKWebView shell: a fallback, not an error path.
    capture = installDownloadCapture();
    (globalThis as { window?: unknown }).window = {};
    expect(await saveProjectFileAs(named("Aérodrome"))).toBe(true);
    expect(capture.fileName).toBe("aerodrome.kl.json");
  });
});

describe("readProjectFile", () => {
  const asFile = (text: string) => new File([text], "plan.kl.json", { type: "application/json" });

  it("opens a file this app wrote", async () => {
    const result = await readProjectFile(asFile(serializeProject(named("Aérodrome"))));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.file.project.name).toBe("Aérodrome");
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
