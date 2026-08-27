/**
 * Turning a `Project` into bytes and — the hard half — turning bytes back
 * into a *trustworthy* `Project`.
 *
 * Everything in this file is pure: no DOM, no storage API, no React. It
 * takes and returns plain values, so the validation below can be tested
 * exhaustively in Node. The browser-facing side (IndexedDB, file
 * download/upload) lives in `projectStorage.ts` and `ui/`, and always goes
 * through the functions here.
 *
 * The guiding rule for reading: **anything coming back from storage or a
 * file is untrusted**. It may have been written by an older version of the
 * app, hand-edited, truncated by a full disk, or simply be an unrelated
 * JSON file the user picked by mistake. `parseProjectFile` therefore
 * validates every field and never throws — it returns a result the UI can
 * turn into an explanation. It also never silently "repairs" a malformed
 * project: dropping the one object that failed to parse would quietly
 * destroy the user's work, so a bad file is refused whole and left intact
 * on disk for them to keep or send on.
 */

import { PAPER_SIZE_ORDER } from "../domain/sheets";
import type {
  Background,
  Calibration,
  CalibrationSource,
  Layer,
  PaperSize,
  PlanObject,
  PointM,
  Project,
  Sheet,
} from "../domain/types";

/**
 * Bumped only on a *breaking* change to the persisted shape. Adding an
 * optional field doesn't need a bump (older files simply lack it); a
 * renamed, removed, or re-typed field does, along with either a migration
 * or an explicit refusal in `parseProjectFile`.
 */
export const SCHEMA_VERSION = 1;

/** Identifies our own files, so an unrelated `.json` is rejected with a useful message rather than a field-level complaint. */
export const FILE_KIND = "kl-implantation/project";

export interface ProjectFile {
  kind: typeof FILE_KIND;
  schemaVersion: number;
  /** When this snapshot was written. Informational — shown in the UI, never used to resolve conflicts. */
  savedAt: string;
  project: Project;
}

/**
 * Why a file couldn't be read. A discriminated union of *codes* rather
 * than ready-made sentences: the domain and persistence layers don't own
 * the app's wording (which is French, and lives in `ui/`), and a code can
 * carry structured details a string would have to bake in.
 */
export type ParseError =
  | { code: "notJson" }
  | { code: "notAnObject" }
  | { code: "unknownFormat" }
  | { code: "unsupportedVersion"; found: number; supported: number }
  | { code: "invalidField"; path: string }
  | { code: "danglingLayerRef"; objectId: string; layerId: string };

export type ParseResult = { ok: true; file: ProjectFile } | { ok: false; error: ParseError };

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

export function toProjectFile(project: Project, savedAt: string = new Date().toISOString()): ProjectFile {
  return { kind: FILE_KIND, schemaVersion: SCHEMA_VERSION, savedAt, project };
}

/** Pretty-printed on purpose: a project file is small, and a diffable, human-readable file is worth far more than the bytes saved. */
export function serializeProject(project: Project, savedAt?: string): string {
  return JSON.stringify(toProjectFile(project, savedAt), null, 2);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** A validation failure, thrown internally and caught at the boundary — never escapes this module. */
class FieldError extends Error {
  readonly error: ParseError;

  constructor(error: ParseError) {
    super(error.code);
    this.error = error;
  }
}

function fail(path: string): never {
  throw new FieldError({ code: "invalidField", path });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path);
  return value;
}

function readString(value: unknown, path: string): string {
  if (typeof value !== "string") fail(path);
  return value;
}

/** Rejects `NaN` and `±Infinity` as well as non-numbers: they survive a JSON round-trip as `null`, and would poison every downstream computation. */
function readFiniteNumber(value: unknown, path: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) fail(path);
  return value;
}

function readPositiveNumber(value: unknown, path: string): number {
  const n = readFiniteNumber(value, path);
  if (n <= 0) fail(path);
  return n;
}

function readBoolean(value: unknown, path: string): boolean {
  if (typeof value !== "boolean") fail(path);
  return value;
}

function readArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path);
  return value;
}

function readPoint(value: unknown, path: string): PointM {
  const record = readRecord(value, path);
  return {
    xM: readFiniteNumber(record.xM, `${path}.xM`),
    yM: readFiniteNumber(record.yM, `${path}.yM`),
  };
}

function readPoints(value: unknown, path: string): PointM[] {
  return readArray(value, path).map((point, i) => readPoint(point, `${path}[${i}]`));
}

