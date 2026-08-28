import { describe, expect, it } from "vitest";
import {
  constrainPointAngleM,
  CIRCLE_HANDLE_IDS,
  getCircleHandleWorld,
  getRectangleHandleWorld,
  getSegmentCount,
  getSegmentMidpointWorld,
  getVertexWorld,
  insertVertexAfter,
  isCornerHandle,
  MIN_SIZE_M,
  moveVertexTo,
  objectLocalToWorld,
  removeVertexAt,
  RESIZE_HANDLE_IDS,
  resizeRectangleFromHandle,
  worldToObjectLocal,
} from "./geometry";
import type { ResizeHandleId, VertexGeometry } from "./geometry";
import type { PointM } from "./types";

/** A rectangle, unrotated unless a test says otherwise. */
function rect(overrides: Partial<{ xM: number; yM: number; widthM: number; heightM: number; rotationDeg: number }> = {}) {
  return { xM: 10, yM: 20, widthM: 8, heightM: 4, rotationDeg: 0, ...overrides };
}

/** The handle diagonally opposite the one being dragged — the point that must never move. */
const OPPOSITE: Record<ResizeHandleId, ResizeHandleId> = {
  nw: "se",
  n: "s",
  ne: "sw",
  e: "w",
  se: "nw",
  s: "n",
  sw: "ne",
  w: "e",
};

describe("constrainPointAngleM", () => {
  it("conserve la longueur et contraint la direction au pas demandé", () => {
    const point = constrainPointAngleM({ xM: 0, yM: 0 }, { xM: 10, yM: 1 }, 15);
    expect(point.yM).toBeCloseTo(0, 9);
    expect(Math.hypot(point.xM, point.yM)).toBeCloseTo(Math.hypot(10, 1), 9);
  });
});

describe("worldToObjectLocal / objectLocalToWorld", () => {
  it("round-trips a point through a rotated frame", () => {
    const object = { xM: -3, yM: 7.5, rotationDeg: 37 };
    const world: PointM = { xM: 12.25, yM: -4.75 };
    const back = objectLocalToWorld(object, worldToObjectLocal(object, world));
    expect(back.xM).toBeCloseTo(world.xM, 9);
    expect(back.yM).toBeCloseTo(world.yM, 9);
  });

  it("maps the anchor to the local origin", () => {
    const object = { xM: 4, yM: 9, rotationDeg: 123 };
    const local = worldToObjectLocal(object, { xM: 4, yM: 9 });
    expect(local.xM).toBeCloseTo(0, 9);
    expect(local.yM).toBeCloseTo(0, 9);
  });
});

describe("getRectangleHandleWorld", () => {
  it("places the eight handles on the rectangle's corners and edge midpoints", () => {
    const object = rect();
    expect(getRectangleHandleWorld(object, "nw")).toEqual({ xM: 10, yM: 20 });
    expect(getRectangleHandleWorld(object, "n")).toEqual({ xM: 14, yM: 20 });
    expect(getRectangleHandleWorld(object, "ne")).toEqual({ xM: 18, yM: 20 });
    expect(getRectangleHandleWorld(object, "e")).toEqual({ xM: 18, yM: 22 });
    expect(getRectangleHandleWorld(object, "se")).toEqual({ xM: 18, yM: 24 });
    expect(getRectangleHandleWorld(object, "s")).toEqual({ xM: 14, yM: 24 });
    expect(getRectangleHandleWorld(object, "sw")).toEqual({ xM: 10, yM: 24 });
    expect(getRectangleHandleWorld(object, "w")).toEqual({ xM: 10, yM: 22 });
  });

  it("rotates the handles with the rectangle", () => {
    // At 90deg clockwise the local +x axis points along world +y.
    const handle = getRectangleHandleWorld(rect({ rotationDeg: 90 }), "ne");
    expect(handle.xM).toBeCloseTo(10, 9);
    expect(handle.yM).toBeCloseTo(28, 9);
  });
});

describe("isCornerHandle", () => {
  it("is true for the four corners and false for the four edges", () => {
    expect(RESIZE_HANDLE_IDS.filter(isCornerHandle)).toEqual(["nw", "ne", "se", "sw"]);
  });
});

