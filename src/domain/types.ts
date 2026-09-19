/**
 * Domain model — event layout plans.
 *
 * Everything in this file is expressed in real-world units (meters,
 * degrees) or plain metadata. Nothing here knows about pixels, the screen,
 * React, or Konva. See `docs/ARCHITECTURE.md` for the reasoning.
 */

/** A distance in meters. Kept as a branded-looking alias for readability. */
export type Meters = number;

/** A rotation in degrees, clockwise, 0 = unrotated. */
export type Degrees = number;

/** An ISO-8601 timestamp string. */
export type IsoDateTime = string;

/** Measurement units the project is authored in. Only meters for now. */
export type Units = "m";

import type { LabelDisplay } from "./display";
export type { LabelDisplay };

import type { StandGrid } from "./stands";
export type { StandGrid };

/** A point expressed in world (meter) coordinates. */
export interface PointM {
  xM: Meters;
  yM: Meters;
}

// ---------------------------------------------------------------------------
// Calibration
// ---------------------------------------------------------------------------

/**
 * Where a calibration's `pixelsPerMeter` value came from. Kept as a
 * discriminated union so the calibration UI (a later mission) can show an
 * appropriate explanation, and so recalibration can be traced.
 */
export type CalibrationSource =
  | { type: "default" }
  | {
      /** Derived from a known real-world distance measured between two points on the background image. */
      type: "knownDistance";
      pixelDistance: number;
      realDistanceM: Meters;
    }
  | {
      /** Derived from a known map/plan scale, e.g. 1:100. */
      type: "knownScale";
      scale: number;
    }
  | {
      /** Calibration imported from a geographic source; project anchoring is stored in `Project.georeference`. */
      type: "geo";
      description: string;
    };

/**
 * How the project's background image relates to the real world: how many
 * of the *image's own* pixels make up one meter. It is emphatically not a
 * screen scale — how big a meter is drawn is `Viewport`'s business (see
 * `DEFAULT_SCREEN_PIXELS_PER_METER` in `rendering/viewport.ts`), and
 * calibrating a plan must never silently change the user's zoom level.
 *
 * Set by the calibration flow (KL-005), which measures a segment the user
 * draws on the background and asks what it really spans; the background's
 * `widthM`/`heightM` are then derived from its native `widthPx`/`heightPx`
 * through this value. Deliberately small — see `docs/ARCHITECTURE.md`.
 */
export interface Calibration {
  pixelsPerMeter: number;
  source: CalibrationSource;
}

// ---------------------------------------------------------------------------
// Background
// ---------------------------------------------------------------------------

/**
 * The imported plan background (floor plan, satellite view, etc). Modeled
 * separately from `Layer` / `PlanObject` because it is not a drawable
 * business object — it isn't assigned to a layer, it isn't one of the
 * `PlanObject` shape types, and (until KL-005's interactive calibration)
 * its size in meters is only a first guess — even though the UI presents
 * it alongside the layers.
 *
 * `widthPx`/`heightPx` are the source image's native pixel resolution
 * (kept to derive its aspect ratio and as useful metadata); `xM`/`yM`/
 * `widthM`/`heightM` are its placement and size in world meters — the
 * same anchor-plus-size shape as `RectangleObject`, so it reuses the same
 * metric rendering pipeline. Rotation uses the top-left anchor, like a
 * rectangle object, which keeps screen rendering, export and bounds in sync.
 */
export interface BackgroundImage {
  id: string;
  kind: "image";
  /** Object URL, data URL, or later a file path — resolved by the app shell, not the domain. */
  url: string;
  widthPx: number;
  heightPx: number;
  xM: Meters;
  yM: Meters;
  widthM: Meters;
  heightM: Meters;
  rotationDeg: Degrees;
  opacity: number;
  /** Shown in the layers panel and the background list; defaults to the imported file's name. */
  name: string;
  /** Non-destructive image corrections; the original data URL is preserved. */
  brightness: number;
  contrast: number;
  grayscale: boolean;
  whiteRemoval: boolean;
  whiteThreshold: number;
  /** Source-pixel crop. Missing means the complete native image. */
  crop?: { xPx: number; yPx: number; widthPx: number; heightPx: number };
  visible: boolean;
  locked: boolean;
}

