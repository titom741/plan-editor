import { addVector, rotateVector, subtractPoints } from "./geometry";
import { createId } from "./ids";
import { boundsCenterM, getObjectBoundsM } from "./bounds";
import type { PlanObject, PointM } from "./types";

/** Applies a uniform scale and rotation around a shared world pivot. */
export function transformObjectAroundPivot(
  object: PlanObject,
  pivot: PointM,
  scale: number,
  rotationDeg: number,
): PlanObject {
  const safeScale = Math.max(0.01, scale);
  const relative = subtractPoints({ xM: object.xM, yM: object.yM }, pivot);
  const nextAnchor = addVector(
    pivot,
    rotateVector({ xM: relative.xM * safeScale, yM: relative.yM * safeScale }, rotationDeg),
  );
  const placement = {
    xM: nextAnchor.xM,
    yM: nextAnchor.yM,
    rotationDeg: object.rotationDeg + rotationDeg,
  };
  switch (object.type) {
    case "rectangle":
      return {
        ...object,
        ...placement,
        widthM: object.widthM * safeScale,
        heightM: object.heightM * safeScale,
      };
    case "circle":
      return { ...object, ...placement, radiusM: object.radiusM * safeScale };
    case "line":
      return {
        ...object,
        ...placement,
        pointsM: object.pointsM.map((point) => ({
          xM: point.xM * safeScale,
          yM: point.yM * safeScale,
        })),
      };
    case "polygon":
      return {
        ...object,
        ...placement,
        pointsM: object.pointsM.map((point) => ({
          xM: point.xM * safeScale,
          yM: point.yM * safeScale,
        })),
      };
    case "text":
      return { ...object, ...placement, fontSizeM: object.fontSizeM * safeScale };
    case "image":
      return {
        ...object,
        ...placement,
        widthM: object.widthM * safeScale,
        heightM: object.heightM * safeScale,
      };
  }
}

export function createNamedGroup(objects: readonly PlanObject[], name: string): PlanObject[] {
  const groupId = createId("group");
  const groupName = name.trim() || "Groupe";
  return objects.map((object) => ({ ...object, groupId, groupName }));
}

export function clearGroup(objects: readonly PlanObject[]): PlanObject[] {
  return objects.map(
    ({ groupId: _groupId, groupName: _groupName, ...object }) => object as PlanObject,
  );
}

/** Evenly distributes object centres between the two extreme objects. */
export function distributeObjects(objects: readonly PlanObject[], axis: "x" | "y"): PlanObject[] {
  if (objects.length < 3) return [...objects];
  const centerOf = (object: PlanObject) => {
    const bounds = getObjectBoundsM(object);
    return bounds ? boundsCenterM(bounds) : { xM: object.xM, yM: object.yM };
  };
  const sorted = [...objects].sort((a, b) => {
    const ac = centerOf(a);
    const bc = centerOf(b);
    return axis === "x" ? ac.xM - bc.xM : ac.yM - bc.yM;
  });
  const first = centerOf(sorted[0]!);
  const last = centerOf(sorted.at(-1)!);
  const start = axis === "x" ? first.xM : first.yM;
  const end = axis === "x" ? last.xM : last.yM;
  return sorted.map((object, index) => {
    const center = centerOf(object);
    const target = start + ((end - start) * index) / (sorted.length - 1);
    return {
      ...object,
      ...(axis === "x"
        ? { xM: object.xM + target - center.xM }
        : { yM: object.yM + target - center.yM }),
    };
  });
}
