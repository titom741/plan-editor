import { describe, expect, it } from "vitest";
import { buildSchedule, scheduleToCsv } from "./catalog";
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
