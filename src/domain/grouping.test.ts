import { describe, expect, it } from "vitest";
import { createRectangleObject, createTextObject } from "./objects";
import { clearGroup, createNamedGroup, distributeObjects, transformObjectAroundPivot } from "./grouping";

describe("transformObjectAroundPivot", () => {
  it("redimensionne et tourne une forme autour du pivot commun", () => {
    const rectangle = createRectangleObject({ layerId: "l", name: "R", xM: 10, yM: 0, widthM: 4, heightM: 2 });
    const transformed = transformObjectAroundPivot(rectangle, { xM: 0, yM: 0 }, 2, 90);
    expect(transformed.xM).toBeCloseTo(0, 9);
    expect(transformed.yM).toBeCloseTo(20, 9);
    expect(transformed.type === "rectangle" && transformed.widthM).toBe(8);
    expect(transformed.rotationDeg).toBe(90);
  });

  it("met aussi à l'échelle le texte", () => {
    const text = createTextObject({ layerId: "l", name: "T", xM: 1, yM: 1, text: "Texte", fontSizeM: 0.5 });
    const transformed = transformObjectAroundPivot(text, { xM: 0, yM: 0 }, 1.5, 0);
    expect(transformed.type === "text" && transformed.fontSizeM).toBe(0.75);
  });
});

describe("distributeObjects", () => {
  it("répartit trois centres à distance égale", () => {
    const source = [0, 2, 10].map((xM, index) => createRectangleObject({ layerId: "l", name: String(index), xM, yM: 0, widthM: 1, heightM: 1 }));
    expect(distributeObjects(source, "x").map((object) => object.xM)).toEqual([0, 5, 10]);
  });
});

describe("groupes nommés", () => {
  it("attribue un identifiant partagé puis sait dégrouper", () => {
    const source = [createRectangleObject({ layerId: "l", name: "R", xM: 0, yM: 0, widthM: 1, heightM: 1 })];
    const grouped = createNamedGroup(source, "Scène complète");
    expect(grouped[0]?.groupName).toBe("Scène complète");
    expect(grouped[0]?.groupId).toBeTruthy();
    expect(clearGroup(grouped)[0]?.groupId).toBeUndefined();
  });
});
