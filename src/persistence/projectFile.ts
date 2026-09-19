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

import { DEFAULT_LABEL_DISPLAY, clampLabelFontSizePx } from "../domain/display";
import { PAPER_SIZE_ORDER } from "../domain/sheets";
import { isPaletteSymbol } from "../domain/symbols";
import type {
  Background,
  BackgroundImage,
  Calibration,
  CalibrationSource,
  LabelDisplay,
  Layer,
  PaperSize,
  PlanObject,
  PointM,
  Project,
  Sheet,
  StandGrid,
} from "../domain/types";

/**
 * Bumped only on a *breaking* change to the persisted shape. Adding an
 * optional field doesn't need a bump (older files simply lack it); a
 * renamed, removed, or re-typed field does, along with either a migration
 * or an explicit refusal in `parseProjectFile`.
 *
 * - **1** — up to KL-028.
 * - **2** — KL-029 replaced the single `background` with a `backgrounds`
 *   stack. Version-1 files are migrated on read (see `readBackgrounds`);
 *   an older build meeting a version-2 file refuses it, which is correct:
 *   it would otherwise keep one backdrop and drop the rest on the next
 *   save.
 */
export const SCHEMA_VERSION = 2;

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

export function toProjectFile(
  project: Project,
  savedAt: string = new Date().toISOString(),
): ProjectFile {
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
  const brightness =
    record.brightness === undefined ? 0 : readFiniteNumber(record.brightness, `${path}.brightness`);
  if (brightness < -1 || brightness > 1) fail(`${path}.brightness`);
  const contrast =
    record.contrast === undefined ? 0 : readFiniteNumber(record.contrast, `${path}.contrast`);
  if (contrast < -100 || contrast > 100) fail(`${path}.contrast`);
  const whiteThreshold =
    record.whiteThreshold === undefined
      ? 245
      : readFiniteNumber(record.whiteThreshold, `${path}.whiteThreshold`);
  if (whiteThreshold < 0 || whiteThreshold > 255) fail(`${path}.whiteThreshold`);
  let crop: BackgroundImage["crop"];
  if (record.crop !== undefined) {
    const cropRecord = readRecord(record.crop, `${path}.crop`);
    crop = {
      xPx: readFiniteNumber(cropRecord.xPx, `${path}.crop.xPx`),
      yPx: readFiniteNumber(cropRecord.yPx, `${path}.crop.yPx`),
      widthPx: readPositiveNumber(cropRecord.widthPx, `${path}.crop.widthPx`),
      heightPx: readPositiveNumber(cropRecord.heightPx, `${path}.crop.heightPx`),
    };
  }
  return {
    id: readString(record.id, `${path}.id`),
    kind: "image",
    // Pre-KL-029 files have no name; the generic one is better than a
    // blank row in the layers bar.
    name: record.name === undefined ? "Fond de plan" : readString(record.name, `${path}.name`),
    url: readString(record.url, `${path}.url`),
    widthPx: readPositiveNumber(record.widthPx, `${path}.widthPx`),
    heightPx: readPositiveNumber(record.heightPx, `${path}.heightPx`),
    xM: readFiniteNumber(record.xM, `${path}.xM`),
    yM: readFiniteNumber(record.yM, `${path}.yM`),
    widthM: readPositiveNumber(record.widthM, `${path}.widthM`),
    heightM: readPositiveNumber(record.heightM, `${path}.heightM`),
    rotationDeg:
      record.rotationDeg === undefined
        ? 0
        : readFiniteNumber(record.rotationDeg, `${path}.rotationDeg`),
    opacity,
    brightness,
    contrast,
    grayscale:
      record.grayscale === undefined ? false : readBoolean(record.grayscale, `${path}.grayscale`),
    whiteRemoval:
      record.whiteRemoval === undefined
        ? false
        : readBoolean(record.whiteRemoval, `${path}.whiteRemoval`),
    whiteThreshold,
    ...(crop ? { crop } : {}),
    visible: readBoolean(record.visible, `${path}.visible`),
    locked: readBoolean(record.locked, `${path}.locked`),
  };
}

/**
 * The background stack, reading both shapes.
 *
 * Up to KL-029 a project had one `background` (or none). It now has a
 * `backgrounds` array, and a file written by an older build is migrated
 * here rather than refused: the old single value becomes a one-element
 * stack. That migration is the reason `SCHEMA_VERSION` went to 2 — an
 * older build meeting a version-2 file refuses it, which is right, since
 * it would otherwise drop every background but one on the next save.
 */
function readBackgrounds(record: Record<string, unknown>, path: string): BackgroundImage[] {
  if (record.backgrounds !== undefined) {
    return readArray(record.backgrounds, `${path}.backgrounds`).map((raw, index) => {
      const background = readBackground(raw, `${path}.backgrounds[${index}]`);
      if (!background) fail(`${path}.backgrounds[${index}]`);
      return background;
    });
  }
  const legacy = readBackground(record.background, `${path}.background`);
  return legacy ? [legacy] : [];
}

