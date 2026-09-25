import { getLocalCenter, objectLocalToWorld, worldToObjectLocal } from "./geometry";
import { formatMeters } from "./labels";
import { polylineLengthM } from "./measure";
import { createCircleObject, createLineObject, createRectangleObject } from "./objects";
import type {
  CircleObject,
  Layer,
  LineObject,
  ObjectStyle,
  PlanObject,
  PointM,
  Project,
  RectangleObject,
} from "./types";

/**
 * The electrical side of a plan (KL-045): where the power comes from,
 * which box it goes through, which cable carries it and what it feeds.
 *
 * **A property, not a type.** A coffret is still a rectangle and a cable
 * is still a line: they move, rotate, print, export and snap exactly like
 * every other shape, because they *are* those shapes. What they gain is an
 * `electrical` record describing what they are electrically — the same
 * move KL-038 made for stands. A new object type would have had to be
 * taught to the renderer, the three exports, the bounds, the handles and
 * the file reader, for no gain the property doesn't already give.
 *
 * **Cables hold their ends.** A cable names the device at each end
 * (`fromId`, `toId`) and its end vertices sit on those devices' centres.
 * `reconcileCables` keeps that true after every edit: move a coffret and
 * the cables follow it; drag a cable's end onto another device and it is
 * re-plugged there; drag it into empty ground and it is unplugged. The
 * network below is read from those names, never guessed from geometry.
 *
 * **The checks are a planning aid, not a design note.** The ampacity table
 * is deliberately conservative (flexible H07RN-F laid on the ground, the
 * sizes event electricians actually pair with each protection), and the
 * voltage drop is the resistive formula of NF C 15-100 with no reactance.
 * They exist to catch the 2.5 mm² extension on a 32 A socket before the
 * day, not to sign off an installation — the dialog says so.
 */

export type Phases = "mono" | "tri";

/** Where the power comes from: a grid connection or a generator. */
export interface SourceSpec {
  role: "source";
  kind: "grid" | "generator" | "other";
  phases: Phases;
  /** What the source can deliver, per phase, in amperes. */
  ratingA: number;
}

/** A group of identical outgoing sockets on a coffret: "2 × 32 A tri". */
export interface BoardOutput {
  phases: Phases;
  ratingA: number;
  count: number;
}

/** A distribution box: one incoming supply, protected, and its outgoing sockets. */
export interface BoardSpec {
  role: "board";
  phases: Phases;
  /** Rating of the incoming supply / main breaker. */
  ratingA: number;
  /** Residual-current protection in mA; absent when the box has none. */
  rcdMa?: number;
  /** Outgoing sockets. Empty means "not described" and switches the socket count check off. */
  outputs: BoardOutput[];
  /** Consumers plugged straight into the box, not drawn on the plan (KL-048). */
  loads?: DirectLoad[];
}

/**
 * A consumer plugged straight into a coffret or a power strip, listed on
 * it rather than drawn (KL-048).
 *
 * Thirty projectors round a marquee are thirty identical circles and
 * thirty cables nobody needs on the plan — what the electrician needs is
 * their power in the balance and a socket for each. So they can be listed
 * on the device that feeds them instead, with a quantity. Drawing a load
 * and its cable remains the way to put one *somewhere*; the two mix
 * freely on the same coffret.
 */
export interface DirectLoad {
  name: string;
  phases: Phases;
  /** Power of one unit, in watts. */
  powerW: number;
  /** How many identical units, each on its own socket. */
  quantity: number;
}

/** A flexible cable run between two devices. Only ever carried by a `line`. */
export interface CableSpec {
  role: "cable";
  phases: Phases;
  /** Cross-section of each conductor, in mm². */
  sectionMm2: number;
  /** Rating of the socket / protection it is plugged into upstream. */
  ratingA: number;
  /** Length actually laid, when it differs from the drawn run (up a mast, coiled). Absent means the drawn length. */
  lengthM?: number;
  /** The device at the cable's first vertex. */
  fromId?: string;
  /** The device at the cable's last vertex. */
  toId?: string;
}

/**
 * A power strip: a domestic single-phase one, or a three-phase splitter
 * (KL-049). All its sockets are of its own phases — a single-phase plug
 * does not go into a P17 three-phase socket, and a box that offers both
 * is a coffret.
 */
export interface StripSpec {
  role: "strip";
  phases: Phases;
  outlets: number;
  ratingA: number;
  /** Consumers plugged straight into the strip (KL-048). */
  loads?: DirectLoad[];
}

/** Anything that consumes: a fridge, a PA, a string of lights. */
export interface LoadSpec {
  role: "load";
  phases: Phases;
  powerW: number;
}

export type ElectricalSpec = SourceSpec | BoardSpec | CableSpec | StripSpec | LoadSpec;
export type ElectricalRole = ElectricalSpec["role"];
export type DeviceSpec = Exclude<ElectricalSpec, CableSpec>;
export type DeviceRole = DeviceSpec["role"];

/** A shape that is an electrical device. Only rectangles and circles can be one: they have an inside to plug a cable into. */
export type DeviceObject = (RectangleObject | CircleObject) & { electrical: DeviceSpec };
export type CableObject = LineObject & { electrical: CableSpec };