describe("resizeRectangleFromHandle", () => {
  it("still behaves like the old bottom-right-only resize", () => {
    const resized = resizeRectangleFromHandle(rect(), "se", { xM: 25, yM: 33 });
    expect(resized).toEqual({ xM: 10, yM: 20, widthM: 15, heightM: 13 });
  });

  it("moves the anchor when the north-west corner is dragged", () => {
    const resized = resizeRectangleFromHandle(rect(), "nw", { xM: 6, yM: 18 });
    expect(resized.xM).toBeCloseTo(6, 9);
    expect(resized.yM).toBeCloseTo(18, 9);
    expect(resized.widthM).toBeCloseTo(12, 9);
    expect(resized.heightM).toBeCloseTo(6, 9);
  });

  it("leaves the other axis alone when an edge handle is dragged", () => {
    const east = resizeRectangleFromHandle(rect(), "e", { xM: 30, yM: 999 });
    expect(east.widthM).toBeCloseTo(20, 9);
    expect(east.heightM).toBeCloseTo(4, 9);
    expect(east.yM).toBeCloseTo(20, 9);

    const north = resizeRectangleFromHandle(rect(), "n", { xM: -999, yM: 17 });
    expect(north.heightM).toBeCloseTo(7, 9);
    expect(north.widthM).toBeCloseTo(8, 9);
    expect(north.xM).toBeCloseTo(10, 9);
  });

  it("keeps the opposite handle fixed in world space, for every handle at any rotation", () => {
    for (const rotationDeg of [0, 37, 90, 214, 359]) {
      for (const handle of RESIZE_HANDLE_IDS) {
        const object = rect({ rotationDeg });
        const before = getRectangleHandleWorld(object, OPPOSITE[handle]);
        const resized = resizeRectangleFromHandle(object, handle, { xM: 31.5, yM: 2.25 });
        const after = getRectangleHandleWorld({ ...object, ...resized }, OPPOSITE[handle]);
        expect(after.xM).toBeCloseTo(before.xM, 9);
        expect(after.yM).toBeCloseTo(before.yM, 9);
      }
    }
  });

  it("puts the dragged handle under the pointer when the drag is unconstrained", () => {
    // Only true when neither axis clamps: a pointer past the fixed handle
    // would otherwise collapse the rectangle and be caught by MIN_SIZE_M.
    for (const rotationDeg of [0, 37, 214]) {
      for (const handle of RESIZE_HANDLE_IDS) {
        const object = rect({ rotationDeg });
        const pointer = getRectangleHandleWorld(object, handle);
        const target = { xM: pointer.xM + 3, yM: pointer.yM + 3 };
        const resized = resizeRectangleFromHandle(object, handle, target);
        const landed = getRectangleHandleWorld({ ...object, ...resized }, handle);
        // An edge handle only follows the pointer along the axis it drives.
        const unit = { n: "y", s: "y", e: "x", w: "x" }[handle as "n" | "s" | "e" | "w"];
        const local = worldToObjectLocal(object, target);
        const landedLocal = worldToObjectLocal(object, landed);
        if (unit === "x") expect(landedLocal.xM).toBeCloseTo(local.xM, 9);
        else if (unit === "y") expect(landedLocal.yM).toBeCloseTo(local.yM, 9);
        else {
          expect(landed.xM).toBeCloseTo(target.xM, 9);
          expect(landed.yM).toBeCloseTo(target.yM, 9);
        }
      }
    }
  });

  it("never shrinks below the minimum size, whichever way the pointer is dragged past the fixed handle", () => {
    for (const handle of RESIZE_HANDLE_IDS) {
      const resized = resizeRectangleFromHandle(rect(), handle, { xM: -500, yM: -500 });
      expect(resized.widthM).toBeGreaterThanOrEqual(MIN_SIZE_M);
      expect(resized.heightM).toBeGreaterThanOrEqual(MIN_SIZE_M);
    }
  });

  it("preserves the aspect ratio exactly when asked, on every handle", () => {
    const object = rect(); // 8 x 4, ratio 2
    for (const handle of RESIZE_HANDLE_IDS) {
      const resized = resizeRectangleFromHandle(object, handle, { xM: 31, yM: 41 }, { keepAspectRatio: true });
      expect(resized.widthM / resized.heightM).toBeCloseTo(2, 9);
    }
  });

  it("preserves the aspect ratio even when the drag is clamped to the minimum size", () => {
    const resized = resizeRectangleFromHandle(rect(), "se", { xM: -100, yM: -100 }, { keepAspectRatio: true });
    expect(resized.widthM / resized.heightM).toBeCloseTo(2, 9);
    expect(Math.min(resized.widthM, resized.heightM)).toBeCloseTo(MIN_SIZE_M, 9);
  });

  it("does not drift when the same pointer position is applied repeatedly", () => {
    const object = rect({ rotationDeg: 41 });
    const pointer = { xM: 3, yM: 30 };
    const once = resizeRectangleFromHandle(object, "nw", pointer);
    let repeated = once;
    for (let i = 0; i < 20; i += 1) {
      repeated = resizeRectangleFromHandle({ ...object, ...repeated }, "nw", pointer);
    }
    expect(repeated.xM).toBeCloseTo(once.xM, 9);
    expect(repeated.yM).toBeCloseTo(once.yM, 9);
    expect(repeated.widthM).toBeCloseTo(once.widthM, 9);
    expect(repeated.heightM).toBeCloseTo(once.heightM, 9);
  });
});

