import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRectangleObject } from "../domain/objects";
import { addObject, createEmptyProject } from "../domain/project";
import { installFakeIndexedDb, type FakeIndexedDb } from "../testing/fakeIndexedDb";
import { toProjectFile } from "./projectFile";
import {
  deleteStoredProject,
  duplicateStoredProject,
  listProjectVersions,
  listStoredProjects,
  loadAutosavedProject,
  loadProjectVersion,
  loadStoredProject,
  renameStoredProject,
  saveAutomaticProjectVersion,
  saveAutosavedProject,
  saveProjectVersion,
} from "./projectStorage";
import type { Project } from "../domain/types";

let db: FakeIndexedDb;

function project(name = "Aérodrome"): Project {
  const empty = createEmptyProject({ name });
  const layerId = empty.layers[0]!.id;
  return addObject(
    empty,
    createRectangleObject({
      layerId,
      name: "Chapiteau",
      xM: 0,
      yM: 0,
      widthM: 12,
      heightM: 6,
    }),
  );
}

beforeEach(() => {
  db = installFakeIndexedDb();
});

afterEach(() => {
  db.restore();
});

describe("the autosave record", () => {
  it("reports an empty store rather than inventing a project", async () => {
    expect(await loadAutosavedProject()).toEqual({ status: "empty" });
  });

  it("round-trips a project", async () => {
    const saved = await saveAutosavedProject(project());
    expect(saved.status).toBe("saved");

    const loaded = await loadAutosavedProject();
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;
    expect(loaded.file.project.name).toBe("Aérodrome");
    expect(loaded.file.project.objects).toHaveLength(1);
    const [restored] = loaded.file.project.objects;
    expect(restored?.type).toBe("rectangle");
    if (restored?.type !== "rectangle") return;
    // The geometry has to survive the round trip, not just the count.
    expect(restored.widthM).toBe(12);
    expect(restored.heightM).toBe(6);
  });

  it("also files the project under its own key, so it survives being replaced", async () => {
    // The autosave slot is overwritten by whatever document is opened
    // next; without this second write, opening a file would lose the one
    // before it.
    const original = project();
    await saveAutosavedProject(original);
    await saveAutosavedProject(project("Autre chantier"));

    const recovered = await loadStoredProject(original.id);
    expect(recovered.status).toBe("loaded");
    if (recovered.status !== "loaded") return;
    expect(recovered.file.project.name).toBe("Aérodrome");
  });

  it("validates what it reads back instead of trusting it", async () => {
    db.entries.set("autosave", { schemaVersion: 2, project: { name: "moitié écrit" } });
    const loaded = await loadAutosavedProject();
    // A record half-written when the tab was killed must be reported, not
    // swapped for a blank project the user would then autosave over.
    expect(loaded.status).toBe("corrupt");
  });

  it("reports a full quota rather than throwing", async () => {
    db.fillUp();
    expect(await saveAutosavedProject(project())).toEqual({ status: "quotaExceeded" });
  });
});

describe("with storage unavailable", () => {
  beforeEach(() => {
    db.restore();
    db = installFakeIndexedDb({ unavailable: true });
  });

  it("still lets the editor open and work", async () => {
    // Everything degrades to a documented result; nothing rejects.
    expect(await loadAutosavedProject()).toEqual({ status: "unavailable" });
    expect(await saveAutosavedProject(project())).toEqual({ status: "unavailable" });
    expect(await listStoredProjects()).toEqual([]);
    expect(await listProjectVersions("any")).toEqual([]);
    expect(await deleteStoredProject("any")).toBe(false);
    expect(await renameStoredProject("any", "x")).toBe(false);
    expect(await duplicateStoredProject("any")).toBeNull();
  });
});

