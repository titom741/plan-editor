import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createEmptyProject } from "../domain/project";
import { installFakeIndexedDb } from "../testing/fakeIndexedDb";
import { toProjectFile } from "./projectFile";
import { getPlanHost, type PlanHost } from "./planHost";
import {
  deleteStoredProject,
  listProjectVersions,
  listStoredProjects,
  loadAutosavedProject,
  loadStoredProject,
  renameStoredProject,
  saveAutosavedProject,
  saveProjectVersion,
} from "./projectStorage";
import { loadSaveFolder } from "./saveFolder";
import { deliverFile, FILE_DELIVERED_EVENT, type FileDelivered } from "../ui/deliverFile";

/**
 * KL-055 — inside Virade, the project library is Virade's. What can break
 * quietly: a save that still goes to IndexedDB (and never reaches Virade's
 * backups), a host answer trusted without validation, or an export that
 * vanishes when the host refuses it.
 */

interface Stored {
  name: string;
  location: string;
  objectCount: number;
  file: string;
}

function fakeHost(overrides: Partial<PlanHost> = {}) {
  const plans = new Map<string, Stored>();
  let current: string | null = null;
  const host: PlanHost = {
    name: "Virade",
    scope: () => Promise.resolve("2026"),
    list: () =>
      Promise.resolve(
        JSON.stringify(
          [...plans.entries()].map(([id, plan]) => ({
            id,
            name: plan.name,
            location: plan.location,
            savedAt: "2026-09-30T08:00:00.000Z",
            updatedAt: "2026-09-30T08:00:00.000Z",
            objectCount: plan.objectCount,
            scope: "2026",
            readOnly: false,
          })),
        ),
      ),
    load: (id) => {
      current = plans.has(id) ? id : current;
      return Promise.resolve(plans.get(id)?.file ?? null);
    },
    loadCurrent: () =>
      Promise.resolve(current === null ? null : (plans.get(current)?.file ?? null)),
    save: (id, name, location, objectCount, file) => {
      plans.set(id, { name, location, objectCount, file });
      current = id;
      return Promise.resolve("2026-09-30T08:00:00.000Z");
    },
    remove: (id) => Promise.resolve(plans.delete(id)),
    exportFolder: () => Promise.resolve("/Users/x/Documents/Virade/2026 - Ballaison/Implantation"),
    ...overrides,
  };
  return { host, plans };
}

/** The tests run without a DOM: a window is an event target with a parent, and a document just enough for a download. */
type FakeWindow = EventTarget & { parent: unknown };
const globals = globalThis as { window?: FakeWindow; document?: unknown };
let win: FakeWindow;

function installParent(parent: unknown) {
  win.parent = parent;
}

beforeEach(() => {
  installFakeIndexedDb();
  win = Object.assign(new EventTarget(), { parent: null as unknown });
  win.parent = win;
  globals.window = win;
  globals.document = {
    createElement: () => ({ click() {}, remove() {} }),
    body: { appendChild() {} },
  };
});

afterEach(() => {
  delete globals.window;
  delete globals.document;
  vi.restoreAllMocks();
});

describe("getPlanHost", () => {
  it("is absent in a plain tab, and in a frame whose parent offers nothing usable", () => {
    expect(getPlanHost()).toBeNull();
    installParent({ planEditorHost: { name: "Virade" } });
    expect(getPlanHost()).toBeNull();
  });

  it("is absent, not an error, behind a cross-origin parent", () => {
    installParent(
      new Proxy(
        {},
        {
          get() {
            throw new DOMException("Blocked a frame", "SecurityError");
          },
        },
      ),
    );
    expect(getPlanHost()).toBeNull();
  });
});

