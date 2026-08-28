import { describe, expect, it } from "vitest";
import { createCircleObject, createRectangleObject } from "../domain/objects";
import {
  geoJsonToObjects,
  localToLongitudeLatitude,
  longitudeLatitudeToLocal,
  objectsToDxf,
  objectsToGeoJson,
  objectsToSvg,
} from "./exportFormats";

const objects = [
  createRectangleObject({ layerId: "l", name: "Zone", xM: 1, yM: 2, widthM: 10, heightM: 5 }),
  createCircleObject({ layerId: "l", name: "Point", xM: 4, yM: 5, radiusM: 1 }),
];
describe("formats d'échange", () => {
  it("exporte un SVG vectoriel métrique", () => {
    const svg = objectsToSvg(objects);
    expect(svg).toContain("<rect");
    expect(svg).toContain("<circle");
  });
  it("exporte un DXF en mètres", () => {
    const dxf = objectsToDxf(objects);
    expect(dxf).toContain("$INSUNITS\n70\n6");
    expect(dxf).toContain("CIRCLE");
  });
  it("exporte un GeoJSON local explicitement identifié", () => {
    const geo = JSON.parse(objectsToGeoJson(objects));
    expect(geo.klCoordinateSystem).toBe("local-metric");
    expect(geo.features).toHaveLength(2);
  });
  it("convertit et réimporte un GeoJSON WGS84", () => {
    const georeference = {
      crs: "EPSG:4326" as const,
      originLongitude: 2.35,
      originLatitude: 48.85,
      rotationDeg: 12,
    };
    const coordinates = localToLongitudeLatitude({ xM: 120, yM: -30 }, georeference);
    expect(longitudeLatitudeToLocal(coordinates, georeference)).toEqual(
      expect.objectContaining({ xM: expect.closeTo(120, 5), yM: expect.closeTo(-30, 5) }),
    );
    const json = objectsToGeoJson(objects, georeference);
    expect(JSON.parse(json).klCoordinateSystem).toBe("WGS84");
    expect(geoJsonToObjects(json, "import", georeference)).toHaveLength(2);
  });
});
