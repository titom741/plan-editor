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
      /** Reserved for future geo-referenced backgrounds (not implemented yet). */
      type: "geo";
      description: string;
    };

/**
 * The single source of truth for converting between meters and pixels for
 * a project's background. This is deliberately small — see
 * `docs/ARCHITECTURE.md` for why it is not over-designed yet.
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
 * metric rendering pipeline. There is no `rotationDeg`: a background is
 * not rotated in KL-003 (most scanned/photographed plans don't need it;
 * revisit if a real case comes up).
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
  opacity: number;
  visible: boolean;
  locked: boolean;
}

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
}

// ---------------------------------------------------------------------------
// Plan objects
// ---------------------------------------------------------------------------

export interface ObjectStyle {
  fill?: string;
  stroke?: string;
  strokeWidth?: number;
  opacity?: number;
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
  /** Optional user-provided override. When absent, the UI derives a label from the object's geometry (see `domain/labels.ts`). */
  label?: string;
  xM: Meters;
  yM: Meters;
  rotationDeg: Degrees;
  style?: ObjectStyle;
}

export interface RectangleObject extends PlanObjectBase {
  type: "rectangle";
  widthM: Meters;
  heightM: Meters;
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

export type PlanObject =
  | RectangleObject
  | CircleObject
  | LineObject
  | PolygonObject
  | TextObject;

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
// Sheets (prepared, not functional yet — see KL-009)
// ---------------------------------------------------------------------------

export interface Sheet {
  id: string;
  name: string;
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
  background: Background;
  layers: Layer[];
  objects: PlanObject[];
  sheets: Sheet[];
}