describe("the project library inside a host", () => {
  it("saves to the host, reopens from it, and never writes the project to IndexedDB", async () => {
    const { host, plans } = fakeHost();
    installParent({ planEditorHost: host });
    const project = createEmptyProject({ name: "Stands", location: "Place de la mairie" });

    expect(await saveAutosavedProject(project)).toEqual({
      status: "saved",
      savedAt: "2026-09-30T08:00:00.000Z",
    });
    expect(plans.get(project.id)).toMatchObject({ name: "Stands", location: "Place de la mairie" });

    const reopened = await loadAutosavedProject();
    expect(reopened.status).toBe("loaded");
    if (reopened.status === "loaded") expect(reopened.file.project.id).toBe(project.id);

    // Outside the host, the browser's library knows nothing of it.
    installParent(win);
    expect(await listStoredProjects()).toEqual([]);
  });

  it("lists, renames and deletes through the host, with the year each plan is filed under", async () => {
    const { host, plans } = fakeHost();
    installParent({ planEditorHost: host });
    const project = createEmptyProject({ name: "Sécurité" });
    await saveAutosavedProject(project);

    const listed = await listStoredProjects();
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      id: project.id,
      name: "Sécurité",
      scope: "2026",
      readOnly: false,
    });

    expect(await renameStoredProject(project.id, "Sécurité et secours")).toBe(true);
    expect(plans.get(project.id)?.name).toBe("Sécurité et secours");

    expect(await deleteStoredProject(project.id)).toBe(true);
    expect(plans.size).toBe(0);
  });

  it("keeps dated versions local: the host keeps plans, not a trail of every one of them", async () => {
    const { host, plans } = fakeHost();
    installParent({ planEditorHost: host });
    const project = createEmptyProject({ name: "Stands" });
    await saveProjectVersion(project);
    expect(plans.size).toBe(0);
    expect(await listProjectVersions(project.id)).toHaveLength(1);
  });

  it("validates what the host answers, and says when it does not answer", async () => {
    installParent({
      planEditorHost: fakeHost({ load: () => Promise.resolve("{ pas du json") }).host,
    });
    expect((await loadStoredProject("x")).status).toBe("corrupt");

    installParent({
      planEditorHost: fakeHost({ load: () => Promise.resolve(JSON.stringify({ format: "autre" })) })
        .host,
    });
    expect((await loadStoredProject("x")).status).toBe("corrupt");

    installParent({
      planEditorHost: fakeHost({ loadCurrent: () => Promise.reject(new Error("arrêté")) }).host,
    });
    expect((await loadAutosavedProject()).status).toBe("unavailable");

    installParent({
      planEditorHost: fakeHost({ save: () => Promise.reject(new Error("Édition clôturée")) }).host,
    });
    expect(await saveAutosavedProject(createEmptyProject({ name: "x" }))).toEqual({
      status: "failed",
      message: "Édition clôturée",
    });

    installParent({
      planEditorHost: fakeHost({ list: () => Promise.resolve('{"pas":"une liste"}') }).host,
    });
    expect(await listStoredProjects()).toEqual([]);
  });

  it("round-trips a real project file", async () => {
    const { host } = fakeHost();
    installParent({ planEditorHost: host });
    const project = createEmptyProject({ name: "Aller-retour" });
    await host.save(project.id, project.name, "", 0, JSON.stringify(toProjectFile(project)));
    const loaded = await loadStoredProject(project.id);
    expect(loaded.status).toBe("loaded");
  });
});

describe("files inside a host", () => {
  it("opens save dialogs in the host's folder", async () => {
    installParent({ planEditorHost: fakeHost().host });
    expect(await loadSaveFolder()).toEqual({
      kind: "path",
      path: "/Users/x/Documents/Virade/2026 - Ballaison/Implantation",
      name: "Implantation",
    });
  });

  it("files an export with the host and says where, instead of downloading it", async () => {
    const saveFile = vi.fn((name: string, base64: string) => {
      void base64;
      return Promise.resolve(`/Virade/2026/Implantation/${name}`);
    });
    installParent({ planEditorHost: { ...fakeHost().host, saveFile } });
    const createUrl = vi.spyOn(URL, "createObjectURL");
    const delivered = new Promise<FileDelivered>((resolve) =>
      win.addEventListener(
        FILE_DELIVERED_EVENT,
        (event) => resolve((event as CustomEvent<FileDelivered>).detail),
        {
          once: true,
        },
      ),
    );

    deliverFile(new Blob(["%PDF"], { type: "application/pdf" }), "plan.pdf");
    expect(await delivered).toEqual({
      fileName: "plan.pdf",
      path: "/Virade/2026/Implantation/plan.pdf",
      error: null,
    });
    expect(saveFile).toHaveBeenCalledWith("plan.pdf", btoa("%PDF"));
    expect(createUrl).not.toHaveBeenCalled();
  });

  it("downloads the file after all when the host refuses it", async () => {
    installParent({
      planEditorHost: {
        ...fakeHost().host,
        saveFile: () => Promise.reject(new Error("disque plein")),
      },
    });
    const createUrl = vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:x");
    vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => undefined);
    const delivered = new Promise<FileDelivered>((resolve) =>
      win.addEventListener(
        FILE_DELIVERED_EVENT,
        (event) => resolve((event as CustomEvent<FileDelivered>).detail),
        {
          once: true,
        },
      ),
    );

    deliverFile(new Blob(["x"]), "plan.png");
    const detail = await delivered;
    expect(detail.error).toMatch(/disque plein.*téléchargé à la place/);
    expect(createUrl).toHaveBeenCalledTimes(1);
  });
});