export const DEVICE_ROLES: readonly DeviceRole[] = ["source", "board", "strip", "load"];

export const ELECTRICAL_ROLE_LABELS: Record<ElectricalRole, string> = {
  source: "Alimentation",
  board: "Coffret",
  cable: "Câble",
  strip: "Multiprise",
  load: "Récepteur",
};

export const SOURCE_KIND_LABELS: Record<SourceSpec["kind"], string> = {
  grid: "Branchement réseau",
  generator: "Groupe électrogène",
  other: "Autre source",
};

export const PHASE_LABELS: Record<Phases, string> = { mono: "mono", tri: "tri" };

/** Nominal voltage the formulas use: phase-neutral for single-phase, phase-phase for three-phase. */
export const NOMINAL_VOLTAGE_V: Record<Phases, number> = { mono: 230, tri: 400 };

/** Power factor assumed when turning a load's watts into amperes. Pessimistic on purpose: it only ever makes the current larger. */
export const POWER_FACTOR = 0.9;

/** Resistivity of copper at operating temperature, Ω·mm²/m — the value NF C 15-100 uses for voltage drop. */
export const COPPER_RESISTIVITY = 0.0225;

/** Voltage drop above which a device is flagged, in percent of the nominal voltage. */
export const MAX_VOLTAGE_DROP_PCT = 5;

/** Protection above which a socket need not be on a 30 mA RCD. At or below it, one open to the public must be. */
export const RCD_REQUIRED_UP_TO_A = 32;

/** Standard cross-sections of flexible cable, in mm². */
export const CABLE_SECTIONS_MM2: readonly number[] = [
  1.5, 2.5, 4, 6, 10, 16, 25, 35, 50, 70, 95, 120,
];

/** The protections a socket or breaker commonly comes in, in amperes. */
export const STANDARD_RATINGS_A: readonly number[] = [
  10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 400,
];

/**
 * The highest protection each section may sit behind. Conservative:
 * H07RN-F on the ground, sometimes coiled, in the sun — the pairings an
 * event electrician uses (16 A on 2.5, 32 A on 6, 63 A on 16, 125 A on 35).
 */
const MAX_RATING_BY_SECTION_A: ReadonlyMap<number, number> = new Map([
  // 16 A on 1.5 mm² is only allowed for lighting circuits; a socket run
  // at an event is never only lighting, so 1.5 stays on 10 A.
  [1.5, 10],
  [2.5, 20],
  [4, 25],
  [6, 32],
  [10, 50],
  [16, 63],
  [25, 80],
  [35, 125],
  [50, 160],
  [70, 200],
  [95, 250],
  [120, 250],
]);

/** The largest protection a cable of this section may be plugged into. A section off the table gets the next smaller one's value. */
export function maxRatingForSectionA(sectionMm2: number): number {
  let best = 0;
  for (const [section, rating] of MAX_RATING_BY_SECTION_A) {
    if (section <= sectionMm2 + 1e-9) best = rating;
  }
  return best;
}

/** The smallest standard section allowed behind this protection, or `null` above what the table covers. */
export function minSectionForRatingMm2(ratingA: number): number | null {
  for (const section of CABLE_SECTIONS_MM2) {
    if (maxRatingForSectionA(section) >= ratingA) return section;
  }
  return null;
}

/** Current drawn by `powerW`, balanced over three phases when `tri`. */
export function currentForPowerA(powerW: number, phases: Phases): number {
  if (powerW <= 0) return 0;
  return phases === "tri"
    ? powerW / (Math.sqrt(3) * NOMINAL_VOLTAGE_V.tri * POWER_FACTOR)
    : powerW / (NOMINAL_VOLTAGE_V.mono * POWER_FACTOR);
}

/** Apparent power a supply of `ratingA` can deliver, in kVA. */
export function ratingPowerKva(ratingA: number, phases: Phases): number {
  const volts = phases === "tri" ? Math.sqrt(3) * NOMINAL_VOLTAGE_V.tri : NOMINAL_VOLTAGE_V.mono;
  return (volts * ratingA) / 1000;
}

/**
 * Voltage drop along one cable, in percent of the nominal voltage.
 * Resistive term only: b·ρ·L·I / S, with b = 2 for single-phase (out and
 * back) and √3 for balanced three-phase.
 */
export function voltageDropPct(
  phases: Phases,
  lengthM: number,
  currentA: number,
  sectionMm2: number,
): number {
  if (sectionMm2 <= 0 || lengthM <= 0 || currentA <= 0) return 0;
  const b = phases === "tri" ? Math.sqrt(3) : 2;
  const volts = (b * COPPER_RESISTIVITY * lengthM * currentA) / sectionMm2;
  return (volts / NOMINAL_VOLTAGE_V[phases]) * 100;
}

// ---------------------------------------------------------------------------
// Reading objects
// ---------------------------------------------------------------------------

export function isDevice(object: PlanObject): object is DeviceObject {
  return (
    (object.type === "rectangle" || object.type === "circle") &&
    object.electrical !== undefined &&
    object.electrical.role !== "cable"
  );
}

