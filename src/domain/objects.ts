import { createId } from "./ids";
import type {
  CircleObject,
  LineObject,
  ObjectStyle,
  PointM,
  PolygonObject,
  RectangleObject,
  TextObject,
} from "./types";

/** Fields every `create*Object` factory accepts in addition to its own geometry. */
interface CommonObjectInput {
  layerId: string;
  name: string;
  label?: string;
  xM: number;
  yM: number;
  rotationDeg?: number;
  style?: ObjectStyle;
}

export function createRectangleObject(
  input: CommonObjectInput & { widthM: number; heightM: number },
): RectangleObject {
  return {
    id: createId("obj"),
    type: "rectangle",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    widthM: input.widthM,
    heightM: input.heightM,
  };
}

export function createCircleObject(
  input: CommonObjectInput & { radiusM: number },
): CircleObject {
  return {
    id: createId("obj"),
    type: "circle",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    radiusM: input.radiusM,
  };
}

export function createLineObject(
  input: CommonObjectInput & { pointsM: PointM[] },
): LineObject {
  return {
    id: createId("obj"),
    type: "line",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    pointsM: input.pointsM,
  };
}

export function createPolygonObject(
  input: CommonObjectInput & { pointsM: PointM[] },
): PolygonObject {
  return {
    id: createId("obj"),
    type: "polygon",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    pointsM: input.pointsM,
  };
}

export function createTextObject(
  input: CommonObjectInput & { text: string; fontSizeM?: number },
): TextObject {
  return {
    id: createId("obj"),
    type: "text",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    text: input.text,
    fontSizeM: input.fontSizeM ?? 0.3,
  };
}