describe("the stored project list", () => {
  it("is empty to start with", async () => {
    expect(await listStoredProjects()).toEqual([]);
  });

  it("summarises each project, newest save first", async () => {
    const first = { ...project("Premier"), id: "p1" };
    const second = { ...project("Second"), id: "p2" };
    db.entries.set("project:p1", { ...toProjectFile(first), savedAt: "2026-01-01T00:00:00.000Z" });
    db.entries.set("project:p2", { ...toProjectFile(second), savedAt: "2026-06-01T00:00:00.000Z" });

    const listed = await listStoredProjects();
    expect(listed.map((summary) => summary.name)).toEqual(["Second", "Premier"]);
    expect(listed[0]?.objectCount).toBe(1);
  });

  it("ignores the autosave slot and the version trail", async () => {
    // Otherwise the same document appears three times in the picker.
    await saveAutosavedProject(project());
    await saveProjectVersion(project());
    expect(await listStoredProjects()).toHaveLength(1);
  });

  it("skips a record that no longer validates instead of refusing the list", async () => {
    db.entries.set("project:good", toProjectFile({ ...project("Bon"), id: "good" }));
    db.entries.set("project:bad", { schemaVersion: 2, project: null });
    expect((await listStoredProjects()).map((summary) => summary.name)).toEqual(["Bon"]);
  });
});

describe("managing a stored project", () => {
  it("loads one by id and reports a missing one as empty", async () => {
    const saved = project();
    await saveAutosavedProject(saved);
    expect((await loadStoredProject(saved.id)).status).toBe("loaded");
    expect(await loadStoredProject("nope")).toEqual({ status: "empty" });
  });

  it("renames without touching the id", async () => {
    const saved = project();
    await saveAutosavedProject(saved);
    expect(await renameStoredProject(saved.id, "Nouveau nom")).toBe(true);

    const loaded = await loadStoredProject(saved.id);
    if (loaded.status !== "loaded") throw new Error("expected the project to load");
    expect(loaded.file.project.name).toBe("Nouveau nom");
    expect(loaded.file.project.id).toBe(saved.id);
  });

  it("keeps the old name rather than accepting a blank one", async () => {
    const saved = project();
    await saveAutosavedProject(saved);
    await renameStoredProject(saved.id, "   ");

    const loaded = await loadStoredProject(saved.id);
    if (loaded.status !== "loaded") throw new Error("expected the project to load");
    expect(loaded.file.project.name).toBe("Aérodrome");
  });

  it("refuses to rename a project that isn't there", async () => {
    expect(await renameStoredProject("nope", "x")).toBe(false);
  });

  it("duplicates under a new id, leaving the original alone", async () => {
    const saved = project();
    await saveAutosavedProject(saved);
    const copy = await duplicateStoredProject(saved.id);

    expect(copy).not.toBeNull();
    expect(copy!.id).not.toBe(saved.id);
    expect(copy!.name).toBe("Aérodrome — copie");
    expect(copy!.objects).toHaveLength(1);
    expect((await listStoredProjects()).map((summary) => summary.name).sort()).toEqual([
      "Aérodrome",
      "Aérodrome — copie",
    ]);
  });

  it("takes a name for the duplicate when one is given", async () => {
    const saved = project();
    await saveAutosavedProject(saved);
    expect((await duplicateStoredProject(saved.id, "Édition 2027"))?.name).toBe("Édition 2027");
  });

  it("deletes by id", async () => {
    const saved = project();
    await saveAutosavedProject(saved);
    expect(await deleteStoredProject(saved.id)).toBe(true);
    expect(await loadStoredProject(saved.id)).toEqual({ status: "empty" });
  });

  it("leaves the autosave slot alone when a project is deleted", async () => {
    // Deleting the open document from the picker must not blank the
    // session the user is still working in.
    const saved = project();
    await saveAutosavedProject(saved);
    await deleteStoredProject(saved.id);
    expect((await loadAutosavedProject()).status).toBe("loaded");
  });
});