export function isCable(object: PlanObject): object is CableObject {
  return object.type === "line" && object.electrical?.role === "cable";
}

/**
 * Where a device's caption hangs from, in its own frame: the middle of
 * its lower edge. A coffret is a few decimetres of ground; at the scale a
 * site is printed, its name and rating centred *inside* it would be cut
 * to a couple of letters. Under it, like a symbol's, they read whole.
 */
export function deviceCaptionAnchorLocal(device: DeviceObject): PointM {
  return device.type === "circle"
    ? { xM: 0, yM: device.radiusM }
    : { xM: device.widthM / 2, yM: device.heightM };
}

/** The consumers listed on a device, empty for one that can't carry any. */
export function directLoadsOf(spec: ElectricalSpec): readonly DirectLoad[] {
  return spec.role === "board" || spec.role === "strip" ? (spec.loads ?? []) : [];
}

/** Total power of a device's listed consumers, in watts. */
export function directLoadsW(spec: ElectricalSpec): number {
  return directLoadsOf(spec).reduce((sum, load) => sum + load.powerW * load.quantity, 0);
}

/** The ratings sockets actually come in (domestic 16 A, then P17): 20 A or 40 A breakers exist, sockets don't. */
export const SOCKET_RATINGS_A: readonly number[] = [16, 32, 63, 125];

/**
 * The socket a listed consumer takes: its phases, and the smallest socket
 * rating that carries one unit's **nameplate** current (P / U). A socket
 * is chosen by what the appliance says it draws — a 3.5 kW fryer goes on
 * a 16 A socket, which takes 3680 W — while the balance keeps its
 * pessimistic power factor for what flows upstream.
 */
export function directLoadSocket(load: Pick<DirectLoad, "phases" | "powerW">): {
  phases: Phases;
  ratingA: number;
} {
  const volts =
    load.phases === "tri" ? Math.sqrt(3) * NOMINAL_VOLTAGE_V.tri : NOMINAL_VOLTAGE_V.mono;
  const nameplateA = load.powerW / volts;
  return {
    phases: load.phases,
    ratingA:
      SOCKET_RATINGS_A.find((rating) => rating >= nameplateA - 1e-9) ?? SOCKET_RATINGS_A.at(-1)!,
  };
}

/** Which roles a shape of this type may take — what the properties panel offers. */
export function rolesForType(type: PlanObject["type"]): readonly ElectricalRole[] {
  if (type === "line") return ["cable"];
  if (type === "rectangle" || type === "circle") return DEVICE_ROLES;
  return [];
}

/** The length the cable really runs: the typed one if any, the drawn one otherwise. */
export function cableLengthM(
  cable: Pick<LineObject, "pointsM"> & { electrical: CableSpec },
): number {
  return cable.electrical.lengthM ?? polylineLengthM(cable.pointsM);
}

/** The usual trade notation: conductors, "G" (one of them green-yellow), section — `5G16`, `3G2.5`. */
export function cableDesignation(spec: Pick<CableSpec, "phases" | "sectionMm2">): string {
  return `${spec.phases === "tri" ? 5 : 3}G${formatMeters(spec.sectionMm2)}`;
}

export function formatPowerW(powerW: number): string {
  if (powerW >= 1000) return `${formatMeters(Math.round(powerW / 100) / 10)} kW`;
  return `${formatMeters(Math.round(powerW))} W`;
}

export function formatCurrentA(currentA: number): string {
  return `${formatMeters(Math.round(currentA * 10) / 10)} A`;
}

export function formatOutput(output: BoardOutput): string {
  return `${output.count} × ${formatMeters(output.ratingA)} A ${PHASE_LABELS[output.phases]}`;
}

/** " · 3 récepteurs (4.5 kW)" when a device lists consumers, nothing otherwise. */
function listedSuffix(spec: BoardSpec | StripSpec): string {
  const count = directLoadsOf(spec).reduce((sum, load) => sum + load.quantity, 0);
  if (count === 0) return "";
  return ` · ${count} récepteur${count > 1 ? "s" : ""} (${formatPowerW(directLoadsW(spec))})`;
}

/**
 * What an electrical object writes on the plan, one line — only
 * characters the PDF's standard fonts can print (no ≈, no Δ).
 */
export function electricalSummary(
  object: PlanObject,
  /** Off where the listed consumers are shown on their own, as in the diagram. */
  { withListed = true }: { withListed?: boolean } = {},
): string | null {
  const spec = object.electrical;
  if (!spec) return null;
  switch (spec.role) {
    case "source":
      return `${SOURCE_KIND_LABELS[spec.kind]} · ${formatMeters(spec.ratingA)} A ${PHASE_LABELS[spec.phases]}`;
    case "board": {
      const rcd = spec.rcdMa ? ` · Diff. ${formatMeters(spec.rcdMa)} mA` : "";
      return `${formatMeters(spec.ratingA)} A ${PHASE_LABELS[spec.phases]}${rcd}${withListed ? listedSuffix(spec) : ""}`;
    }
    case "cable":
      return `${cableDesignation(spec)} · ${formatMeters(spec.ratingA)} A`;
    case "strip":
      return `${spec.outlets} prises ${formatMeters(spec.ratingA)} A ${PHASE_LABELS[spec.phases]}${withListed ? listedSuffix(spec) : ""}`;
    case "load":
      return `${formatPowerW(spec.powerW)} ${PHASE_LABELS[spec.phases]}`;
  }
}

