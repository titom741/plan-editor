import { describe, expect, it } from "vitest";
import { SpatialPointIndex } from "./spatialIndex";

describe("SpatialPointIndex", () => {
  it("ne retourne que les cellules voisines de la requête", () => {
    const near = { id: "near", pointM: { xM: 2, yM: 3 } }; const far = { id: "far", pointM: { xM: 1000, yM: 1000 } };
    const index = new SpatialPointIndex([near, far], 10);
    expect(index.query({ xM: 0, yM: 0 }, 5)).toContain(near);
    expect(index.query({ xM: 0, yM: 0 }, 5)).not.toContain(far);
  });
});
