import { buildSchedule, scheduleToCsv } from "../../domain/catalog";
import type { PlanObject, Project } from "../../domain/types";
import { buildSchedulePdf } from "../../printing/schedulePdf";

interface ScheduleDialogProps { project: Project; objects: readonly PlanObject[]; onClose: () => void }

function safeName(name: string) { return (name.trim() || "projet").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-|-$/g, "").toLowerCase(); }

function downloadBlob(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

export function ScheduleDialog({ project, objects, onClose }: ScheduleDialogProps) {
  const rows = buildSchedule(objects, project.layers);
  const download = () => {
    const blob = new Blob(["\ufeff", scheduleToCsv(rows)], { type: "text/csv;charset=utf-8" });
    downloadBlob(blob, `${safeName(project.name)}-nomenclature.csv`);
  };
  const downloadPdf = () => {
    const bytes = buildSchedulePdf(rows, project.name, new Date());
    downloadBlob(new Blob([bytes as BlobPart], { type: "application/pdf" }), `${safeName(project.name)}-nomenclature.pdf`);
  };
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="dialog schedule-dialog" role="dialog" aria-modal="true" aria-labelledby="schedule-title" onMouseDown={(event) => event.stopPropagation()}>
        <div className="dialog__header"><h2 id="schedule-title">Nomenclature</h2><button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">✕</button></div>
        {rows.length === 0 ? <p>Le plan ne contient encore aucun élément.</p> : (
          <div className="schedule-dialog__table-wrap"><table><thead><tr><th>Calque</th><th>Catégorie</th><th>Référence</th><th>Désignation</th><th>Qté</th><th>Unité</th></tr></thead><tbody>
            {rows.map((row) => <tr key={`${row.layer}-${row.category}-${row.reference}-${row.name}`}><td>{row.layer}</td><td>{row.category}</td><td>{row.reference}</td><td>{row.name}</td><td>{row.quantity.toLocaleString("fr-FR", { maximumFractionDigits: 2 })}</td><td>{row.unit}</td></tr>)}
          </tbody><tfoot><tr><th colSpan={6}>{rows.length} ligne(s) de nomenclature</th></tr></tfoot></table></div>
        )}
        <div className="dialog__actions"><button type="button" onClick={onClose}>Fermer</button><button type="button" onClick={download} disabled={rows.length === 0}>Exporter CSV</button><button type="button" className="dialog__primary" onClick={downloadPdf} disabled={rows.length === 0}>Exporter PDF</button></div>
      </section>
    </div>
  );
}