/** What a freshly-chosen role starts as. Chosen to be the most common thing of its kind at an event. */
export function defaultElectricalSpec(role: ElectricalRole): ElectricalSpec {
  switch (role) {
    case "source":
      return { role, kind: "generator", phases: "tri", ratingA: 63 };
    case "board":
      return {
        role,
        phases: "tri",
        ratingA: 63,
        rcdMa: 30,
        outputs: [
          { phases: "tri", ratingA: 32, count: 1 },
          { phases: "tri", ratingA: 16, count: 2 },
          { phases: "mono", ratingA: 16, count: 6 },
        ],
      };
    case "cable":
      return { role, phases: "mono", sectionMm2: 2.5, ratingA: 16 };
    case "strip":
      return { role, phases: "mono", outlets: 6, ratingA: 16 };
    case "load":
      return { role, phases: "mono", powerW: 1000 };
  }
}

/**
 * How each device looks when a tool drops it: a real-world footprint (a
 * coffret is not a point, and a plan at 1:200 should show how much room
 * a generator takes) and a colour per role, so the four read apart at a
 * glance before any label is legible.
 */
const DEVICE_LOOKS: Record<
  DeviceRole,
  { shape: { widthM: number; heightM: number } | { radiusM: number }; style: ObjectStyle }
> = {
  source: {
    shape: { widthM: 2.2, heightM: 1.1 },
    style: { fill: "#fde68a", stroke: "#b45309", strokeWidth: 2.5, opacity: 1 },
  },
  board: {
    shape: { widthM: 0.8, heightM: 0.6 },
    style: { fill: "#fef9c3", stroke: "#ca8a04", strokeWidth: 2, opacity: 1 },
  },
  strip: {
    shape: { widthM: 0.6, heightM: 0.2 },
    style: { fill: "#e0f2fe", stroke: "#0369a1", strokeWidth: 1.5, opacity: 1 },
  },
  load: {
    shape: { radiusM: 0.3 },
    style: { fill: "#f3e8ff", stroke: "#7c3aed", strokeWidth: 1.5, opacity: 1 },
  },
};

/** Cable colour by phases — three-phase runs are the ones to route with care. */
export const CABLE_STROKES: Record<Phases, string> = { mono: "#2563eb", tri: "#dc2626" };

export function cableStyle(phases: Phases): ObjectStyle {
  return { stroke: CABLE_STROKES[phases], strokeWidth: phases === "tri" ? 3 : 2, opacity: 1 };
}

/**
 * The layer an electrical tool draws on: the plan's "Électricité" layer
 * when it has an unlocked one — every new project does — so the network
 * can be shown, hidden and locked as one; `null` otherwise, and the
 * caller falls back to the active layer.
 */
export function electricalLayerId(layers: readonly Layer[]): string | null {
  const layer = layers.find(
    (candidate) => !candidate.locked && candidate.name.trim().toLowerCase() === "électricité",
  );
  return layer?.id ?? null;
}

/** A new device of `role`, centred on `center`. */
export function createDeviceObject(input: {
  role: DeviceRole;
  center: PointM;
  layerId: string;
  name: string;
}): DeviceObject {
  const look = DEVICE_LOOKS[input.role];
  const common = {
    layerId: input.layerId,
    name: input.name,
    category: "Électricité",
    style: look.style,
    electrical: defaultElectricalSpec(input.role),
  };
  if ("radiusM" in look.shape) {
    return createCircleObject({
      ...common,
      xM: input.center.xM,
      yM: input.center.yM,
      radiusM: look.shape.radiusM,
    }) as DeviceObject;
  }
  // A rectangle's anchor is its corner; the click was meant as its middle.
  return createRectangleObject({
    ...common,
    xM: input.center.xM - look.shape.widthM / 2,
    yM: input.center.yM - look.shape.heightM / 2,
    widthM: look.shape.widthM,
    heightM: look.shape.heightM,
  }) as DeviceObject;
}

/** A new cable along `pointsM` (relative to `anchor`), unplugged until `reconcileCables` sees it. */
export function createCableObject(input: {
  anchor: PointM;
  pointsM: PointM[];
  layerId: string;
  name: string;
}): CableObject {
  const electrical = defaultElectricalSpec("cable") as CableSpec;
  return createLineObject({
    layerId: input.layerId,
    name: input.name,
    category: "Électricité",
    xM: input.anchor.xM,
    yM: input.anchor.yM,
    pointsM: input.pointsM,
    style: cableStyle(electrical.phases),
    electrical,
  }) as CableObject;
}

/** Where a device's cables plug in: its centre, wherever it has been moved or turned. */
export function deviceCenterWorld(device: PlanObject): PointM {
  return objectLocalToWorld(device, getLocalCenter(device));
}

/** How far outside a device a cable end may land and still be plugged into it, in metres. */
export const PLUG_TOLERANCE_M = 0.25;

