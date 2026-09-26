import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installFakeIndexedDb, type FakeIndexedDb } from "../testing/fakeIndexedDb";
import { installMemoryStorage } from "../testing/memoryStorage";
import { canPickFolderInBrowser, loadSaveFolder, storeSaveFolder } from "./saveFolder";

/** A stand-in for a `FileSystemDirectoryHandle`: IndexedDB keeps it as a plain structured value. */
const handle = (name: string) =>
  ({ kind: "directory", name }) as unknown as FileSystemDirectoryHandle;

let db: FakeIndexedDb;

beforeEach(() => {
  installMemoryStorage();
  db = installFakeIndexedDb();
});

afterEach(() => {
  db.restore();
  delete (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker;
});

describe("save folder setting (KL-053)", () => {
  it("is unset until chosen", async () => {
    expect(await loadSaveFolder()).toBeNull();
  });

  it("keeps the macOS app's folder as a path, full path included", async () => {
    const folder = { kind: "path" as const, path: "/Users/tom/Virade/Plans", name: "Plans" };
    expect(await storeSaveFolder(folder)).toEqual(folder);
    expect(await loadSaveFolder()).toEqual(folder);
  });

  it("keeps a browser's folder as a directory handle in IndexedDB", async () => {
    const folder = { kind: "handle" as const, handle: handle("Plans"), name: "Plans" };
    await storeSaveFolder(folder);
    expect(await loadSaveFolder()).toEqual({
      kind: "handle",
      handle: handle("Plans"),
      name: "Plans",
    });
  });

  it("forgets both kinds when cleared", async () => {
    await storeSaveFolder({ kind: "path", path: "/a", name: "a" });
    await storeSaveFolder(null);
    expect(await loadSaveFolder()).toBeNull();
    await storeSaveFolder({ kind: "handle", handle: handle("b"), name: "b" });
    await storeSaveFolder(null);
    expect(await loadSaveFolder()).toBeNull();
  });

  it("replaces a handle by a path, and a path by a handle", async () => {
    await storeSaveFolder({ kind: "handle", handle: handle("b"), name: "b" });
    await storeSaveFolder({ kind: "path", path: "/a", name: "a" });
    expect(await loadSaveFolder()).toMatchObject({ kind: "path", path: "/a" });
    await storeSaveFolder({ kind: "handle", handle: handle("c"), name: "c" });
    expect(await loadSaveFolder()).toMatchObject({ kind: "handle", name: "c" });
  });

  it("treats a corrupt stored path as no setting rather than failing", async () => {
    localStorage.setItem("kl-implantation/save-folder/v1", "{not json");
    expect(await loadSaveFolder()).toBeNull();
    localStorage.setItem("kl-implantation/save-folder/v1", JSON.stringify({ path: "" }));
    expect(await loadSaveFolder()).toBeNull();
  });

  it("says a browser handle was not kept when IndexedDB is unavailable", async () => {
    db.restore();
    db = installFakeIndexedDb({ unavailable: true });
    expect(
      await storeSaveFolder({ kind: "handle", handle: handle("Plans"), name: "Plans" }),
    ).toBeNull();
    expect(await loadSaveFolder()).toBeNull();
  });

  it("knows whether this browser can pick a folder at all", () => {
    expect(canPickFolderInBrowser()).toBe(false);
    (globalThis as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined;
    expect(canPickFolderInBrowser()).toBe(true);
  });
});
