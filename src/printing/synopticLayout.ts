import {
  ELECTRICAL_ROLE_LABELS,
  cableDesignation,
  cableLengthM,
  electricalSummary,
  formatCurrentA,
  formatPowerW,
  ratingPowerKva,
  type DeviceRole,
  type ElectricalIssue,
  type ElectricalNetwork,
  type IssueSeverity,
  type NetworkNode,
} from "../domain/electrical";
import { formatMeters } from "../domain/labels";

/**
 * The single-line diagram of a plan's electrical network (KL-046), laid
 * out once in millimetres and drawn twice: as SVG in the dialog and as
 * vector paths in the PDF. One layout, so the two cannot disagree about
 * where a box is or what it says — the lesson of KL-042, applied from
 * the start.
 *
 * Left to right, one column per level: the source, then what it feeds,
 * then what those feed. Leaves take one row each and a parent sits
 * centred on its children, which is the classic tidy tree and reads the
 * way an electrician reads a unifilaire — power flows to the right.
 *
 * Nothing here knows about pixels, SVG or PDF; text widths are estimated
 * from the font size, since neither target will say how wide a word is
 * before it is drawn.
 */

export const BOX_WIDTH_MM = 56;
/** Room between columns, where each cable's designation is written. */
export const COLUMN_GAP_MM = 36;
export const ROW_GAP_MM = 4;
/** Where the cable leaves the parent before turning towards its child. */
const ELBOW_MM = 5;
export const TITLE_SIZE_PT = 7.5;
export const LINE_SIZE_PT = 6.2;
export const EDGE_LABEL_SIZE_PT = 5.8;
const PT_TO_MM = 25.4 / 72;
const PADDING_MM = 2;
const LINE_STEP_MM = LINE_SIZE_PT * PT_TO_MM * 1.3;
const TITLE_STEP_MM = TITLE_SIZE_PT * PT_TO_MM * 1.35;

export interface SynopticBox {
  objectId: string;
  role: DeviceRole;
  /** Top-left corner, mm, y downward. */
  xMm: number;
  yMm: number;
  widthMm: number;
  heightMm: number;
  title: string;
  lines: string[];
  /** The worst thing said about the device or the cable that feeds it. */
  severity: IssueSeverity | null;
}

export interface SynopticEdge {
  cableId: string;
  /** Orthogonal polyline from the parent's right edge to the child's left edge. */
  pointsMm: [number, number][];
  label: string;
  /** Baseline of the label, just above the last horizontal run. */
  labelXMm: number;
  labelYMm: number;
  severity: IssueSeverity | null;
}

export interface SynopticHeading {
  text: string;
  xMm: number;
  yMm: number;
}

export interface SynopticLayout {
  widthMm: number;
  heightMm: number;
  boxes: SynopticBox[];
  edges: SynopticEdge[];
  headings: SynopticHeading[];
}

/**
 * The worst thing said about any of `ids`. `analyzeNetwork` sorts its
 * issues errors first, so the first match is the worst one.
 */
function worst(issues: readonly ElectricalIssue[], ids: readonly string[]): IssueSeverity | null {
  return issues.find((issue) => ids.includes(issue.objectId))?.severity ?? null;
}

function round1(value: number): string {
  return formatMeters(Math.round(value * 10) / 10);
}

/** What a device's box says under its name. Only characters the PDF's fonts can print. */
export function boxLines(node: NetworkNode): string[] {
  const spec = node.device.electrical;
  const lines = [electricalSummary(node.device) ?? ELECTRICAL_ROLE_LABELS[spec.role]];
  if (spec.role === "source") {
    lines.push(
      `Charge ${formatPowerW(node.loadW)} · ${formatCurrentA(node.currentA)} / ${round1(
        ratingPowerKva(spec.ratingA, spec.phases),
      )} kVA`,
    );
  } else if (spec.role === "load") {
    lines.push(`${formatCurrentA(node.currentA)} · chute ${round1(node.dropPct)} %`);
  } else {
    lines.push(
      `${formatPowerW(node.loadW)} · ${formatCurrentA(node.currentA)} · chute ${round1(node.dropPct)} %`,
    );
  }
  return lines;
}

/** What is written along a cable: designation, protection, laid length. */
export function edgeLabel(cable: NonNullable<NetworkNode["feeder"]>): string {
  return `${cableDesignation(cable.electrical)} · ${formatMeters(cable.electrical.ratingA)} A · ${round1(
    cableLengthM(cable),
  )} m`;
}

function boxHeight(lineCount: number): number {
  return PADDING_MM * 2 + TITLE_STEP_MM + lineCount * LINE_STEP_MM;
}