function deviceContains(device: DeviceObject, world: PointM, toleranceM: number): boolean {
  if (device.type === "circle") {
    return Math.hypot(world.xM - device.xM, world.yM - device.yM) <= device.radiusM + toleranceM;
  }
  const local = worldToObjectLocal(device, world);
  return (
    local.xM >= -toleranceM &&
    local.yM >= -toleranceM &&
    local.xM <= device.widthM + toleranceM &&
    local.yM <= device.heightM + toleranceM
  );
}

/** The device a cable end dropped at `world` plugs into: the nearest centre among those it lands on, or `null`. */
export function findDeviceAt(
  devices: readonly DeviceObject[],
  world: PointM,
  excludeId?: string,
): DeviceObject | null {
  let best: DeviceObject | null = null;
  let bestDistance = Infinity;
  for (const device of devices) {
    if (device.id === excludeId) continue;
    if (!deviceContains(device, world, PLUG_TOLERANCE_M)) continue;
    const center = deviceCenterWorld(device);
    const distance = Math.hypot(center.xM - world.xM, center.yM - world.yM);
    if (distance < bestDistance) {
      best = device;
      bestDistance = distance;
    }
  }
  return best;
}

// ---------------------------------------------------------------------------
// Keeping cables plugged in
// ---------------------------------------------------------------------------

type End = "fromId" | "toId";

function endIndex(cable: LineObject, end: End): number {
  return end === "fromId" ? 0 : cable.pointsM.length - 1;
}

function endWorld(cable: LineObject, end: End): PointM | null {
  const point = cable.pointsM[endIndex(cable, end)];
  return point ? objectLocalToWorld(cable, point) : null;
}

function samePoint(a: PointM | null, b: PointM | null): boolean {
  if (!a || !b) return a === b;
  return Math.abs(a.xM - b.xM) < 1e-9 && Math.abs(a.yM - b.yM) < 1e-9;
}

/**
 * Brings every cable back into agreement with the devices it names,
 * given the project just before an edit and just after it.
 *
 * Each end is settled by the first rule that applies:
 *
 * 1. **Named on purpose.** The cable is new, or this end's device was
 *    just changed (the panel's picker, a paste): a device that exists is
 *    honoured; a new cable naming nothing — or something gone — is
 *    plugged into whatever its end was drawn on.
 * 2. **The end moved.** The user dragged it, or dragged the cable: it
 *    plugs into the device it now lands on, or comes unplugged.
 * 3. **Otherwise** it stays plugged where it was, and follows the device
 *    if that moved; a device that was deleted leaves it unplugged.
 *
 * A plugged end always sits on the device's centre, and both ends are
 * never the same device — that would collapse the cable to a point.
 * Returns `next` itself when nothing needed to change, so an edit that
 * touches no cable costs one pass and no re-render.
 */
export function reconcileCables(previous: Project | null, next: Project): Project {
  if (previous === next) return next;
  if (!next.objects.some(isCable)) return next;

  const devices = next.objects.filter(isDevice);
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const previousById = new Map(previous?.objects.map((object) => [object.id, object]) ?? []);

  let changed = false;
  const objects = next.objects.map((object) => {
    if (!isCable(object)) return object;
    const before = previousById.get(object.id);
    const previousCable = before && isCable(before) ? before : null;

    let spec: CableSpec = object.electrical;
    let pointsM = object.pointsM;

    for (const end of ["fromId", "toId"] as const) {
      const other = end === "fromId" ? spec.toId : spec.fromId;
      const named = spec[end];
      const here = endWorld({ ...object, pointsM }, end);
      let target: DeviceObject | null;

      if (!previousCable || previousCable.electrical[end] !== named) {
        const existing = named ? deviceById.get(named) : undefined;
        target = existing ?? (!previousCable && here ? findDeviceAt(devices, here, other) : null);
      } else if (!samePoint(endWorld(previousCable, end), here)) {
        target = here ? findDeviceAt(devices, here, other) : null;
      } else {
        target = named ? (deviceById.get(named) ?? null) : null;
      }
      if (target && target.id === other) target = null;

      const targetId = target?.id;
      if (targetId !== spec[end]) {
        const updated: CableSpec = { ...spec };
        if (targetId) updated[end] = targetId;
        else delete updated[end];
        spec = updated;
      }
      if (target) {
        const center = deviceCenterWorld(target);
        if (!samePoint(center, here)) {
          const local = worldToObjectLocal(object, center);
          const index = endIndex(object, end);
          pointsM = pointsM.map((point, i) =>
            i === index ? { xM: local.xM, yM: local.yM } : point,
          );
        }
      }
    }

    if (spec === object.electrical && pointsM === object.pointsM) return object;
    changed = true;
    return { ...object, electrical: spec, pointsM };
  });

  return changed ? { ...next, objects } : next;
}

/**
 * Sizes a freshly-drawn cable for what it feeds, once its ends are
 * plugged in: a cable run to a 63 A three-phase coffret starts as a 5G16
 * on 63 A, not as the 3G2.5 every cable is born as. The downstream end is
 * the one that isn't a source, or the one drawn last when neither is.
 *
 * Only ever applied at creation. Changing a coffret later leaves its
 * cable alone, and the checks say what no longer fits — silently
 * rewiring the plan behind the user's back would be worse than a warning.
 */