describe("the version trail", () => {
  it("keeps a manual version and lists it as manual", async () => {
    const saved = project();
    expect((await saveProjectVersion(saved)).status).toBe("saved");

    const versions = await listProjectVersions(saved.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.automatic).toBe(false);
    expect(versions[0]?.name).toBe("Aérodrome");
    expect(versions[0]?.objectCount).toBe(1);
  });

  it("keeps each project's versions to itself", async () => {
    const mine = { ...project("Le mien"), id: "p1" };
    const other = { ...project("L'autre"), id: "p2" };
    await saveProjectVersion(mine);
    await saveProjectVersion(other);
    expect(await listProjectVersions("p1")).toHaveLength(1);
    expect((await listProjectVersions("p1"))[0]?.name).toBe("Le mien");
  });

  it("loads a version back by key", async () => {
    const saved = project();
    await saveProjectVersion(saved);
    const [version] = await listProjectVersions(saved.id);

    const loaded = await loadProjectVersion(version!.key);
    expect(loaded.status).toBe("loaded");
    if (loaded.status !== "loaded") return;
    expect(loaded.file.project.name).toBe("Aérodrome");
  });

  it("refuses a key that isn't a version key, even when a record is there", async () => {
    // Otherwise "restore this version" could be pointed at the live
    // autosave slot or at a project record. Both are seeded here on
    // purpose: without them the guard could be removed and this test
    // would still pass, on the record simply not existing.
    const saved = project();
    await saveAutosavedProject(saved);
    expect(db.entries.has("autosave")).toBe(true);
    expect(db.entries.has(`project:${saved.id}`)).toBe(true);

    expect(await loadProjectVersion("autosave")).toEqual({ status: "empty" });
    expect(await loadProjectVersion(`project:${saved.id}`)).toEqual({ status: "empty" });
  });

  it("takes an automatic version when there is none yet", async () => {
    const saved = project();
    await saveAutomaticProjectVersion(saved);
    const versions = await listProjectVersions(saved.id);
    expect(versions).toHaveLength(1);
    expect(versions[0]?.automatic).toBe(true);
  });

  it("holds off while a recent automatic version already covers the work", async () => {
    // Without the interval, an automatic version — background image
    // included — would be duplicated on every keystroke. The existing
    // version is seeded a minute back rather than taken in this test:
    // two calls in the same millisecond would share a key and overwrite
    // each other, which looks identical from the outside.
    const saved = project();
    const recent = new Date(Date.now() - 60 * 1000).toISOString();
    db.entries.set(`version:${saved.id}:auto:${recent}`, {
      ...toProjectFile(saved),
      savedAt: recent,
    });

    const result = await saveAutomaticProjectVersion(saved);
    expect(result).toEqual({ status: "saved", savedAt: recent });
    expect(await listProjectVersions(saved.id)).toHaveLength(1);
  });

  it("takes a new automatic version once the interval has passed", async () => {
    const saved = project();
    const stale = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.entries.set(`version:${saved.id}:auto:${stale}`, {
      ...toProjectFile(saved),
      savedAt: stale,
    });

    await saveAutomaticProjectVersion(saved);
    expect(await listProjectVersions(saved.id)).toHaveLength(2);
  });

  it("prunes the oldest automatic versions past the cap", async () => {
    const saved = project();
    for (let index = 0; index < 25; index += 1) {
      const savedAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
      db.entries.set(`version:${saved.id}:auto:${savedAt}`, {
        ...toProjectFile(saved),
        savedAt,
      });
    }
    await saveAutomaticProjectVersion(saved);

    const versions = await listProjectVersions(saved.id);
    expect(versions).toHaveLength(20);
    // Newest first, and the one just taken is at the top.
    expect(versions[0]!.savedAt > versions[19]!.savedAt).toBe(true);
  });

  it("never prunes a manual version", async () => {
    // A version the user asked for is a decision; an automatic one is a
    // safety net, and only the net is disposable.
    const saved = project();
    await saveProjectVersion(saved);
    for (let index = 0; index < 25; index += 1) {
      const savedAt = new Date(Date.UTC(2026, 0, index + 1)).toISOString();
      db.entries.set(`version:${saved.id}:auto:${savedAt}`, {
        ...toProjectFile(saved),
        savedAt,
      });
    }
    await saveAutomaticProjectVersion(saved);

    const versions = await listProjectVersions(saved.id);
    expect(versions.filter((version) => !version.automatic)).toHaveLength(1);
  });

  it("reports a full quota rather than throwing", async () => {
    db.fillUp();
    expect((await saveProjectVersion(project())).status).toBe("quotaExceeded");
  });
});
