import { getObjectBoundsM, unionBounds } from "../domain/bounds";
import { objectLocalToWorld } from "../domain/geometry";
import {
  createCircleObject,
  createLineObject,
  createPolygonObject,
  createTextObject,
} from "../domain/objects";
import type { PlanObject, Project } from "../domain/types";

function escapeXml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
function color(value: string | undefined, fallback: string) {
  return value && /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}

export function objectsToSvg(objects: readonly PlanObject[]): string {
  let bounds = null;
  for (const object of objects) bounds = unionBounds(bounds, getObjectBoundsM(object));
  const box = bounds ?? { minXM: 0, minYM: 0, maxXM: 100, maxYM: 100 };
  const width = Math.max(0.1, box.maxXM - box.minXM);
  const height = Math.max(0.1, box.maxYM - box.minYM);
  const body = objects
    .map((object) => {
      const stroke = color(object.style?.stroke, "#0f172a");
      const fill = color(object.style?.fill, "none");
      const opacity = object.style?.opacity ?? 1;
      const dash =
        object.style?.dash === "dashed"
          ? ' stroke-dasharray="0.5 0.3"'
          : object.style?.dash === "dotted"
            ? ' stroke-dasharray="0.1 0.25"'
            : "";
      const transform = object.rotationDeg
        ? ` transform="rotate(${object.rotationDeg} ${object.xM} ${object.yM})"`
        : "";
      if (object.type === "rectangle")
        return `<rect x="${object.xM}" y="${object.yM}" width="${object.widthM}" height="${object.heightM}" fill="${fill}" stroke="${stroke}" opacity="${opacity}"${dash}${transform}/>`;
      if (object.type === "circle")
        return `<circle cx="${object.xM}" cy="${object.yM}" r="${object.radiusM}" fill="${fill}" stroke="${stroke}" opacity="${opacity}"/>`;
      if (object.type === "text")
        return `<text x="${object.xM}" y="${object.yM}" font-size="${object.fontSizeM}" font-family="${escapeXml(object.style?.fontFamily ?? "Arial")}" fill="${color(object.style?.fill, "#0f172a")}"${transform}>${escapeXml(object.text)}</text>`;
      if (object.type === "image")
        return `<image href="${escapeXml(object.url)}" x="${object.xM}" y="${object.yM}" width="${object.widthM}" height="${object.heightM}" opacity="${opacity}"${transform}/>`;
      const points = object.pointsM
        .map((point) => `${object.xM + point.xM},${object.yM + point.yM}`)
        .join(" ");
      return `<${object.type === "polygon" ? "polygon" : "polyline"} points="${points}" fill="${object.type === "polygon" ? fill : "none"}" stroke="${stroke}" opacity="${opacity}"${dash}${transform}/>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${box.minXM} ${box.minYM} ${width} ${height}" width="${width}m" height="${height}m">\n${body}\n</svg>`;
}

function dxfLine(a: { xM: number; yM: number }, b: { xM: number; yM: number }, layer: string) {
  return `0\nLINE\n8\n${layer}\n10\n${a.xM}\n20\n${-a.yM}\n30\n0\n11\n${b.xM}\n21\n${-b.yM}\n31\n0\n`;
}

export function objectsToDxf(objects: readonly PlanObject[]): string {
  let entities = "";
  for (const object of objects) {
    const layer = object.layerId.replace(/[^a-z0-9_-]/gi, "_");
    if (object.type === "circle")
      entities += `0\nCIRCLE\n8\n${layer}\n10\n${object.xM}\n20\n${-object.yM}\n30\n0\n40\n${object.radiusM}\n`;
    else if (object.type === "text")
      entities += `0\nTEXT\n8\n${layer}\n10\n${object.xM}\n20\n${-object.yM}\n30\n0\n40\n${object.fontSizeM}\n1\n${object.text.replace(/[\r\n]/g, " ")}\n50\n${-object.rotationDeg}\n`;
    else {
      const local =
        object.type === "rectangle" || object.type === "image"
          ? [
              { xM: 0, yM: 0 },
              { xM: object.widthM, yM: 0 },
              { xM: object.widthM, yM: object.heightM },
              { xM: 0, yM: object.heightM },
            ]
          : object.pointsM;
      const points = local.map((point) => objectLocalToWorld(object, point));
      const closed =
        object.type === "rectangle" || object.type === "image" || object.type === "polygon";
      for (let index = 1; index < points.length; index += 1) {
        const a = points[index - 1];
        const b = points[index];
        if (a && b) entities += dxfLine(a, b, layer);
      }
      const first = points[0];
      const last = points[points.length - 1];
      if (closed && first && last) entities += dxfLine(last, first, layer);
    }
  }
  return `0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n6\n0\nENDSEC\n0\nSECTION\n2\nENTITIES\n${entities}0\nENDSEC\n0\nEOF\n`;
}

const EARTH_RADIUS_M = 6_378_137;
type Georeference = NonNullable<Project["georeference"]>;

export function localToLongitudeLatitude(
  point: { xM: number; yM: number },
  geo: Georeference,
): [number, number] {
  const angle = (geo.rotationDeg * Math.PI) / 180;
  const eastM = point.xM * Math.cos(angle) - point.yM * Math.sin(angle);
  const northM = -point.xM * Math.sin(angle) - point.yM * Math.cos(angle);
  return [
    geo.originLongitude +
      ((eastM / (EARTH_RADIUS_M * Math.cos((geo.originLatitude * Math.PI) / 180))) * 180) / Math.PI,
    geo.originLatitude + ((northM / EARTH_RADIUS_M) * 180) / Math.PI,
  ];
}

export function longitudeLatitudeToLocal(
  coordinates: readonly number[],
  geo: Georeference,
): { xM: number; yM: number } {
  const eastM =
    (((coordinates[0]! - geo.originLongitude) * Math.PI) / 180) *
    EARTH_RADIUS_M *
    Math.cos((geo.originLatitude * Math.PI) / 180);
  const northM = (((coordinates[1]! - geo.originLatitude) * Math.PI) / 180) * EARTH_RADIUS_M;
  const angle = (geo.rotationDeg * Math.PI) / 180;
  return {
    xM: eastM * Math.cos(angle) - northM * Math.sin(angle),
    yM: -eastM * Math.sin(angle) - northM * Math.cos(angle),
  };
}

export function objectsToGeoJson(
  objects: readonly PlanObject[],
  georeference?: Georeference,
): string {
  const coordinate = (point: { xM: number; yM: number }) =>
    georeference ? localToLongitudeLatitude(point, georeference) : [point.xM, point.yM];
  const features = objects.map((object) => {
    let geometry: Record<string, unknown>;
    if (object.type === "circle" || object.type === "text")
      geometry = { type: "Point", coordinates: coordinate(object) };
    else {
      const local =
        object.type === "rectangle" || object.type === "image"
          ? [
              { xM: 0, yM: 0 },
              { xM: object.widthM, yM: 0 },
              { xM: object.widthM, yM: object.heightM },
              { xM: 0, yM: object.heightM },
              { xM: 0, yM: 0 },
            ]
          : object.pointsM;
      const coordinates = local.map((point) => coordinate(objectLocalToWorld(object, point)));
      if (object.type === "polygon" && coordinates.length > 0) coordinates.push(coordinates[0]!);
      geometry =
        object.type === "polygon" || object.type === "rectangle" || object.type === "image"
          ? { type: "Polygon", coordinates: [coordinates] }
          : { type: "LineString", coordinates };
    }
    return {
      type: "Feature",
      id: object.id,
      properties: {
        name: object.name,
        layerId: object.layerId,
        category: object.category,
        reference: object.reference,
        units: "m",
        radiusM: object.type === "circle" ? object.radiusM : undefined,
        text: object.type === "text" ? object.text : undefined,
      },
      geometry,
    };
  });
  return JSON.stringify(
    {
      type: "FeatureCollection",
      klCoordinateSystem: georeference ? "WGS84" : "local-metric",
      ...(georeference
        ? { crs: { type: "name", properties: { name: "urn:ogc:def:crs:OGC:1.3:CRS84" } } }
        : {}),
      features,
    },
    null,
    2,
  );
}

export function geoJsonToObjects(
  text: string,
  layerId: string,
  georeference?: Georeference,
): PlanObject[] {
  const root = JSON.parse(text) as {
    type?: string;
    features?: unknown[];
    klCoordinateSystem?: string;
  };
  if (root.type !== "FeatureCollection" || !Array.isArray(root.features))
    throw new Error("GeoJSON FeatureCollection attendu.");
  const geographic = root.klCoordinateSystem !== "local-metric";
  if (geographic && !georeference)
    throw new Error("Définissez d’abord l’origine géographique du projet.");
  const local = (value: unknown) => {
    if (
      !Array.isArray(value) ||
      value.length < 2 ||
      !value.every((item, index) => index > 1 || typeof item === "number")
    )
      throw new Error("Coordonnées GeoJSON invalides.");
    return geographic
      ? longitudeLatitudeToLocal(value as number[], georeference!)
      : { xM: value[0] as number, yM: value[1] as number };
  };
  return root.features.flatMap((raw, index): PlanObject[] => {
    const feature = raw as {
      geometry?: { type?: string; coordinates?: unknown };
      properties?: Record<string, unknown>;
    };
    const name =
      typeof feature.properties?.name === "string"
        ? feature.properties.name
        : `GeoJSON ${index + 1}`;
    const common = { layerId, name };
    if (feature.geometry?.type === "Point") {
      const point = local(feature.geometry.coordinates);
      if (typeof feature.properties?.radiusM === "number")
        return [createCircleObject({ ...common, ...point, radiusM: feature.properties.radiusM })];
      return [
        createTextObject({
          ...common,
          ...point,
          text: typeof feature.properties?.text === "string" ? feature.properties.text : name,
        }),
      ];
    }
    const rawCoordinates =
      feature.geometry?.type === "Polygon"
        ? (feature.geometry.coordinates as unknown[])?.[0]
        : feature.geometry?.coordinates;
    if (
      (feature.geometry?.type !== "LineString" && feature.geometry?.type !== "Polygon") ||
      !Array.isArray(rawCoordinates)
    )
      return [];
    const world = rawCoordinates.map(local);
    if (world.length < 2) return [];
    if (
      feature.geometry.type === "Polygon" &&
      world.length > 2 &&
      world[0]?.xM === world.at(-1)?.xM &&
      world[0]?.yM === world.at(-1)?.yM
    )
      world.pop();
    const anchor = world[0]!;
    const pointsM = world.map((point) => ({ xM: point.xM - anchor.xM, yM: point.yM - anchor.yM }));
    return [
      feature.geometry.type === "Polygon"
        ? createPolygonObject({ ...common, ...anchor, pointsM })
        : createLineObject({ ...common, ...anchor, pointsM }),
    ];
  });
}