export function sizeCableForDevices(project: Project, cableId: string): Project {
  const cable = project.objects.find((object) => object.id === cableId);
  if (!cable || !isCable(cable)) return project;
  const devices = new Map(project.objects.filter(isDevice).map((device) => [device.id, device]));
  const from = cable.electrical.fromId ? devices.get(cable.electrical.fromId) : undefined;
  const to = cable.electrical.toId ? devices.get(cable.electrical.toId) : undefined;
  const downstream =
    to && to.electrical.role !== "source"
      ? to
      : from?.electrical.role !== "source"
        ? from
        : undefined;
  if (!downstream) return project;

  const spec = downstream.electrical;
  let phases: Phases;
  let ratingA: number;
  switch (spec.role) {
    case "board":
      ({ phases, ratingA } = spec);
      break;
    case "strip":
      ({ phases, ratingA } = spec);
      break;
    case "load":
      // The socket it would take if listed on the coffret (KL-048): a
      // drawn load and a listed one plug into the same thing.
      ({ phases, ratingA } = directLoadSocket(spec));
      break;
    default:
      return project;
  }
  const sectionMm2 = minSectionForRatingMm2(ratingA) ?? cable.electrical.sectionMm2;
  const electrical: CableSpec = { ...cable.electrical, phases, ratingA, sectionMm2 };
  return {
    ...project,
    objects: project.objects.map((object) =>
      object.id === cableId
        ? { ...cable, electrical, style: { ...cable.style, ...cableStyle(phases) } }
        : object,
    ),
  };
}

/**
 * Carries connections over to copies: a cable copied together with its
 * devices plugs into the copies, one copied alone comes unplugged rather
 * than reaching back to the originals.
 */
export function remapCableConnections<T extends PlanObject>(
  copies: readonly T[],
  idMap: ReadonlyMap<string, string>,
): T[] {
  return copies.map((copy) => {
    if (copy.electrical?.role !== "cable") return copy;
    const spec: CableSpec = { ...copy.electrical };
    for (const end of ["fromId", "toId"] as const) {
      const mapped = spec[end] ? idMap.get(spec[end]) : undefined;
      if (mapped) spec[end] = mapped;
      else delete spec[end];
    }
    return { ...copy, electrical: spec };
  });
}

// ---------------------------------------------------------------------------
// The network
// ---------------------------------------------------------------------------

export type IssueSeverity = "error" | "warning" | "info";

export interface ElectricalIssue {
  severity: IssueSeverity;
  /** The object the issue is about — what selecting the issue selects. */
  objectId: string;
  message: string;
}

export interface NetworkNode {
  device: DeviceObject;
  /** The cable from the parent, or `null` for a source. */
  feeder: CableObject | null;
  children: NetworkNode[];
  depth: number;
  /** What the device receives: the feeder's phases, or the source's own. */
  supplyPhases: Phases;
  /** Power of every load at or below this device, in watts. */
  loadW: number;
  /** Current through the feeder (or out of the source), in amperes. */
  currentA: number;
  /** Voltage drop from the source to this device, in percent. */
  dropPct: number;
}

export interface CableTotal {
  designation: string;
  phases: Phases;
  sectionMm2: number;
  count: number;
  lengthM: number;
}

export interface ElectricalNetwork {
  /** One tree per source, sources in name order. */
  trees: NetworkNode[];
  /** Devices no source reaches. */
  unfed: DeviceObject[];
  /** Cables not plugged in at both ends. */
  looseCables: CableObject[];
  issues: ElectricalIssue[];
  /** Cable to buy, by designation, thinnest first. */
  cableTotals: CableTotal[];
  totalLoadW: number;
  /** True when the plan has any electrical object at all. */
  isEmpty: boolean;
}

const byName = (a: { name: string }, b: { name: string }) =>
  a.name.localeCompare(b.name, "fr", { numeric: true });

/** The supply rating of a device, when it has one. */
function deviceRatingA(spec: DeviceSpec): number | null {
  return spec.role === "load" ? null : spec.ratingA;
}

function requiredPhases(spec: DeviceSpec): Phases | null {
  if (spec.role === "board" || spec.role === "load" || spec.role === "strip") return spec.phases;
  return null;
}

/** What is wrong with plugging the other kind of plug into a strip whose sockets are `strip`. */
function stripSocketMismatch(strip: Phases): string {
  return strip === "mono"
    ? "une multiprise monophasée ne délivre que du monophasé."
    : "une multiprise triphasée n'a que des prises triphasées.";
}

