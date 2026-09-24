import {
  ELECTRICAL_ROLE_LABELS,
  electricalSummary,
  flattenNetwork,
  formatCurrentA,
  formatPowerW,
  type ElectricalNetwork,
  type IssueSeverity,
} from "../domain/electrical";
import { formatMeters } from "../domain/labels";
import { buildMultiPagePdf, mmToPt, toPdfDate } from "./pdf";
import type { PdfLineItem, PdfPage, PdfPathItem, PdfTextItem } from "./pdf";
import {
  EDGE_LABEL_SIZE_PT,
  LINE_SIZE_PT,
  ROLE_FILLS,
  TITLE_SIZE_PT,
  TYPE_METRICS,
  edgeLabel,
  layoutSynoptic,
  severityStroke,
  type SynopticLayout,
} from "./synopticLayout";

/**
 * The electrical diagram as a PDF (KL-046): the single-line diagram on
 * the first page, then the balance, the cable to buy and the alerts.
 *
 * Vector throughout, through the same minimal writer as the plan: the
 * diagram is boxes, lines and words, and a raster of it would blur the
 * one thing an electrician reads it for — the ratings.
 */

const MARGIN_MM = 12;
const HEADER_MM = 14;
const FOOTER_MM = 8;

export const SYNOPTIC_DISCLAIMER =
  "Aide au pré-dimensionnement (H07RN-F, cos phi 0,9, chute résistive) : ne remplace pas une note de calcul NF C 15-100 ni la vérification d'un électricien qualifié.";

type Paper = { name: "A4" | "A3"; widthMm: number; heightMm: number };
const PAPERS: readonly Paper[] = [
  { name: "A4", widthMm: 297, heightMm: 210 },
  { name: "A3", widthMm: 420, heightMm: 297 },
];

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Helvetica averages about half an em per character; enough to keep a cell from spilling. */
function fit(text: string, widthPt: number, sizePt: number): string {
  const max = Math.max(1, Math.floor(widthPt / (sizePt * 0.52)));
  return text.length <= max ? text : `${text.slice(0, Math.max(1, max - 1))}…`;
}

function drawingArea(paper: Paper) {
  return {
    widthMm: paper.widthMm - MARGIN_MM * 2,
    heightMm: paper.heightMm - MARGIN_MM * 2 - HEADER_MM - FOOTER_MM,
  };
}

/**
 * The paper and scale the diagram is printed at: A4 when it fits there
 * at a readable size, A3 otherwise, and never enlarged — a two-box
 * diagram blown up to fill a page reads as a poster, not a plan.
 */
export function chooseSynopticPaper(layout: Pick<SynopticLayout, "widthMm" | "heightMm">): {
  paper: Paper;
  scale: number;
} {
  const scaleOn = (paper: Paper) => {
    const area = drawingArea(paper);
    return Math.min(
      1,
      area.widthMm / Math.max(1, layout.widthMm),
      area.heightMm / Math.max(1, layout.heightMm),
    );
  };
  const a4 = PAPERS[0]!;
  const a3 = PAPERS[1]!;
  const onA4 = scaleOn(a4);
  if (onA4 >= 0.8) return { paper: a4, scale: onA4 };
  return { paper: a3, scale: scaleOn(a3) };
}

function header(paper: Paper, title: string, subtitle: string): PdfTextItem[] {
  const top = mmToPt(paper.heightMm - MARGIN_MM) - 11;
  return [
    { text: title, xPt: mmToPt(MARGIN_MM), yPt: top, sizePt: 13 },
    { text: subtitle, xPt: mmToPt(MARGIN_MM), yPt: top - 13, sizePt: 8 },
  ];
}

function footer(paper: Paper, pageLabel: string): PdfTextItem[] {
  return [
    {
      text: fit(SYNOPTIC_DISCLAIMER, mmToPt(paper.widthMm - MARGIN_MM * 2 - 25), 6),
      xPt: mmToPt(MARGIN_MM),
      yPt: mmToPt(MARGIN_MM) - 2,
      sizePt: 6,
    },
    {
      text: pageLabel,
      xPt: mmToPt(paper.widthMm - MARGIN_MM) - 30,
      yPt: mmToPt(MARGIN_MM) - 2,
      sizePt: 7,
    },
  ];
}