describe("getCircleHandleWorld", () => {
  it("puts the four handles on the circumference at the cardinal points", () => {
    const circle = { xM: 5, yM: 5, radiusM: 3 };
    expect(CIRCLE_HANDLE_IDS.map((id) => getCircleHandleWorld(circle, id))).toEqual([
      { xM: 5, yM: 2 },
      { xM: 8, yM: 5 },
      { xM: 5, yM: 8 },
      { xM: 2, yM: 5 },
    ]);
  });
});

describe("vertex editing", () => {
  const polygon: VertexGeometry = {
    xM: 100,
    yM: 200,
    rotationDeg: 0,
    pointsM: [
      { xM: 0, yM: 0 },
      { xM: 10, yM: 0 },
      { xM: 10, yM: 6 },
    ],
  };

  it("reports a vertex's world position through the object's rotation", () => {
    expect(getVertexWorld(polygon, 2)).toEqual({ xM: 110, yM: 206 });
    const rotated = getVertexWorld({ ...polygon, rotationDeg: 90 }, 1);
    expect(rotated?.xM).toBeCloseTo(100, 9);
    expect(rotated?.yM).toBeCloseTo(210, 9);
  });

  it("returns null for a vertex that doesn't exist", () => {
    expect(getVertexWorld(polygon, 7)).toBeNull();
    expect(moveVertexTo(polygon, 7, { xM: 0, yM: 0 })).toBeNull();
  });

  it("moves a vertex onto the pointer, at any rotation, leaving the others alone", () => {
    const object = { ...polygon, rotationDeg: 53 };
    const target: PointM = { xM: 87.5, yM: 211.25 };
    const moved = moveVertexTo(object, 1, target);
    expect(moved).not.toBeNull();
    const landed = getVertexWorld({ ...object, ...moved! }, 1);
    expect(landed?.xM).toBeCloseTo(target.xM, 9);
    expect(landed?.yM).toBeCloseTo(target.yM, 9);
    expect(moved!.pointsM[0]).toEqual(object.pointsM[0]);
    expect(moved!.pointsM[2]).toEqual(object.pointsM[2]);
  });

  it("leaves the anchor where it is even when vertex 0 is dragged", () => {
    const moved = moveVertexTo(polygon, 0, { xM: 90, yM: 190 });
    expect(moved!.pointsM[0]).toEqual({ xM: -10, yM: -10 });
    // The object's own xM/yM aren't part of the result — the anchor is untouched by construction.
    expect(getVertexWorld({ ...polygon, ...moved! }, 0)).toEqual({ xM: 90, yM: 190 });
  });

  it("counts one more segment for a closed polygon than for an open line", () => {
    expect(getSegmentCount(polygon, true)).toBe(3);
    expect(getSegmentCount(polygon, false)).toBe(2);
    expect(getSegmentCount({ ...polygon, pointsM: [{ xM: 0, yM: 0 }] }, true)).toBe(0);
  });

  it("locates segment midpoints, including the closing segment of a polygon", () => {
    expect(getSegmentMidpointWorld(polygon, 0, true)).toEqual({ xM: 105, yM: 200 });
    expect(getSegmentMidpointWorld(polygon, 2, true)).toEqual({ xM: 105, yM: 203 });
    expect(getSegmentMidpointWorld(polygon, 2, false)).toBeNull();
  });

  it("inserts a vertex into the segment it was asked to split", () => {
    const inserted = insertVertexAfter(polygon, 0, { xM: 105, yM: 200 });
    expect(inserted.pointsM).toHaveLength(4);
    expect(inserted.pointsM[1]).toEqual({ xM: 5, yM: 0 });
    expect(inserted.pointsM[2]).toEqual(polygon.pointsM[1]);
  });

  it("refuses to remove a vertex that would leave a degenerate shape", () => {
    expect(removeVertexAt(polygon, 1, 3)).toBeNull();
    const withFour = insertVertexAfter(polygon, 0, { xM: 105, yM: 200 });
    const removed = removeVertexAt({ ...polygon, ...withFour }, 1, 3);
    expect(removed?.pointsM).toEqual(polygon.pointsM);
  });
});
