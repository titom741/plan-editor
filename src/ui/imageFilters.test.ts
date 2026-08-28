import { describe, expect, it } from "vitest";
import { createWhiteRemovalFilter } from "./imageFilters";

describe("createWhiteRemovalFilter", () => {
  it("rend uniquement les pixels proches du blanc transparents", () => {
    const image = { data: new Uint8ClampedArray([250, 250, 250, 255, 240, 250, 250, 255]) } as ImageData;
    createWhiteRemovalFilter(245)(image);
    expect([...image.data]).toEqual([250, 250, 250, 0, 240, 250, 250, 255]);
  });
});