/** The diagram page. Exported for tests, which read its content stream back. */
export function buildDiagramPage(
  layout: SynopticLayout,
  paper: Paper,
  scale: number,
  title: string,
  subtitle: string,
): PdfPage {
  const originX = MARGIN_MM;
  const originTop = MARGIN_MM + HEADER_MM;
  const x = (mm: number) => mmToPt(originX + mm * scale);
  const y = (mm: number) => mmToPt(paper.heightMm - originTop - mm * scale);
  const size = (pt: number) => Math.max(3.5, pt * scale);
  const paths: PdfPathItem[] = [];
  const text: PdfTextItem[] = [...header(paper, title, subtitle)];

  for (const edge of layout.edges) {
    const [first, ...rest] = edge.pointsMm;
    if (!first) continue;
    paths.push({
      commands: `${x(first[0])} ${y(first[1])} m ${rest.map(([px, py]) => `${x(px)} ${y(py)} l`).join(" ")}`,
      strokeRgb: rgb(severityStroke(edge.severity)),
      widthPt: edge.severity === "error" ? 1.2 : 0.7,
    });
    text.push({
      text: edge.label,
      xPt: x(edge.labelXMm),
      yPt: y(edge.labelYMm),
      sizePt: size(EDGE_LABEL_SIZE_PT),
    });
  }

  const { PADDING_MM, TITLE_STEP_MM, LINE_STEP_MM } = TYPE_METRICS;
  for (const box of layout.boxes) {
    paths.push({
      commands: `${x(box.xMm)} ${y(box.yMm + box.heightMm)} ${mmToPt(box.widthMm * scale)} ${mmToPt(
        box.heightMm * scale,
      )} re`,
      fillRgb: rgb(ROLE_FILLS[box.role]),
      strokeRgb: rgb(severityStroke(box.severity)),
      widthPt: box.severity === "error" ? 1.4 : 0.8,
    });
    const innerWidthPt = mmToPt((box.widthMm - PADDING_MM * 2) * scale);
    text.push({
      text: fit(box.title, innerWidthPt, size(TITLE_SIZE_PT)),
      xPt: x(box.xMm + PADDING_MM),
      yPt: y(box.yMm + PADDING_MM + TITLE_STEP_MM * 0.8),
      sizePt: size(TITLE_SIZE_PT),
    });
    box.lines.forEach((line, index) => {
      text.push({
        text: fit(line, innerWidthPt, size(LINE_SIZE_PT)),
        xPt: x(box.xMm + PADDING_MM),
        yPt: y(box.yMm + PADDING_MM + TITLE_STEP_MM + LINE_STEP_MM * (index + 0.8)),
        sizePt: size(LINE_SIZE_PT),
      });
    });
  }

  for (const heading of layout.headings) {
    text.push({ text: heading.text, xPt: x(heading.xMm), yPt: y(heading.yMm), sizePt: size(8) });
  }

  return { widthPt: mmToPt(paper.widthMm), heightPt: mmToPt(paper.heightMm), paths, text };
}

const SEVERITY_LABELS: Record<IssueSeverity, string> = {
  error: "ERREUR",
  warning: "Attention",
  info: "Info",
};

interface TableRow {
  cells: string[];
  /** Section titles are set larger and ruled underneath. */
  heading?: boolean;
}

/** The balance, the cable totals and the alerts, as rows ready to paginate. */
export function reportRows(network: ElectricalNetwork, names: ReadonlyMap<string, string>) {
  const rows: TableRow[] = [];
  rows.push({ heading: true, cells: ["Bilan par équipement"] });
  rows.push({
    cells: [
      "Équipement",
      "Rôle",
      "Caractéristiques",
      "Alimenté par",
      "Puissance",
      "Courant",
      "Chute",
    ],
    heading: false,
  });
  for (const node of flattenNetwork(network.trees)) {
    rows.push({
      cells: [
        `${"  ".repeat(node.depth)}${node.device.name}`,
        ELECTRICAL_ROLE_LABELS[node.device.electrical.role],
        electricalSummary(node.device) ?? "",
        node.feeder ? edgeLabel(node.feeder) : "—",
        formatPowerW(node.loadW),
        formatCurrentA(node.currentA),
        `${formatMeters(Math.round(node.dropPct * 10) / 10)} %`,
      ],
    });
  }
  for (const device of network.unfed) {
    rows.push({
      cells: [
        device.name,
        ELECTRICAL_ROLE_LABELS[device.electrical.role],
        electricalSummary(device) ?? "",
        "non alimenté",
        "",
        "",
        "",
      ],
    });
  }

  rows.push({ heading: true, cells: ["Câbles"] });
  rows.push({ cells: ["Désignation", "Nombre", "Longueur totale"] });
  for (const total of network.cableTotals) {
    rows.push({
      cells: [
        `H07RN-F ${total.designation}`,
        String(total.count),
        `${formatMeters(Math.round(total.lengthM * 10) / 10)} m`,
      ],
    });
  }

  rows.push({ heading: true, cells: [`Alertes (${network.issues.length})`] });
  if (network.issues.length === 0) rows.push({ cells: ["Aucune."] });
  for (const issue of network.issues) {
    rows.push({
      cells: [SEVERITY_LABELS[issue.severity], names.get(issue.objectId) ?? "", issue.message],
    });
  }
  return rows;
}

