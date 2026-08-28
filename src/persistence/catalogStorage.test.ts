import { beforeEach, describe, expect, it } from "vitest";
import {
  addCustomCatalogItem,
  deleteCustomCatalogItem,
  loadCustomCatalog,
  loadHiddenCatalogIds,
  saveCustomCatalog,
  toggleHiddenCatalogId,
  updateCustomCatalogItem,
  type CatalogItemDraft,
} from "./catalogStorage";
import { installFullStorage, installMemoryStorage } from "../testing/memoryStorage";

const ITEMS_KEY = "kl-implantation/catalog-items/v1";
const HIDDEN_KEY = "kl-implantation/catalog-hidden/v1";

const rectangleDraft: CatalogItemDraft = {
  name: "Stand 3 × 3",
  category: "Structures",
  reference: "STD-3X3",
  shape: "rectangle",
  widthM: 3,
  heightM: 3,
  unit: "u",
  style: { fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 0.08, opacity: 0.9 },
};

/** Writes raw JSON the way a previous build — or a hand-edited store — would. */
function seed(key: string, value: unknown): void {
  localStorage.setItem(key, JSON.stringify(value));
}

describe("custom catalogue", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("starts empty", () => {
    expect(loadCustomCatalog()).toEqual([]);
  });

  it("adds, edits and removes an item", () => {
    const [added] = addCustomCatalogItem(rectangleDraft);
    expect(added?.name).toBe("Stand 3 × 3");
    expect(added?.id).toMatch(/^catalog/);

    const updated = updateCustomCatalogItem(added!.id, { ...rectangleDraft, widthM: 4 });
    expect(updated).toHaveLength(1);
    expect(updated[0]?.widthM).toBe(4);
    // The id belongs to the store, not to the draft: editing must not
    // mint a new one, or every plan referencing it loses its link.
    expect(updated[0]?.id).toBe(added!.id);

    expect(deleteCustomCatalogItem(added!.id)).toEqual([]);
    expect(loadCustomCatalog()).toEqual([]);
  });

  it("survives a reload", () => {
    addCustomCatalogItem(rectangleDraft);
    expect(loadCustomCatalog()).toHaveLength(1);
    expect(loadCustomCatalog()[0]?.reference).toBe("STD-3X3");
  });

  it("keeps the good items when one entry is broken", () => {
    seed(ITEMS_KEY, [
      { ...rectangleDraft, id: "a" },
      { id: "b" },
      null,
      "not an item",
      { ...rectangleDraft, id: "c", name: "Stand 4 × 4" },
    ]);
    expect(loadCustomCatalog().map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("refuses a shape that has lost its geometry", () => {
    // Inserting one would drop a silent 1 × 1 m placeholder on the plan
    // carrying the user's own name and reference.
    seed(ITEMS_KEY, [
      { ...rectangleDraft, id: "no-size", widthM: undefined, heightM: undefined },
      { ...rectangleDraft, id: "half-size", heightM: undefined },
      { ...rectangleDraft, id: "circle-no-radius", shape: "circle" },
      { ...rectangleDraft, id: "line-no-points", shape: "line" },
      { ...rectangleDraft, id: "line-one-point", shape: "line", pointsM: [{ xM: 0, yM: 0 }] },
      {
        ...rectangleDraft,
        id: "polygon-two-points",
        shape: "polygon",
        pointsM: [
          { xM: 0, yM: 0 },
          { xM: 1, yM: 0 },
        ],
      },
    ]);
    expect(loadCustomCatalog()).toEqual([]);
  });

  it("accepts a line and a polygon that do carry enough points", () => {
    seed(ITEMS_KEY, [
      {
        ...rectangleDraft,
        id: "line",
        shape: "line",
        pointsM: [
          { xM: 0, yM: 0 },
          { xM: 2, yM: 0 },
        ],
      },
      {
        ...rectangleDraft,
        id: "polygon",
        shape: "polygon",
        pointsM: [
          { xM: 0, yM: 0 },
          { xM: 2, yM: 0 },
          { xM: 2, yM: 2 },
        ],
      },
    ]);
    expect(loadCustomCatalog().map((item) => item.id)).toEqual(["line", "polygon"]);
    expect(loadCustomCatalog()[1]?.pointsM).toHaveLength(3);
  });

  it("drops the points that aren't points, not the item", () => {
    seed(ITEMS_KEY, [
      {
        ...rectangleDraft,
        id: "line",
        shape: "line",
        pointsM: [{ xM: 0, yM: 0 }, "nope", { xM: 2, yM: Number.NaN }, { xM: 2, yM: 0 }],
      },
    ]);
    expect(loadCustomCatalog()[0]?.pointsM).toEqual([
      { xM: 0, yM: 0 },
      { xM: 2, yM: 0 },
    ]);
  });

  it("rejects a shape this build doesn't know", () => {
    seed(ITEMS_KEY, [{ ...rectangleDraft, id: "a", shape: "hexagon" }]);
    expect(loadCustomCatalog()).toEqual([]);
  });

  it("ignores a negative or zero size rather than trusting it", () => {
    seed(ITEMS_KEY, [{ ...rectangleDraft, id: "a", widthM: -3 }]);
    expect(loadCustomCatalog()).toEqual([]);
  });

  it("fills in the optional fields it can default", () => {
    seed(ITEMS_KEY, [{ id: "a", name: "Bloc", shape: "rectangle", widthM: 1, heightM: 1 }]);
    const [item] = loadCustomCatalog();
    expect(item?.category).toBe("Personnel");
    expect(item?.reference).toBe("");
    expect(item?.unit).toBe("u");
    expect(item?.style).toEqual({});
  });

  it("survives a stored value that isn't an array", () => {
    localStorage.setItem(ITEMS_KEY, "42");
    expect(loadCustomCatalog()).toEqual([]);
    localStorage.setItem(ITEMS_KEY, "{ not json");
    expect(loadCustomCatalog()).toEqual([]);
  });

  it("does not throw when the store refuses the write", () => {
    installFullStorage();
    // The editor must keep working with storage disabled; the item is
    // just not remembered for next time.
    expect(() => saveCustomCatalog([{ ...rectangleDraft, id: "a" }])).not.toThrow();
  });
});

describe("hidden built-in items", () => {
  beforeEach(() => {
    installMemoryStorage();
  });

  it("hides and unhides", () => {
    expect([...loadHiddenCatalogIds()]).toEqual([]);
    expect([...toggleHiddenCatalogId("truck")]).toEqual(["truck"]);
    expect([...loadHiddenCatalogIds()]).toEqual(["truck"]);
    expect([...toggleHiddenCatalogId("truck")]).toEqual([]);
    expect([...loadHiddenCatalogIds()]).toEqual([]);
  });

  it("keeps only the ids that are strings", () => {
    seed(HIDDEN_KEY, ["truck", 7, null, "chair"]);
    expect([...loadHiddenCatalogIds()].sort()).toEqual(["chair", "truck"]);
  });

  it("survives a stored value that isn't an array", () => {
    localStorage.setItem(HIDDEN_KEY, '"truck"');
    expect([...loadHiddenCatalogIds()]).toEqual([]);
  });
});