/**
 * Kept as an alias so the many places that hold "one background, or none"
 * — a selection, a shape being rendered — still read clearly now that a
 * project holds a stack of them.
 */
export type Background = BackgroundImage | null;

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

export interface Layer {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  /** Draw / stacking order, ascending. */
  order: number;
  folder?: string;
  defaultStyle?: ObjectStyle;
}

// ---------------------------------------------------------------------------
// Plan objects
// ---------------------------------------------------------------------------

export interface ObjectStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
  dash?: "solid" | "dashed" | "dotted";
  arrowStart?: boolean;
  arrowEnd?: boolean;
  /**
   * Size of the label this object writes on the plan, in *screen* pixels
   * — the caption, not a `text` object's own body, which is in metres
   * (`TextObject.fontSizeM`). Screen pixels because a caption is
   * annotation: it stays legible at every zoom instead of shrinking with
   * the thing it names, and on paper it is scaled to the print
   * resolution. Absent means the default for the object's type.
   */
  labelFontSize?: number;
  fontFamily?: "Arial" | "Helvetica" | "Georgia" | "Courier New";
  fontWeight?: "normal" | "bold";
  fontStyle?: "normal" | "italic";
  textAlign?: "left" | "center" | "right";
}

export interface MeasurementMetadata {
  kind: "length" | "angle" | "area";
  showSegments?: boolean;
}

/**
 * Fields shared by every plan object.
 *
 * `xM` / `yM` is the object's anchor point in world coordinates. For
 * multi-point objects (line, polygon) the anchor is their local origin and
 * `pointsM` are stored relative to it — this keeps "move" and "rotate"
 * uniform across every object type instead of being special-cased per type.
 */
export interface PlanObjectBase {
  id: string;
  layerId: string;
  name: string;
  /** Legacy free-text override kept for files written before KL-027; new plans use `display` instead. */
  label?: string;
  /** Per-object override of what the label shows. Absent means "follow the project's setting". */
  display?: LabelDisplay;
  /** Optional material-library reference used by schedules and quantity exports. */
  catalogId?: string;
  category?: string;
  reference?: string;
  /** Number of identical items represented by this symbol (defaults to 1). */
  quantity?: number;
  unit?: string;
  /** Marks a drawable line/polygon as a persistent dimension annotation. */
  measurement?: MeasurementMetadata;
  groupId?: string;
  groupName?: string;
  xM: Meters;
  yM: Meters;
  rotationDeg: Degrees;
  style?: ObjectStyle;
}

export interface RectangleObject extends PlanObjectBase {
  type: "rectangle";
  widthM: Meters;
  heightM: Meters;
  /**
   * Stands laid out inside this surface, drawn as text only. Absent on a
   * plain rectangle, which is nearly all of them. See `domain/stands.ts`
   * for why this is a property rather than the objects KL-030 created.
   */
  stands?: StandGrid;
}

export interface CircleObject extends PlanObjectBase {
  type: "circle";
  radiusM: Meters;
}

export interface LineObject extends PlanObjectBase {
  type: "line";
  /** Points relative to (xM, yM), in meters. */
  pointsM: PointM[];
}

export interface PolygonObject extends PlanObjectBase {
  type: "polygon";
  /** Points relative to (xM, yM), in meters. */
  pointsM: PointM[];
}

export interface TextObject extends PlanObjectBase {
  type: "text";
  text: string;
  fontSizeM: Meters;
}

export interface ImageObject extends PlanObjectBase {
  type: "image";
  url: string;
  widthPx: number;
  heightPx: number;
  widthM: Meters;
  heightM: Meters;
}

/**
 * A single character standing on the plan: an arrow, a cross, a numbered
 * marker (see `domain/symbols.ts` for the palette and why it is closed).
 *
 * Its anchor is its **centre**, like a circle's and unlike a text
 * object's, because a symbol marks a point — the point it marks is the
 * one you place, and rotating it must turn it on the spot rather than
 * swing it. `sizeM` is the glyph's height in metres of ground, so it is
 * drawn to the scale of the plan and shrinks with it.
 */