export function layoutSynoptic(network: ElectricalNetwork): SynopticLayout {
  const boxes: SynopticBox[] = [];
  const edges: SynopticEdge[] = [];
  const headings: SynopticHeading[] = [];
  const columnX = (depth: number) => depth * (BOX_WIDTH_MM + COLUMN_GAP_MM);
  let cursorY = 0;
  let maxDepth = 0;

  /** Places `node` and its subtree from `cursorY` down; returns its box. */
  const place = (node: NetworkNode): SynopticBox => {
    maxDepth = Math.max(maxDepth, node.depth);
    const lines = boxLines(node);
    const heightMm = boxHeight(lines.length);
    const children = node.children.map(place);
    let yMm: number;
    if (children.length === 0) {
      yMm = cursorY;
      cursorY += heightMm + ROW_GAP_MM;
    } else {
      const first = children[0]!;
      const last = children.at(-1)!;
      const middle = (first.yMm + first.heightMm / 2 + last.yMm + last.heightMm / 2) / 2;
      yMm = middle - heightMm / 2;
    }
    const box: SynopticBox = {
      objectId: node.device.id,
      role: node.device.electrical.role,
      xMm: columnX(node.depth),
      yMm,
      widthMm: BOX_WIDTH_MM,
      heightMm,
      title: node.device.name,
      lines,
      severity: worst(network.issues, [node.device.id, ...(node.feeder ? [node.feeder.id] : [])]),
    };
    boxes.push(box);

    const startX = box.xMm + box.widthMm;
    const startY = box.yMm + box.heightMm / 2;
    node.children.forEach((child, index) => {
      const target = children[index]!;
      const cable = child.feeder!;
      const endY = target.yMm + target.heightMm / 2;
      const elbowX = startX + ELBOW_MM;
      edges.push({
        cableId: cable.id,
        pointsMm: [
          [startX, startY],
          [elbowX, startY],
          [elbowX, endY],
          [target.xMm, endY],
        ],
        label: edgeLabel(cable),
        labelXMm: elbowX + 1.5,
        labelYMm: endY - 1.2,
        severity: worst(network.issues, [cable.id]),
      });
    });
    return box;
  };

  for (const tree of network.trees) {
    place(tree);
    // A little more air between two installations than between two leaves.
    cursorY += ROW_GAP_MM * 2;
  }

  if (network.unfed.length > 0) {
    headings.push({ text: "Non alimentés", xMm: 0, yMm: cursorY + TITLE_STEP_MM });
    cursorY += TITLE_STEP_MM + ROW_GAP_MM;
    network.unfed.forEach((device, index) => {
      const node: NetworkNode = {
        device,
        feeder: null,
        children: [],
        depth: 0,
        supplyPhases: "mono",
        loadW: device.electrical.role === "load" ? device.electrical.powerW : 0,
        currentA: 0,
        dropPct: 0,
      };
      const lines = [electricalSummary(device) ?? ELECTRICAL_ROLE_LABELS[device.electrical.role]];
      const heightMm = boxHeight(lines.length);
      // Side by side, several to a row: they have no tree to hang from,
      // and a column of them would make the diagram needlessly tall.
      const perRow = Math.max(1, maxDepth + 1);
      const column = index % perRow;
      if (index > 0 && column === 0) cursorY += heightMm + ROW_GAP_MM;
      boxes.push({
        objectId: node.device.id,
        role: device.electrical.role,
        xMm: columnX(column),
        yMm: cursorY,
        widthMm: BOX_WIDTH_MM,
        heightMm,
        title: device.name,
        lines,
        severity: worst(network.issues, [device.id]),
      });
    });
    cursorY += boxHeight(1) + ROW_GAP_MM;
  }

  const right = Math.max(0, ...boxes.map((box) => box.xMm + box.widthMm));
  const bottom = Math.max(0, ...boxes.map((box) => box.yMm + box.heightMm));
  return { widthMm: right, heightMm: bottom, boxes, edges, headings };
}

/** Fill colour of a box, by role — the same family as on the plan. */
export const ROLE_FILLS: Record<DeviceRole, string> = {
  source: "#fde68a",
  board: "#fef9c3",
  strip: "#e0f2fe",
  load: "#f3e8ff",
};

/** Outline colour by what is said about it. */
export function severityStroke(severity: IssueSeverity | null): string {
  if (severity === "error") return "#dc2626";
  if (severity === "warning") return "#d97706";
  return "#334155";
}

export const TYPE_METRICS = { PT_TO_MM, PADDING_MM, LINE_STEP_MM, TITLE_STEP_MM };
