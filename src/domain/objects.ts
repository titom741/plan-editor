import { createId } from "./ids";
import { DEFAULT_SYMBOL_CHARACTER, DEFAULT_SYMBOL_SIZE_M } from "./symbols";
import type {
  CircleObject,
  LineObject,
  ObjectStyle,
  PointM,
  PolygonObject,
  RectangleObject,
  TextObject,
  ImageObject,
  SymbolObject,
} from "./types";

/**
 * Default height of a text object, in metres. Two metres reads at the
 * scale an event plan is actually printed at (1:200 and coarser); the
 * 0.30 m this used to be came out as an unreadable smudge on anything
 * bigger than a room.
 */
export const DEFAULT_TEXT_SIZE_M = 2;

/** Fields every `create*Object` factory accepts in addition to its own geometry. */
interface CommonObjectInput {
  layerId: string;
  name: string;
  label?: string;
  catalogId?: string;
  category?: string;
  reference?: string;
  quantity?: number;
  unit?: string;
  measurement?: import("./types").MeasurementMetadata;
  electrical?: import("./types").ElectricalSpec;
  groupId?: string;
  groupName?: string;
  xM: number;
  yM: number;
  rotationDeg?: number;
  style?: ObjectStyle;
}

function materialFields(input: CommonObjectInput) {
  return {
    catalogId: input.catalogId,
    category: input.category,
    reference: input.reference,
    quantity: input.quantity,
    unit: input.unit,
    measurement: input.measurement,
    ...(input.electrical ? { electrical: input.electrical } : {}),
    groupId: input.groupId,
    groupName: input.groupName,
  };
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
    ...materialFields(input),
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    widthM: input.widthM,
    heightM: input.heightM,
  };
}

export function createCircleObject(input: CommonObjectInput & { radiusM: number }): CircleObject {
  return {
    id: createId("obj"),
    type: "circle",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    ...materialFields(input),
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    radiusM: input.radiusM,
  };
}

export function createLineObject(input: CommonObjectInput & { pointsM: PointM[] }): LineObject {
  return {
    id: createId("obj"),
    type: "line",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    ...materialFields(input),
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
    ...materialFields(input),
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
    ...materialFields(input),
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    text: input.text,
    fontSizeM: input.fontSizeM ?? DEFAULT_TEXT_SIZE_M,
  };
}

export function createSymbolObject(
  input: CommonObjectInput & { character?: string; sizeM?: number },
): SymbolObject {
  return {
    id: createId("obj"),
    type: "symbol",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    ...materialFields(input),
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    character: input.character ?? DEFAULT_SYMBOL_CHARACTER,
    sizeM: input.sizeM ?? DEFAULT_SYMBOL_SIZE_M,
  };
}

export function createImageObject(
  input: CommonObjectInput & {
    url: string;
    widthPx: number;
    heightPx: number;
    widthM: number;
    heightM: number;
  },
): ImageObject {
  return {
    id: createId("obj"),
    type: "image",
    layerId: input.layerId,
    name: input.name,
    label: input.label,
    ...materialFields(input),
    xM: input.xM,
    yM: input.yM,
    rotationDeg: input.rotationDeg ?? 0,
    style: input.style,
    url: input.url,
    widthPx: input.widthPx,
    heightPx: input.heightPx,
    widthM: input.widthM,
    heightM: input.heightM,
  };
}
