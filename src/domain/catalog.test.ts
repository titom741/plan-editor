import { describe, expect, it } from "vitest";
import { MATERIAL_CATALOG, buildSchedule, groupCatalog, scheduleToCsv } from "./catalog";
import { directLoadSocket } from "./electrical";
import { createLineObject, createPolygonObject, createRectangleObject } from "./objects";

describe("material schedule", () => {
  it("groups matching objects and adds represented quantities", () => {
    const common = { layerId: "layer", name: "Barrière", xM: 0, yM: 0, widthM: 2, heightM: 0.1 };
    const objects = [
      { ...createRectangleObject(common), category: "Sécurité", reference: "BAR", quantity: 3 },
      { ...createRectangleObject(common), category: "Sécurité", reference: "BAR", quantity: 2 },
    ];
    expect(buildSchedule(objects)).toEqual([
      {
        layer: "Calque inconnu",
        category: "Sécurité",
        reference: "BAR",
        name: "Barrière",
        quantity: 5,
        unit: "u",
      },
    ]);
  });

  it("derives cable lengths and zone areas when no manual unit is set", () => {
    const cable = createLineObject({
      layerId: "tech",
      name: "Câble",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 3, yM: 4 },
      ],
    });
    const zone = createPolygonObject({
      layerId: "tech",
      name: "Zone",
      xM: 0,
      yM: 0,
      pointsM: [
        { xM: 0, yM: 0 },
        { xM: 2, yM: 0 },
        { xM: 2, yM: 3 },
      ],
    });
    const rows = buildSchedule(
      [cable, zone],
      [{ id: "tech", name: "Technique", visible: true, locked: false, order: 0 }],
    );
    expect(rows.find((row) => row.name === "Câble")).toMatchObject({
      layer: "Technique",
      quantity: 5,
      unit: "m",
    });
    expect(rows.find((row) => row.name === "Zone")).toMatchObject({
      layer: "Technique",
      quantity: 3,
      unit: "m²",
    });
  });

  it("creates a French spreadsheet-friendly CSV", () => {
    expect(
      scheduleToCsv([
        {
          layer: "Mobilier",
          category: "Mobilier",
          reference: "T1",
          name: "Table",
          quantity: 2,
          unit: "u",
        },
      ]),
    ).toContain('"Mobilier";"Mobilier";"T1";"Table";"2";"u"');
  });
});

describe("material catalogue", () => {
  it("gives every item its own id", () => {
    const ids = MATERIAL_CATALOG.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("offers a range of single-phase consumers, each on a socket that exists", () => {
    const monoLoads = MATERIAL_CATALOG.flatMap((item) =>
      item.electrical?.role === "load" && item.electrical.phases === "mono" ? [item] : [],
    );
    expect(monoLoads.length).toBeGreaterThanOrEqual(24);
    for (const item of monoLoads) {
      if (item.electrical?.role !== "load") continue;
      expect(item.electrical.powerW, item.name).toBeGreaterThan(0);
      for (const character of item.name)
        expect(character.codePointAt(0)!).toBeLessThanOrEqual(0xff);
      // Everything domestic fits a 16 A socket; nothing single-phase here needs more.
      expect(directLoadSocket(item.electrical).ratingA, item.name).toBe(16);
    }
  });

  it("offers a range of three-phase consumers, each on a socket that exists", () => {
    const triLoads = MATERIAL_CATALOG.flatMap((item) =>
      item.electrical?.role === "load" && item.electrical.phases === "tri" ? [item] : [],
    );
    expect(triLoads.length).toBeGreaterThanOrEqual(12);
    // A name that says "tri" is a promise the characteristics must keep.
    for (const item of MATERIAL_CATALOG) {
      if (item.electrical?.role === "load" && item.name.endsWith(" tri")) {
        expect(item.electrical.phases, item.name).toBe("tri");
      }
    }
    for (const item of triLoads) {
      if (item.electrical?.role !== "load") continue;
      expect(item.shape, item.name).toBe("circle");
      expect(item.electrical.powerW, item.name).toBeGreaterThan(0);
      // Their names end up in PDFs, which print Latin-1 only.
      for (const character of item.name)
        expect(character.codePointAt(0)!).toBeLessThanOrEqual(0xff);
      expect([16, 32, 63, 125]).toContain(directLoadSocket(item.electrical).ratingA);
    }
  });
});

describe("groupCatalog (KL-052)", () => {
  const sections = groupCatalog(MATERIAL_CATALOG);
  const section = (category: string) => sections.find((s) => s.category === category)!;

  it("orders categories from structures to drawing aids", () => {
    expect(sections.map((s) => s.category)).toEqual([
      "Structures",
      "Mobilier",
      "Sanitaires",
      "Déchets",
      "Services",
      "Sécurité",
      "Électricité",
      "Véhicules",
      "Architecture",
      "Dessin",
    ]);
  });

  it("puts a category it doesn't know after the known ones, alphabetically", () => {
    const own = (category: string) => ({ ...MATERIAL_CATALOG[0]!, id: category, category });
    const grouped = groupCatalog([own("Zones"), own("Animations"), ...MATERIAL_CATALOG]);
    expect(grouped.map((s) => s.category).slice(-2)).toEqual(["Animations", "Zones"]);
  });

  it("splits Électricité by role, and leaves the other categories whole", () => {
    expect(section("Électricité").groups.map((g) => g.label)).toEqual([
      "Alimentations",
      "Coffrets",
      "Câbles",
      "Multiprises",
      "Récepteurs monophasés",
      "Récepteurs triphasés",
    ]);
    expect(section("Mobilier").groups.map((g) => g.label)).toEqual([null]);
  });

  it("loses nothing and counts every item once", () => {
    const listed = sections.flatMap((s) => s.groups.flatMap((g) => g.items.map((i) => i.id)));
    expect(listed.sort()).toEqual(MATERIAL_CATALOG.map((i) => i.id).sort());
    for (const s of sections) {
      expect(s.count).toBe(s.groups.reduce((sum, g) => sum + g.items.length, 0));
    }
  });

  it("has toilets and sorting points where one would look for them", () => {
    const names = (category: string) =>
      section(category).groups.flatMap((g) => g.items.map((i) => i.name));
    expect(names("Sanitaires")).toEqual(
      expect.arrayContaining([
        "Toilette mobile (type Toi Toi)",
        "Toilette PMR",
        "Sanitaire mobile",
      ]),
    );
    expect(names("Déchets")).toEqual(
      expect.arrayContaining(["Colonne de tri 3 flux", "Colonne de tri 2 flux", "Point déchets"]),
    );
  });

  it("keeps an electrical-category item with no role in a group of its own", () => {
    const plain = { ...MATERIAL_CATALOG[0]!, id: "x", category: "Électricité" };
    const grouped = groupCatalog([plain]);
    expect(grouped[0]!.groups).toEqual([{ label: "Autres", items: [plain] }]);
  });
});
