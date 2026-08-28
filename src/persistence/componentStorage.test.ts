import { beforeEach, describe, expect, it } from "vitest";
import { createRectangleObject } from "../domain/objects";
import {
  deleteComponentTemplate,
  loadComponentTemplates,
  saveComponentTemplate,
} from "./componentStorage";
import { installFullStorage, installMemoryStorage } from "../testing/memoryStorage";

const STORAGE_KEY = "kl-implantation/component-templates/v1";
const LEGACY_KEY = "kl-component-templates-v1";

const objects = () => [
  createRectangleObject({
    layerId: "layer-1",
    name: "Stand",
    xM: 1,
    yM: 2,
    widthM: 3,
    heightM: 3,
  }),
];

describe("component templates", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("starts empty", () => {
    expect(loadComponentTemplates()).toEqual([]);
  });

  it("saves a template and reads it back", () => {
    const saved = saveComponentTemplate("Îlot de 4 stands", objects());
    expect(saved.id).toMatch(/^component/);
    const [loaded] = loadComponentTemplates();
    expect(loaded?.name).toBe("Îlot de 4 stands");
    expect(loaded?.objects).toHaveLength(1);
    expect(loaded?.objects[0]?.xM).toBe(1);
  });

  it("names an unnamed template rather than storing a blank one", () => {
    expect(saveComponentTemplate("   ", objects()).name).toBe("Composant");
  });

  it("copies the objects it is handed", () => {
    // The caller's objects go on living in the plan; a template that
    // aliased them would mutate with it.
    const source = objects();
    saveComponentTemplate("Bloc", source);
    source[0]!.xM = 999;
    expect(loadComponentTemplates()[0]?.objects[0]?.xM).toBe(1);
  });

  it("deletes by id and leaves the rest", () => {
    const first = saveComponentTemplate("A", objects());
    saveComponentTemplate("B", objects());
    const remaining = deleteComponentTemplate(first.id);
    expect(remaining.map((template) => template.name)).toEqual(["B"]);
    expect(loadComponentTemplates()).toHaveLength(1);
  });

  it("skips a template whose objects no longer validate", () => {
    // A convenience the user can recreate in seconds: dropping the broken
    // one beats refusing to open the library at all.
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([
        { id: "a", name: "Bon", objects: [] },
        { id: "b", name: "Cassé", objects: [{ type: "rectangle" }] },
        { id: "c", name: "Sans objets" },
        { id: "d" },
        null,
      ]),
    );
    expect(loadComponentTemplates().map((template) => template.id)).toEqual(["a"]);
  });

  it("reads a library written under the pre-refactor key", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([{ id: "a", name: "Ancien", objects: [] }]));
    expect(loadComponentTemplates().map((template) => template.name)).toEqual(["Ancien"]);
  });

  it("retires the legacy key on the next write", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([{ id: "a", name: "Ancien", objects: [] }]));
    saveComponentTemplate("Nouveau", objects());
    expect(localStorage.getItem(LEGACY_KEY)).toBeNull();
    expect(loadComponentTemplates().map((template) => template.name)).toEqual([
      "Ancien",
      "Nouveau",
    ]);
  });

  it("prefers the current key when both exist", () => {
    localStorage.setItem(LEGACY_KEY, JSON.stringify([{ id: "a", name: "Ancien", objects: [] }]));
    localStorage.setItem(STORAGE_KEY, JSON.stringify([{ id: "b", name: "Actuel", objects: [] }]));
    expect(loadComponentTemplates().map((template) => template.name)).toEqual(["Actuel"]);
  });

  it("survives a stored value that isn't an array", () => {
    localStorage.setItem(STORAGE_KEY, "42");
    expect(loadComponentTemplates()).toEqual([]);
    localStorage.setItem(STORAGE_KEY, "{ not json");
    expect(loadComponentTemplates()).toEqual([]);
  });

  it("does not throw when the store refuses the write", () => {
    installFullStorage();
    expect(() => saveComponentTemplate("Bloc", objects())).not.toThrow();
  });
});
