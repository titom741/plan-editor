import { describe, expect, it } from "vitest";
import { createDemoProject } from "../domain/project";
import { createViewport, zoomViewportAt } from "./viewport";

describe("zoom does not mutate the business model", () => {
  it("leaves widthM / heightM / xM / yM untouched after zooming and panning", () => {
    const project = createDemoProject();
    const before = structuredClone(project.objects);

    let viewport = createViewport(project.calibration.pixelsPerMeter);
    viewport = zoomViewportAt(viewport, { x: 150, y: 150 }, 5);
    viewport = zoomViewportAt(viewport, { x: 40, y: 400 }, 0.3);

    // Zooming operates purely on the viewport — the project itself is
    // never touched by any conversion helper.
    expect(project.objects).toEqual(before);
    expect(viewport.zoom).not.toBe(1);

    const chapiteau = project.objects[0];
    expect(chapiteau).toBeDefined();
    if (chapiteau?.type === "rectangle") {
      expect(chapiteau.widthM).toBe(10);
      expect(chapiteau.heightM).toBe(5);
      expect(chapiteau.xM).toBe(10);
      expect(chapiteau.yM).toBe(10);
    }
  });
});