function readCalibrationSource(value: unknown, path: string): CalibrationSource {
  const record = readRecord(value, path);
  const type = readString(record.type, `${path}.type`);
  switch (type) {
    case "default":
      return { type: "default" };
    case "knownDistance":
      return {
        type: "knownDistance",
        pixelDistance: readFiniteNumber(record.pixelDistance, `${path}.pixelDistance`),
        realDistanceM: readFiniteNumber(record.realDistanceM, `${path}.realDistanceM`),
      };
    case "knownScale":
      return { type: "knownScale", scale: readFiniteNumber(record.scale, `${path}.scale`) };
    case "geo":
      return { type: "geo", description: readString(record.description, `${path}.description`) };
    default:
      fail(`${path}.type`);
  }
}

function readCalibration(value: unknown, path: string): Calibration {
  const record = readRecord(value, path);
  return {
    // Zero or negative would make every meters↔pixels conversion produce
    // Infinity or mirror the plan, so it's rejected rather than clamped.
    pixelsPerMeter: readPositiveNumber(record.pixelsPerMeter, `${path}.pixelsPerMeter`),
    source: readCalibrationSource(record.source, `${path}.source`),
  };
}

function readBackground(value: unknown, path: string): Background {
  if (value === null || value === undefined) return null;
  const record = readRecord(value, path);
  if (record.kind !== "image") fail(`${path}.kind`);
  const opacity = readFiniteNumber(record.opacity, `${path}.opacity`);
  if (opacity < 0 || opacity > 1) fail(`${path}.opacity`);
  return {
    id: readString(record.id, `${path}.id`),
    kind: "image",
    url: readString(record.url, `${path}.url`),
    widthPx: readPositiveNumber(record.widthPx, `${path}.widthPx`),
    heightPx: readPositiveNumber(record.heightPx, `${path}.heightPx`),
    xM: readFiniteNumber(record.xM, `${path}.xM`),
    yM: readFiniteNumber(record.yM, `${path}.yM`),
    widthM: readPositiveNumber(record.widthM, `${path}.widthM`),
    heightM: readPositiveNumber(record.heightM, `${path}.heightM`),
    opacity,
    visible: readBoolean(record.visible, `${path}.visible`),
    locked: readBoolean(record.locked, `${path}.locked`),
  };
}

function readLayer(value: unknown, path: string): Layer {
  const record = readRecord(value, path);
  return {
    id: readString(record.id, `${path}.id`),
    name: readString(record.name, `${path}.name`),
    visible: readBoolean(record.visible, `${path}.visible`),
    locked: readBoolean(record.locked, `${path}.locked`),
    order: readFiniteNumber(record.order, `${path}.order`),
  };
}

function readStyle(value: unknown, path: string): PlanObject["style"] {
  if (value === undefined || value === null) return undefined;
  const record = readRecord(value, path);
  const style: NonNullable<PlanObject["style"]> = {};
  if (record.fill !== undefined) style.fill = readString(record.fill, `${path}.fill`);
  if (record.stroke !== undefined) style.stroke = readString(record.stroke, `${path}.stroke`);
  if (record.strokeWidth !== undefined) {
    style.strokeWidth = readFiniteNumber(record.strokeWidth, `${path}.strokeWidth`);
  }
  if (record.opacity !== undefined) style.opacity = readFiniteNumber(record.opacity, `${path}.opacity`);
  return style;
}

function readObject(value: unknown, path: string): PlanObject {
  const record = readRecord(value, path);
  const base = {
    id: readString(record.id, `${path}.id`),
    layerId: readString(record.layerId, `${path}.layerId`),
    name: readString(record.name, `${path}.name`),
    xM: readFiniteNumber(record.xM, `${path}.xM`),
    yM: readFiniteNumber(record.yM, `${path}.yM`),
    rotationDeg: readFiniteNumber(record.rotationDeg, `${path}.rotationDeg`),
    ...(record.label !== undefined ? { label: readString(record.label, `${path}.label`) } : {}),
    ...(record.style !== undefined ? { style: readStyle(record.style, `${path}.style`) } : {}),
  };

  const type = readString(record.type, `${path}.type`);
  switch (type) {
    case "rectangle":
      return {
        ...base,
        type: "rectangle",
        widthM: readPositiveNumber(record.widthM, `${path}.widthM`),
        heightM: readPositiveNumber(record.heightM, `${path}.heightM`),
      };
    case "circle":
      return { ...base, type: "circle", radiusM: readPositiveNumber(record.radiusM, `${path}.radiusM`) };
    case "line":
      return { ...base, type: "line", pointsM: readPoints(record.pointsM, `${path}.pointsM`) };
    case "polygon":
      return { ...base, type: "polygon", pointsM: readPoints(record.pointsM, `${path}.pointsM`) };
    case "text":
      return {
        ...base,
        type: "text",
        text: readString(record.text, `${path}.text`),
        fontSizeM: readPositiveNumber(record.fontSizeM, `${path}.fontSizeM`),
      };
    default:
      fail(`${path}.type`);
  }
}