function readLayer(value: unknown, path: string): Layer {
  const record = readRecord(value, path);
  return {
    id: readString(record.id, `${path}.id`),
    name: readString(record.name, `${path}.name`),
    visible: readBoolean(record.visible, `${path}.visible`),
    locked: readBoolean(record.locked, `${path}.locked`),
    order: readFiniteNumber(record.order, `${path}.order`),
    ...(record.folder !== undefined ? { folder: readString(record.folder, `${path}.folder`) } : {}),
    ...(record.defaultStyle !== undefined
      ? { defaultStyle: readStyle(record.defaultStyle, `${path}.defaultStyle`) }
      : {}),
  };
}

function readStyle(value: unknown, path: string): PlanObject["style"] {
  if (value === undefined || value === null) return undefined;
  const record = readRecord(value, path);
  const style: NonNullable<PlanObject["style"]> = {};
  if (record.fill !== undefined) style.fill = readString(record.fill, `${path}.fill`);
  if (record.stroke !== undefined) style.stroke = readString(record.stroke, `${path}.stroke`);
  if (record.strokeWidth !== undefined) {
    style.strokeWidth = readPositiveNumber(record.strokeWidth, `${path}.strokeWidth`);
  }
  if (record.opacity !== undefined) {
    const opacity = readFiniteNumber(record.opacity, `${path}.opacity`);
    if (opacity < 0 || opacity > 1) fail(`${path}.opacity`);
    style.opacity = opacity;
  }
  if (record.dash !== undefined) {
    const dash = readString(record.dash, `${path}.dash`);
    if (dash !== "solid" && dash !== "dashed" && dash !== "dotted") fail(`${path}.dash`);
    style.dash = dash;
  }
  if (record.arrowStart !== undefined)
    style.arrowStart = readBoolean(record.arrowStart, `${path}.arrowStart`);
  if (record.arrowEnd !== undefined)
    style.arrowEnd = readBoolean(record.arrowEnd, `${path}.arrowEnd`);
  if (record.labelFontSize !== undefined) {
    style.labelFontSize = clampLabelFontSizePx(
      readPositiveNumber(record.labelFontSize, `${path}.labelFontSize`),
    );
  }
  if (record.fontFamily !== undefined) {
    const value = readString(record.fontFamily, `${path}.fontFamily`);
    if (
      value !== "Arial" &&
      value !== "Helvetica" &&
      value !== "Georgia" &&
      value !== "Courier New"
    )
      fail(`${path}.fontFamily`);
    style.fontFamily = value;
  }
  if (record.fontWeight !== undefined) {
    const value = readString(record.fontWeight, `${path}.fontWeight`);
    if (value !== "normal" && value !== "bold") fail(`${path}.fontWeight`);
    style.fontWeight = value;
  }
  if (record.fontStyle !== undefined) {
    const value = readString(record.fontStyle, `${path}.fontStyle`);
    if (value !== "normal" && value !== "italic") fail(`${path}.fontStyle`);
    style.fontStyle = value;
  }
  if (record.textAlign !== undefined) {
    const value = readString(record.textAlign, `${path}.textAlign`);
    if (value !== "left" && value !== "center" && value !== "right") fail(`${path}.textAlign`);
    style.textAlign = value;
  }
  return style;
}

function readMeasurement(value: unknown, path: string): PlanObject["measurement"] {
  if (value === undefined || value === null) return undefined;
  const record = readRecord(value, path);
  const kind = readString(record.kind, `${path}.kind`);
  if (kind !== "length" && kind !== "angle" && kind !== "area") fail(`${path}.kind`);
  return {
    kind,
    ...(record.showSegments !== undefined
      ? { showSegments: readBoolean(record.showSegments, `${path}.showSegments`) }
      : {}),
  };
}

/** Label display settings, all four flags required once the object is present at all. */
/**
 * `stands` arrived with KL-038, so every file written before it lacks the
 * key. Missing means the default rather than a refusal: an absent switch
 * is not a corrupt one, and the alternative would make every plan written
 * up to KL-037 unreadable to gain nothing. A *present* value is still
 * validated strictly.
 */
function readLabelDisplay(value: unknown, path: string): LabelDisplay {
  const record = readRecord(value, path);
  return {
    name: readBoolean(record.name, `${path}.name`),
    dimensions: readBoolean(record.dimensions, `${path}.dimensions`),
    reference: readBoolean(record.reference, `${path}.reference`),
    quantity: readBoolean(record.quantity, `${path}.quantity`),
    stands:
      record.stands === undefined
        ? DEFAULT_LABEL_DISPLAY.stands
        : readBoolean(record.stands, `${path}.stands`),
  };
}