export interface SymbolObject extends PlanObjectBase {
  type: "symbol";
  /** One character from the palette in `domain/symbols.ts`. */
  character: string;
  sizeM: Meters;
}

export type PlanObject =
  | RectangleObject
  | CircleObject
  | LineObject
  | PolygonObject
  | TextObject
  | ImageObject
  | SymbolObject;

/**
 * A partial update to a `PlanObject`, distributed over the union so each
 * member's own fields (e.g. `widthM`) are available — plain `Partial<PlanObject>`
 * would collapse to only the fields every variant shares, since `keyof`
 * a union is the *intersection* of its members' keys. Used by editing
 * code (drag/resize/rotate, the properties panel) that patches whichever
 * fields make sense for the selected object's actual type.
 */
type DistributivePartial<T> = T extends unknown ? Partial<T> : never;
export type PlanObjectPatch = DistributivePartial<PlanObject>;

// ---------------------------------------------------------------------------
// Sheets — a printable page of the plan (KL-009)
// ---------------------------------------------------------------------------

/** ISO 216 paper sizes, the ones an event plan is realistically printed on. */
export type PaperSize = "A4" | "A3" | "A2" | "A1" | "A0";

export type Orientation = "portrait" | "landscape";

export interface SheetTitleBlock {
  client?: string;
  author?: string;
  revision?: string;
  planNumber?: string;
  comments?: string;
  /** JPEG data URL, normalized on import so it can be embedded in PDF. */
  logoDataUrl?: string;
  customFields?: { label: string; value: string }[];
}

/**
 * How the plan is put on paper: which sheet, which way round, and — the
 * part that actually matters — at what scale.
 *
 * `scaleDenominator` is the S in 1:S. At 1:100, one metre on the ground is
 * ten millimetres on the page, so a printed plan can be measured with a
 * ruler. That is the whole point of exporting from this app rather than
 * screenshotting it, and it's why the scale is stored on the project
 * (persisted, re-used, shown on the sheet) instead of being a transient
 * dialog setting.
 *
 * Made functional in KL-009; `Sheet` existed as a placeholder (`id` +
 * `name`) from KL-001 onwards.
 */
export interface Sheet {
  id: string;
  name: string;
  paperSize: PaperSize;
  orientation: Orientation;
  /** The S in 1:S. 100 means one metre on the ground is 10 mm on paper. */
  scaleDenominator: number;
  /** White border kept on every edge, in millimetres — printers can't reach the paper edge. */
  marginMm: number;
  /** Optional project-delivery metadata printed in the title block. */
  titleBlock?: SheetTitleBlock;
}

// ---------------------------------------------------------------------------
// Project
// ---------------------------------------------------------------------------

export interface Project {
  id: string;
  name: string;
  description: string;
  location: string;
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
  units: Units;
  calibration: Calibration;
  /** What object labels show by default across the plan. Individual objects may override it. */
  labelDisplay?: LabelDisplay;
  /** Optional WGS84 anchor for converting the local metric plan to/from GeoJSON. */
  georeference?: {
    crs: "EPSG:4326";
    originLongitude: number;
    originLatitude: number;
    /** Clockwise angle from local +X to geographic east. */
    rotationDeg: Degrees;
  };
  /**
   * The imported plan backdrops, bottom first. A site is routinely read
   * against more than one — a surveyed plan with a satellite view over
   * it, a previous year's layout underneath this one — so this is a
   * stack, each with its own placement, opacity and corrections.
   *
   * Files written before KL-029 carried a single `background`; the parser
   * migrates it into a one-element stack.
   */
  backgrounds: BackgroundImage[];
  layers: Layer[];
  objects: PlanObject[];
  sheets: Sheet[];
  collaboration?: {
    comments: {
      id: string;
      author: string;
      text: string;
      createdAt: IsoDateTime;
      resolved: boolean;
      objectId?: string;
    }[];
  };
}
