import { describe, expect, it } from "vitest";
import {
  createDefaultLayers,
  createLayer,
  getLayerAfterRemoval,
  moveLayerInOrder,
  nextLayerName,
  normalizeLayerOrder,
  sortLayersByOrder,
} from "./layers";
import { createRectangleObject } from "./objects";
import {
  addLayer,
  assignObjectsToLayer,
  createEmptyProject,
  moveLayer,
  patchLayer,
  removeLayer,
  renameLayer,
} from "./project";
import type { Layer, Project } from "./types";

function layer(id: string, order: number, name = id): Layer {
  return { id, name, visible: true, locked: false, order };
}

function projectWithObjects(): Project {
  const base = createEmptyProject({ name: "P" });
  const [first, second] = base.layers;
  return {
    ...base,
    objects: [
      createRectangleObject({ layerId: first!.id, name: "a", xM: 0, yM: 0, widthM: 1, heightM: 1 }),
      createRectangleObject({ layerId: second!.id, name: "b", xM: 0, yM: 0, widthM: 1, heightM: 1 }),
    ],
  };
}

describe("layer ordering primitives", () => {
  const layers = [layer("c", 2), layer("a", 0), layer("b", 1)];

  it("sorts by order, not by array position", () => {
    expect(sortLayersByOrder(layers).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("renumbers order to 0..n-1 and leaves already-correct layers identical", () => {
    const messy = [layer("a", 0), layer("b", 5), layer("c", 9)];
    const normalized = normalizeLayerOrder(messy);
    expect(normalized.map((l) => l.order)).toEqual([0, 1, 2]);
    expect(normalized[0]).toBe(messy[0]);
  });

  it("moves a layer one step in either direction", () => {
    expect(moveLayerInOrder(layers, "a", 1).map((l) => l.id)).toEqual(["b", "a", "c"]);
    expect(moveLayerInOrder(layers, "c", -1).map((l) => l.id)).toEqual(["a", "c", "b"]);
  });

  it("is a no-op at either end, and still leaves order contiguous", () => {
    const bottom = moveLayerInOrder(layers, "a", -1);
    expect(bottom.map((l) => l.id)).toEqual(["a", "b", "c"]);
    expect(bottom.map((l) => l.order)).toEqual([0, 1, 2]);
    expect(moveLayerInOrder(layers, "c", 1).map((l) => l.id)).toEqual(["a", "b", "c"]);
  });

  it("picks the layer below as the home for orphaned objects, or the new bottom one", () => {
    expect(getLayerAfterRemoval(layers, "b")?.id).toBe("a");
    expect(getLayerAfterRemoval(layers, "a")?.id).toBe("b");
    expect(getLayerAfterRemoval(layers, "missing")).toBeUndefined();
  });

  it("names a new layer without colliding with an existing name", () => {
    expect(nextLayerName([])).toBe("Calque 1");
    expect(nextLayerName([layer("x", 0, "Calque 2")])).toBe("Calque 3");
    expect(createLayer(createDefaultLayers(), "  Scène  ").name).toBe("Scène");
  });

  it("puts a new layer on top", () => {
    const layers4 = createDefaultLayers();
    expect(createLayer(layers4).order).toBe(layers4.length);
  });
});

describe("layer operations on a project", () => {
  it("adds a layer and hands it back", () => {
    const { project, layer: added } = addLayer(projectWithObjects(), "Scène");
    expect(project.layers).toHaveLength(5);
    expect(added.name).toBe("Scène");
    expect(project.layers.at(-1)).toBe(added);
  });

  it("renames a layer but refuses a blank name", () => {
    const before = projectWithObjects();
    const id = before.layers[0]!.id;
    expect(renameLayer(before, id, "  Régie ").layers[0]!.name).toBe("Régie");
    expect(renameLayer(before, id, "   ")).toBe(before);
    expect(renameLayer(before, "ghost", "x")).toBe(before);
  });

  it("toggles visibility and lock", () => {
    const before = projectWithObjects();
    const id = before.layers[1]!.id;
    const after = patchLayer(before, id, { visible: false, locked: true });
    expect(after.layers[1]).toMatchObject({ visible: false, locked: true });
    expect(after.layers[0]).toBe(before.layers[0]);
  });

  it("reorders through the project", () => {
    const before = projectWithObjects();
    const moved = moveLayer(before, before.layers[0]!.id, 1);
    expect(sortLayersByOrder(moved.layers).map((l) => l.name)).toEqual([
      "Électricité",
      "Structures",
      "Sécurité",
      "Annotations",
    ]);
  });

  it("keeps a deleted layer's objects, moving them to the layer below", () => {
    const before = projectWithObjects();
    const doomed = before.layers[1]!; // "Électricité", holding object "b"
    const after = removeLayer(before, doomed.id);
    expect(after.layers).toHaveLength(3);
    expect(after.objects).toHaveLength(2);
    expect(after.objects[1]!.layerId).toBe(before.layers[0]!.id);
    expect(sortLayersByOrder(after.layers).map((l) => l.order)).toEqual([0, 1, 2]);
  });

  it("moves the bottom layer's objects up rather than stranding them", () => {
    const before = projectWithObjects();
    const after = removeLayer(before, before.layers[0]!.id);
    expect(after.objects[0]!.layerId).toBe(before.layers[1]!.id);
  });

  it("refuses to delete the last remaining layer", () => {
    const single: Project = { ...projectWithObjects(), layers: [layer("only", 0)] };
    expect(removeLayer(single, "only")).toBe(single);
  });

  it("assigns objects to another layer, and is a no-op when nothing would change", () => {
    const before = projectWithObjects();
    const target = before.layers[3]!.id;
    const after = assignObjectsToLayer(before, before.objects.map((o) => o.id), target);
    expect(after.objects.every((object) => object.layerId === target)).toBe(true);
    expect(assignObjectsToLayer(after, after.objects.map((o) => o.id), target)).toBe(after);
    expect(assignObjectsToLayer(before, [before.objects[0]!.id], "ghost")).toBe(before);
  });
});