/** Column starts, in mm from the margin, per table: the balance is wide, the others short. */
const COLUMNS: Record<number, number[]> = {
  7: [0, 58, 82, 130, 180, 205, 228],
  3: [0, 45, 90],
};

function tablePages(rows: readonly TableRow[], paper: Paper, title: string, subtitle: string) {
  const pages: { text: PdfTextItem[]; lines: PdfLineItem[] }[] = [];
  const rowMm = 4.4;
  const top = MARGIN_MM + HEADER_MM;
  const bottom = paper.heightMm - MARGIN_MM - FOOTER_MM;
  let current: { text: PdfTextItem[]; lines: PdfLineItem[] } | null = null;
  let cursor = top;
  let columns = COLUMNS[7]!;

  const newPage = () => {
    current = { text: header(paper, title, subtitle), lines: [] };
    pages.push(current);
    cursor = top;
  };
  newPage();

  for (const row of rows) {
    const needed = row.heading ? rowMm * 2 : rowMm;
    if (cursor + needed > bottom) newPage();
    const page = current!;
    if (row.heading) {
      cursor += rowMm * 0.8;
      page.text.push({
        text: row.cells[0] ?? "",
        xPt: mmToPt(MARGIN_MM),
        yPt: mmToPt(paper.heightMm - cursor),
        sizePt: 10,
      });
      page.lines.push({
        fromPt: [mmToPt(MARGIN_MM), mmToPt(paper.heightMm - cursor - 1.2)],
        toPt: [mmToPt(paper.widthMm - MARGIN_MM), mmToPt(paper.heightMm - cursor - 1.2)],
        widthPt: 0.5,
      });
      cursor += rowMm;
      continue;
    }
    columns = row.cells.length === 7 ? COLUMNS[7]! : COLUMNS[3]!;
    // The alerts' last column is a sentence: it takes all the room left.
    const widths = columns.map(
      (start, index) => (columns[index + 1] ?? paper.widthMm - MARGIN_MM * 2) - start - 2,
    );
    row.cells.forEach((cell, index) => {
      page.text.push({
        text: fit(cell, mmToPt(widths[index] ?? 20), 7),
        xPt: mmToPt(MARGIN_MM + (columns[index] ?? 0)),
        yPt: mmToPt(paper.heightMm - cursor),
        sizePt: 7,
      });
    });
    cursor += rowMm;
  }
  return pages;
}

export function buildSynopticPdf(
  network: ElectricalNetwork,
  projectName: string,
  now: Date,
): Uint8Array {
  const layout = layoutSynoptic(network);
  const { paper, scale } = chooseSynopticPaper(layout);
  const title = `${projectName} — Schéma électrique unifilaire`;
  const subtitle = `${now.toLocaleDateString("fr-FR")} · Puissance installée ${formatPowerW(
    network.totalLoadW,
  )} · ${network.issues.filter((issue) => issue.severity === "error").length} erreur(s), ${
    network.issues.filter((issue) => issue.severity === "warning").length
  } avertissement(s)`;

  const names = new Map<string, string>();
  for (const node of flattenNetwork(network.trees)) {
    names.set(node.device.id, node.device.name);
    // "Câble" alone does not say which one: name it after what it feeds.
    if (node.feeder) names.set(node.feeder.id, `${node.feeder.name} vers ${node.device.name}`);
  }
  for (const device of network.unfed) names.set(device.id, device.name);
  for (const cable of network.looseCables) names.set(cable.id, cable.name);

  const diagram = buildDiagramPage(layout, paper, scale, title, subtitle);
  const a4 = PAPERS[0]!;
  const tables = tablePages(reportRows(network, names), a4, title, subtitle);
  const pages: PdfPage[] = [
    diagram,
    ...tables.map((page) => ({
      widthPt: mmToPt(a4.widthMm),
      heightPt: mmToPt(a4.heightMm),
      text: page.text,
      lines: page.lines,
    })),
  ];
  const total = pages.length;
  pages.forEach((page, index) => {
    const pagePaper = index === 0 ? paper : a4;
    page.text = [...(page.text ?? []), ...footer(pagePaper, `Page ${index + 1}/${total}`)];
  });

  return buildMultiPagePdf(pages, {
    title,
    creator: "Plan Editor",
    creationDate: toPdfDate(now),
  });
}
