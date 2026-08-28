import type { ScheduleRow } from "../domain/catalog";
import { buildPdf, mmToPt, toPdfDate } from "./pdf";
import type { PdfLineItem, PdfTextItem } from "./pdf";

/** Builds a compact, searchable A4-landscape equipment schedule. */
export function buildSchedulePdf(rows: readonly ScheduleRow[], projectName: string, now: Date): Uint8Array {
  const widthPt = mmToPt(297);
  const heightPt = mmToPt(210);
  const margin = mmToPt(10);
  const top = heightPt - margin;
  const availableHeight = heightPt - margin * 2 - 28;
  const rowHeight = Math.max(4.2, Math.min(12, availableHeight / Math.max(1, rows.length + 1)));
  const fontSize = Math.max(3.8, Math.min(8, rowHeight * 0.7));
  const columns = [margin, margin + 115, margin + 230, margin + 330, margin + 555, margin + 625];
  const text: PdfTextItem[] = [
    { text: `${projectName} — Nomenclature`, xPt: margin, yPt: top, sizePt: 13 },
    { text: `${rows.length} ligne(s) — ${now.toLocaleDateString("fr-FR")}`, xPt: widthPt - 145, yPt: top, sizePt: 7 },
  ];
  const headerY = top - 22;
  ["Calque", "Catégorie", "Référence", "Désignation", "Qté", "Unité"].forEach((label, index) => {
    text.push({ text: label, xPt: columns[index] ?? margin, yPt: headerY, sizePt: fontSize + 0.8 });
  });
  rows.forEach((row, index) => {
    const y = headerY - (index + 1) * rowHeight;
    const values = [row.layer, row.category, row.reference, row.name, row.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 2 }), row.unit];
    values.forEach((value, column) => text.push({ text: String(value), xPt: columns[column] ?? margin, yPt: y, sizePt: fontSize }));
  });
  const lines: PdfLineItem[] = [
    { fromPt: [margin, headerY - 3], toPt: [widthPt - margin, headerY - 3], widthPt: 0.6 },
  ];
  return buildPdf(
    { widthPt, heightPt, text, lines },
    { title: `${projectName} — Nomenclature`, creator: "KL — Implantation Événementielle", creationDate: toPdfDate(now) },
  );
}