/** Reads the plan's electrical network and everything worth saying about it. */
export function analyzeNetwork(project: Pick<Project, "objects">): ElectricalNetwork {
  const devices = project.objects.filter(isDevice);
  const cables = project.objects.filter(isCable);
  const deviceById = new Map(devices.map((device) => [device.id, device]));
  const issues: ElectricalIssue[] = [];
  const issue = (severity: IssueSeverity, objectId: string, message: string) =>
    issues.push({ severity, objectId, message });

  // Every cable is checked on its own merits, plugged in or not.
  for (const cable of cables) {
    const spec = cable.electrical;
    const allowed = maxRatingForSectionA(spec.sectionMm2);
    if (allowed < spec.ratingA) {
      const minimum = minSectionForRatingMm2(spec.ratingA);
      issue(
        "error",
        cable.id,
        `Section ${formatMeters(spec.sectionMm2)} mm² insuffisante pour ${formatMeters(spec.ratingA)} A` +
          (minimum ? ` (${formatMeters(minimum)} mm² minimum).` : "."),
      );
    }
  }

  const adjacency = new Map<string, { cable: CableObject; otherId: string }[]>();
  const looseCables: CableObject[] = [];
  for (const cable of cables) {
    const { fromId, toId } = cable.electrical;
    if (!fromId || !toId || !deviceById.has(fromId) || !deviceById.has(toId) || fromId === toId) {
      looseCables.push(cable);
      issue("warning", cable.id, "Câble non raccordé à ses deux extrémités.");
      continue;
    }
    for (const [a, b] of [
      [fromId, toId],
      [toId, fromId],
    ] as const) {
      const list = adjacency.get(a) ?? [];
      list.push({ cable, otherId: b });
      adjacency.set(a, list);
    }
  }

  const visited = new Set<string>();
  const usedCables = new Set<string>();

  const build = (
    device: DeviceObject,
    feeder: CableObject | null,
    depth: number,
    supplyPhases: Phases,
  ): NetworkNode => {
    visited.add(device.id);
    const node: NetworkNode = {
      device,
      feeder,
      children: [],
      depth,
      supplyPhases,
      loadW: 0,
      currentA: 0,
      dropPct: 0,
    };
    const links = [...(adjacency.get(device.id) ?? [])].sort((a, b) =>
      byName(deviceById.get(a.otherId)!, deviceById.get(b.otherId)!),
    );
    for (const { cable, otherId } of links) {
      if (usedCables.has(cable.id)) continue;
      usedCables.add(cable.id);
      const other = deviceById.get(otherId)!;
      // Visited first: a cable leading back up to its own source is a
      // loop, not a second source.
      if (visited.has(otherId)) {
        issue(
          "error",
          cable.id,
          `Boucle : ${device.name} et ${other.name} sont déjà reliés par ailleurs.`,
        );
        continue;
      }
      if (other.electrical.role === "source") {
        issue("error", cable.id, `Relie deux alimentations (${device.name} et ${other.name}).`);
        continue;
      }
      node.children.push(build(other, cable, depth + 1, cable.electrical.phases));
    }
    return node;
  };

  const trees = devices
    .filter((device) => device.electrical.role === "source")
    .sort(byName)
    .map((source) => build(source, null, 0, (source.electrical as SourceSpec).phases));

  // Power and current flow up from the leaves; voltage drop flows down.
  const settleLoads = (node: NetworkNode): number => {
    const own =
      node.device.electrical.role === "load"
        ? node.device.electrical.powerW
        : directLoadsW(node.device.electrical);
    node.loadW = own + node.children.reduce((sum, child) => sum + settleLoads(child), 0);
    node.currentA = currentForPowerA(node.loadW, node.supplyPhases);
    return node.loadW;
  };
  const settleDrops = (node: NetworkNode, upstreamPct: number) => {
    node.dropPct = node.feeder
      ? upstreamPct +
        voltageDropPct(
          node.feeder.electrical.phases,
          cableLengthM(node.feeder),
          node.currentA,
          node.feeder.electrical.sectionMm2,
        )
      : 0;
    for (const child of node.children) settleDrops(child, node.dropPct);
  };
  for (const tree of trees) {
    settleLoads(tree);
    settleDrops(tree, 0);
  }

  const checkNode = (node: NetworkNode, parent: NetworkNode | null) => {
    const spec = node.device.electrical;
    const rating = deviceRatingA(spec);
    const feeder = node.feeder;

    if (feeder && parent) {
      const cable = feeder.electrical;
      const parentSpec = parent.device.electrical;
      if (cable.phases === "tri" && parent.supplyPhases === "mono") {
        issue(
          "error",
          feeder.id,
          `Câble triphasé sur ${parent.device.name}, qui n'est alimenté qu'en monophasé.`,
        );
      }
      if (parentSpec.role === "strip" && cable.phases !== parentSpec.phases) {
        const mismatch = stripSocketMismatch(parentSpec.phases);
        issue("error", feeder.id, mismatch.charAt(0).toUpperCase() + mismatch.slice(1));
      }
      const parentRating = deviceRatingA(parentSpec);
      if (parentRating !== null && cable.ratingA > parentRating) {
        issue(
          "warning",
          feeder.id,
          `Départ ${formatMeters(cable.ratingA)} A sur ${parent.device.name}, protégé à ${formatMeters(parentRating)} A.`,
        );
      }
      if (node.currentA > cable.ratingA + 1e-9) {
        issue(
          "error",
          feeder.id,
          `Surcharge : ${formatCurrentA(node.currentA)} pour un départ ${formatMeters(cable.ratingA)} A.`,
        );
      }
      const needed = requiredPhases(spec);
      if (needed === "tri" && cable.phases === "mono") {
        issue(
          "error",
          node.device.id,
          `${node.device.name} est triphasé mais alimenté en monophasé.`,
        );
      }
      if (spec.role === "strip" && spec.phases === "mono" && cable.phases === "tri") {
        issue(
          "error",
          node.device.id,
          "Une multiprise monophasée se branche sur un départ monophasé.",
        );
      }
    }

    if (rating !== null && node.currentA > rating + 1e-9) {
      issue(
        "error",
        node.device.id,
        `Surcharge : ${formatCurrentA(node.currentA)} pour ${formatMeters(rating)} A disponibles.`,
      );
    }
    if (node.dropPct > MAX_VOLTAGE_DROP_PCT) {
      issue(
        "warning",
        node.device.id,
        `Chute de tension ${formatMeters(Math.round(node.dropPct * 10) / 10)} % (limite ${MAX_VOLTAGE_DROP_PCT} %).`,
      );
    }

    const outgoing = node.children.flatMap((child) => (child.feeder ? [child.feeder] : []));
    // Listed consumers take sockets like drawn cables do (KL-048).
    const listed = directLoadsOf(spec);
    const listedCount = listed.reduce((sum, load) => sum + load.quantity, 0);
    for (const load of listed) {
      if (spec.role === "strip" && load.phases !== spec.phases) {
        issue("error", node.device.id, `${load.name} : ${stripSocketMismatch(spec.phases)}`);
      } else if (load.phases === "tri" && node.supplyPhases === "mono") {
        issue(
          "error",
          node.device.id,
          `${load.name} est triphasé mais ${node.device.name} n'est alimenté qu'en monophasé.`,
        );
      }
    }
    const sockets = [
      ...outgoing.map((cable) => ({
        phases: cable.electrical.phases,
        ratingA: cable.electrical.ratingA,
        count: 1,
      })),
      ...listed.map((load) => ({ ...directLoadSocket(load), count: load.quantity })),
    ];
    if (spec.role === "board") {
      if (spec.outputs.length > 0) {
        const groups = new Map<string, { phases: Phases; ratingA: number; used: number }>();
        for (const socket of sockets) {
          const key = `${socket.phases}/${socket.ratingA}`;
          const group = groups.get(key) ?? {
            phases: socket.phases,
            ratingA: socket.ratingA,
            used: 0,
          };
          group.used += socket.count;
          groups.set(key, group);
        }
        for (const group of groups.values()) {
          const available = spec.outputs
            .filter((output) => output.phases === group.phases && output.ratingA === group.ratingA)
            .reduce((sum, output) => sum + output.count, 0);
          if (group.used > available) {
            issue(
              "warning",
              node.device.id,
              `${group.used} départ(s) ${formatMeters(group.ratingA)} A ${PHASE_LABELS[group.phases]} pour ${available} prise(s).`,
            );
          }
        }
      }
      const needsRcd = sockets.some((socket) => socket.ratingA <= RCD_REQUIRED_UP_TO_A);
      if (needsRcd && !(spec.rcdMa !== undefined && spec.rcdMa <= 30)) {
        issue(
          "warning",
          node.device.id,
          `Pas de différentiel 30 mA : obligatoire pour les prises jusqu'à ${RCD_REQUIRED_UP_TO_A} A accessibles au public.`,
        );
      }
    }
    if (spec.role === "strip" && outgoing.length + listedCount > spec.outlets) {
      issue(
        "warning",
        node.device.id,
        `${outgoing.length + listedCount} branchements pour ${spec.outlets} prises.`,
      );
    }

    for (const child of node.children) checkNode(child, node);
  };
  for (const tree of trees) checkNode(tree, null);

  const unfed = devices
    .filter((device) => !visited.has(device.id) && device.electrical.role !== "source")
    .sort(byName);
  for (const device of unfed)
    issue("info", device.id, "Non alimenté : aucun câble ne le relie à une alimentation.");

  const totals = new Map<string, CableTotal>();
  for (const cable of cables) {
    const designation = cableDesignation(cable.electrical);
    const total = totals.get(designation) ?? {
      designation,
      phases: cable.electrical.phases,
      sectionMm2: cable.electrical.sectionMm2,
      count: 0,
      lengthM: 0,
    };
    total.count += 1;
    total.lengthM += cableLengthM(cable);
    totals.set(designation, total);
  }

  const severityRank: Record<IssueSeverity, number> = { error: 0, warning: 1, info: 2 };
  issues.sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    trees,
    unfed,
    looseCables,
    issues,
    cableTotals: [...totals.values()].sort(
      (a, b) => a.sectionMm2 - b.sectionMm2 || a.phases.localeCompare(b.phases),
    ),
    totalLoadW: trees.reduce((sum, tree) => sum + tree.loadW, 0),
    isEmpty: devices.length === 0 && cables.length === 0,
  };
}

/** Every node of the network, depth first, sources in order. */
export function flattenNetwork(trees: readonly NetworkNode[]): NetworkNode[] {
  const out: NetworkNode[] = [];
  const walk = (node: NetworkNode) => {
    out.push(node);
    for (const child of node.children) walk(child);
  };
  for (const tree of trees) walk(tree);
  return out;
}