/**
 * Sheets gained their print settings in KL-009, having been a bare
 * `{ id, name }` placeholder since KL-001. Rather than bump
 * `SCHEMA_VERSION` for it, the missing fields are filled with the same
 * defaults `createSheet` uses: no file in the wild can contain a sheet
 * (nothing ever created one before KL-009), so a version bump would buy a
 * migration that could never run, while reading tolerantly here costs four
 * lines and is what a future optional field would want anyway. A *present*
 * field is still validated strictly.
 */
function readSheet(value: unknown, path: string): Sheet {
  const record = readRecord(value, path);
  const defaults = { paperSize: "A3", orientation: "landscape", scaleDenominator: 200, marginMm: 10 } as const;

  const paperSize = record.paperSize === undefined ? defaults.paperSize : readString(record.paperSize, `${path}.paperSize`);
  if (!PAPER_SIZE_ORDER.includes(paperSize as PaperSize)) fail(`${path}.paperSize`);

  const orientation =
    record.orientation === undefined ? defaults.orientation : readString(record.orientation, `${path}.orientation`);
  if (orientation !== "portrait" && orientation !== "landscape") fail(`${path}.orientation`);

  return {
    id: readString(record.id, `${path}.id`),
    name: readString(record.name, `${path}.name`),
    paperSize: paperSize as PaperSize,
    orientation,
    scaleDenominator:
      record.scaleDenominator === undefined
        ? defaults.scaleDenominator
        : readPositiveNumber(record.scaleDenominator, `${path}.scaleDenominator`),
    marginMm:
      record.marginMm === undefined ? defaults.marginMm : readFiniteNumber(record.marginMm, `${path}.marginMm`),
  };
}

function readProject(value: unknown, path: string): Project {
  const record = readRecord(value, path);
  if (record.units !== "m") fail(`${path}.units`);

  const layers = readArray(record.layers, `${path}.layers`).map((layer, i) =>
    readLayer(layer, `${path}.layers[${i}]`),
  );
  const objects = readArray(record.objects, `${path}.objects`).map((object, i) =>
    readObject(object, `${path}.objects[${i}]`),
  );

  // Referential integrity, not just field shapes: an object pointing at a
  // layer that isn't in the file would be loaded, counted, and then never
  // drawn (the canvas renders objects by visible *layer*), leaving the
  // user with a project that silently lost part of its content.
  const layerIds = new Set(layers.map((layer) => layer.id));
  for (const object of objects) {
    if (!layerIds.has(object.layerId)) {
      throw new FieldError({ code: "danglingLayerRef", objectId: object.id, layerId: object.layerId });
    }
  }

  return {
    id: readString(record.id, `${path}.id`),
    name: readString(record.name, `${path}.name`),
    description: readString(record.description, `${path}.description`),
    location: readString(record.location, `${path}.location`),
    createdAt: readString(record.createdAt, `${path}.createdAt`),
    updatedAt: readString(record.updatedAt, `${path}.updatedAt`),
    units: "m",
    calibration: readCalibration(record.calibration, `${path}.calibration`),
    background: readBackground(record.background, `${path}.background`),
    layers,
    objects,
    sheets: readArray(record.sheets, `${path}.sheets`).map((sheet, i) =>
      readSheet(sheet, `${path}.sheets[${i}]`),
    ),
  };
}

/**
 * Validates an already-parsed JSON value into a `ProjectFile`. Never
 * throws — see the module comment.
 */
export function parseProjectFile(value: unknown): ParseResult {
  if (!isRecord(value)) return { ok: false, error: { code: "notAnObject" } };
  if (value.kind !== FILE_KIND) return { ok: false, error: { code: "unknownFormat" } };

  const schemaVersion = value.schemaVersion;
  if (typeof schemaVersion !== "number" || !Number.isInteger(schemaVersion)) {
    return { ok: false, error: { code: "invalidField", path: "schemaVersion" } };
  }
  // Only a *newer* file is refused outright — it may contain fields this
  // build would drop on the next save. Older versions would be migrated
  // here; there are none yet, SCHEMA_VERSION having always been 1.
  if (schemaVersion > SCHEMA_VERSION) {
    return {
      ok: false,
      error: { code: "unsupportedVersion", found: schemaVersion, supported: SCHEMA_VERSION },
    };
  }

  try {
    return {
      ok: true,
      file: {
        kind: FILE_KIND,
        schemaVersion,
        savedAt: typeof value.savedAt === "string" ? value.savedAt : "",
        project: readProject(value.project, "project"),
      },
    };
  } catch (error) {
    if (error instanceof FieldError) return { ok: false, error: error.error };
    throw error;
  }
}

/** `parseProjectFile` from raw text, folding a JSON syntax error into the same result type. */
export function deserializeProject(text: string): ParseResult {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: { code: "notJson" } };
  }
  return parseProjectFile(value);
}