/**
 * The stand grid of a marquee (KL-038).
 *
 * `labels` has to hold exactly one entry per cell. A mismatch is a broken
 * file, not a grid to be patched up: padding it would silently move the
 * user's text into the wrong squares, which is worse than saying where
 * the file is wrong — the same rule KL-032 settled for the catalogue.
 */
function readStandGrid(value: unknown, path: string): StandGrid {
  const record = readRecord(value, path);
  const columns = readFiniteNumber(record.columns, `${path}.columns`);
  const rows = readFiniteNumber(record.rows, `${path}.rows`);
  if (!Number.isInteger(columns) || columns < 1) fail(`${path}.columns`);
  if (!Number.isInteger(rows) || rows < 1) fail(`${path}.rows`);

  const gapM = readFiniteNumber(record.gapM, `${path}.gapM`);
  const marginM = readFiniteNumber(record.marginM, `${path}.marginM`);
  if (gapM < 0) fail(`${path}.gapM`);
  if (marginM < 0) fail(`${path}.marginM`);

  const labels = readArray(record.labels, `${path}.labels`).map((label, i) =>
    readString(label, `${path}.labels[${i}]`),
  );
  if (labels.length !== columns * rows) fail(`${path}.labels`);

  return { columns, rows, gapM, marginM, labels };
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
    ...(record.display !== undefined
      ? { display: readLabelDisplay(record.display, `${path}.display`) }
      : {}),
    ...(record.catalogId !== undefined
      ? { catalogId: readString(record.catalogId, `${path}.catalogId`) }
      : {}),
    ...(record.category !== undefined
      ? { category: readString(record.category, `${path}.category`) }
      : {}),
    ...(record.reference !== undefined
      ? { reference: readString(record.reference, `${path}.reference`) }
      : {}),
    ...(record.quantity !== undefined
      ? { quantity: readPositiveNumber(record.quantity, `${path}.quantity`) }
      : {}),
    ...(record.unit !== undefined ? { unit: readString(record.unit, `${path}.unit`) } : {}),
    ...(record.style !== undefined ? { style: readStyle(record.style, `${path}.style`) } : {}),
    ...(record.measurement !== undefined
      ? { measurement: readMeasurement(record.measurement, `${path}.measurement`) }
      : {}),
    ...(record.groupId !== undefined
      ? { groupId: readString(record.groupId, `${path}.groupId`) }
      : {}),
    ...(record.groupName !== undefined
      ? { groupName: readString(record.groupName, `${path}.groupName`) }
      : {}),
  };

  const type = readString(record.type, `${path}.type`);
  switch (type) {
    case "rectangle":
      return {
        ...base,
        type: "rectangle",
        widthM: readPositiveNumber(record.widthM, `${path}.widthM`),
        heightM: readPositiveNumber(record.heightM, `${path}.heightM`),
        ...(record.stands !== undefined
          ? { stands: readStandGrid(record.stands, `${path}.stands`) }
          : {}),
      };
    case "circle":
      return {
        ...base,
        type: "circle",
        radiusM: readPositiveNumber(record.radiusM, `${path}.radiusM`),
      };
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
    case "symbol": {
      const character = readString(record.character, `${path}.character`);
      // Refused, not quietly kept: a character outside the palette has no
      // glyph in the PDF's fonts, so the plan would print with a hole
      // exactly where the symbol is — and a file that reads fine and
      // prints wrong is worse than one that refuses. See `domain/symbols.ts`.
      if (!isPaletteSymbol(character)) fail(`${path}.character`);
      return {
        ...base,
        type: "symbol",
        character,
        sizeM: readPositiveNumber(record.sizeM, `${path}.sizeM`),
      };
    }
    case "image":
      return {
        ...base,
        type: "image",
        url: readString(record.url, `${path}.url`),
        widthPx: readPositiveNumber(record.widthPx, `${path}.widthPx`),
        heightPx: readPositiveNumber(record.heightPx, `${path}.heightPx`),
        widthM: readPositiveNumber(record.widthM, `${path}.widthM`),
        heightM: readPositiveNumber(record.heightM, `${path}.heightM`),
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
  const defaults = {
    paperSize: "A3",
    orientation: "landscape",
    scaleDenominator: 200,
    marginMm: 10,
  } as const;

  const paperSize =
    record.paperSize === undefined
      ? defaults.paperSize
      : readString(record.paperSize, `${path}.paperSize`);
  if (!PAPER_SIZE_ORDER.includes(paperSize as PaperSize)) fail(`${path}.paperSize`);

  const orientation =
    record.orientation === undefined
      ? defaults.orientation
      : readString(record.orientation, `${path}.orientation`);
  if (orientation !== "portrait" && orientation !== "landscape") fail(`${path}.orientation`);

  let titleBlock: Sheet["titleBlock"];
  if (record.titleBlock !== undefined) {
    const block = readRecord(record.titleBlock, `${path}.titleBlock`);
    titleBlock = {
      ...(block.client !== undefined
        ? { client: readString(block.client, `${path}.titleBlock.client`) }
        : {}),
      ...(block.author !== undefined
        ? { author: readString(block.author, `${path}.titleBlock.author`) }
        : {}),
      ...(block.revision !== undefined
        ? { revision: readString(block.revision, `${path}.titleBlock.revision`) }
        : {}),
      ...(block.planNumber !== undefined
        ? { planNumber: readString(block.planNumber, `${path}.titleBlock.planNumber`) }
        : {}),
      ...(block.comments !== undefined
        ? { comments: readString(block.comments, `${path}.titleBlock.comments`) }
        : {}),
      ...(block.logoDataUrl !== undefined
        ? { logoDataUrl: readString(block.logoDataUrl, `${path}.titleBlock.logoDataUrl`) }
        : {}),
      ...(block.customFields !== undefined
        ? {
            customFields: readArray(block.customFields, `${path}.titleBlock.customFields`).map(
              (value, index) => {
                const field = readRecord(value, `${path}.titleBlock.customFields[${index}]`);
                return {
                  label: readString(field.label, `${path}.titleBlock.customFields[${index}].label`),
                  value: readString(field.value, `${path}.titleBlock.customFields[${index}].value`),
                };
              },
            ),
          }
        : {}),
    };
  }

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
      record.marginMm === undefined
        ? defaults.marginMm
        : readFiniteNumber(record.marginMm, `${path}.marginMm`),
    ...(titleBlock ? { titleBlock } : {}),
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
      throw new FieldError({
        code: "danglingLayerRef",
        objectId: object.id,
        layerId: object.layerId,
      });
    }
  }

  let georeference: Project["georeference"];
  if (record.georeference !== undefined) {
    const geo = readRecord(record.georeference, `${path}.georeference`);
    if (geo.crs !== "EPSG:4326") fail(`${path}.georeference.crs`);
    georeference = {
      crs: "EPSG:4326",
      originLongitude: readFiniteNumber(
        geo.originLongitude,
        `${path}.georeference.originLongitude`,
      ),
      originLatitude: readFiniteNumber(geo.originLatitude, `${path}.georeference.originLatitude`),
      rotationDeg: readFiniteNumber(geo.rotationDeg, `${path}.georeference.rotationDeg`),
    };
  }
  let collaboration: Project["collaboration"];
  if (record.collaboration !== undefined) {
    const value = readRecord(record.collaboration, `${path}.collaboration`);
    collaboration = {
      comments: readArray(value.comments, `${path}.collaboration.comments`).map((raw, index) => {
        const comment = readRecord(raw, `${path}.collaboration.comments[${index}]`);
        return {
          id: readString(comment.id, `${path}.collaboration.comments[${index}].id`),
          author: readString(comment.author, `${path}.collaboration.comments[${index}].author`),
          text: readString(comment.text, `${path}.collaboration.comments[${index}].text`),
          createdAt: readString(
            comment.createdAt,
            `${path}.collaboration.comments[${index}].createdAt`,
          ),
          resolved: readBoolean(
            comment.resolved,
            `${path}.collaboration.comments[${index}].resolved`,
          ),
          ...(comment.objectId !== undefined
            ? {
                objectId: readString(
                  comment.objectId,
                  `${path}.collaboration.comments[${index}].objectId`,
                ),
              }
            : {}),
        };
      }),
    };
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
    ...(record.labelDisplay !== undefined
      ? { labelDisplay: readLabelDisplay(record.labelDisplay, `${path}.labelDisplay`) }
      : {}),
    ...(georeference ? { georeference } : {}),
    ...(collaboration ? { collaboration } : {}),
    backgrounds: readBackgrounds(record, path),
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
  // build would drop on the next save. Older versions are migrated as
  // they are read, field by field, rather than in a separate pass.
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

/**
 * Validates a bare array of plan objects — the payload the reusable-component
 * library keeps in `localStorage`, which has no project, layers or sheets
 * around it. It goes through the very same `readObject` the project parser
 * uses, so a template can never smuggle in a shape the editor cannot draw.
 * Returns `null` rather than a `ParseError`: the caller's only sane recovery
 * is to ignore the stored value.
 */
export function parsePlanObjects(value: unknown): PlanObject[] | null {
  if (!Array.isArray(value)) return null;
  try {
    return value.map((item, index) => readObject(item, `objects[${index}]`));
  } catch (error) {
    if (error instanceof FieldError) return null;
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
