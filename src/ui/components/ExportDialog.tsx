import { boundsSizeM } from "../../domain/bounds";
import type { BoundsM } from "../../domain/bounds";
import {
  ORIENTATIONS,
  PAPER_SIZE_ORDER,
  STANDARD_SCALE_DENOMINATORS,
  fitScaleDenominator,
  formatScale,
  getCoveredAreaM,
} from "../../domain/sheets";
import type { Orientation, PaperSize, Sheet } from "../../domain/types";
import type { ReactNode } from "react";

interface ExportDialogProps {
  sheet: Sheet;
  sheets: readonly Sheet[];
  onSelectSheet: (id: string) => void;
  onAddSheet: () => void;
  onDuplicateSheet: () => void;
  onDeleteSheet: () => void;
  preview: ReactNode;
  /** Extent of everything visible, or null for an empty plan. */
  contentBounds: BoundsM | null;
  busy: boolean;
  onChange: (patch: Partial<Sheet>) => void;
  showGrid: boolean;
  onShowGridChange: (showGrid: boolean) => void;
  transparentPng: boolean;
  onTransparentPngChange: (value: boolean) => void;
  onExportPdf: () => void;
  onExportMultiPage: () => void;
  onExportPng: () => void;
  onClose: () => void;
}

function formatMeters(value: number): string {
  return `${value.toFixed(1).replace(/\.0$/, "")} m`;
}

async function fileToJpegDataUrl(file: File): Promise<string> {
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    const scale = Math.min(1, 600 / Math.max(image.naturalWidth, image.naturalHeight));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
    canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Canvas indisponible");
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.9);
  } finally {
    URL.revokeObjectURL(source);
  }
}

/**
 * Choosing how the plan goes on paper.
 *
 * The one thing this dialog works hard at is telling the user whether
 * their plan will actually fit, *before* they export: it compares the
 * ground area the sheet covers at the chosen scale against the plan's real
 * extent, and says so plainly. A silently cropped plan is the failure mode
 * that costs someone a wasted trip to a printer, and it's invisible until
 * the paper comes out.
 *
 * The scale is never adjusted automatically. "Ajuster" is a button the
 * user presses, because a plan whose label says 1:200 must be at 1:200 —
 * quietly changing the scale to make things fit would turn the printed
 * label into a lie, which is worse than a plan that doesn't fit.
 */
export function ExportDialog({
  sheet,
  sheets,
  onSelectSheet,
  onAddSheet,
  onDuplicateSheet,
  onDeleteSheet,
  preview,
  contentBounds,
  busy,
  onChange,
  showGrid,
  onShowGridChange,
  transparentPng,
  onTransparentPngChange,
  onExportPdf,
  onExportMultiPage,
  onExportPng,
  onClose,
}: ExportDialogProps) {
  const covered = getCoveredAreaM(sheet);
  const contentSize = contentBounds ? boundsSizeM(contentBounds) : null;
  const fits =
    contentSize === null || (contentSize.widthM <= covered.widthM && contentSize.heightM <= covered.heightM);
  const suggested = contentSize ? fitScaleDenominator(contentSize, sheet) : null;

  return (
    <div className="calibration-dialog__backdrop">
      <div className="calibration-dialog export-dialog">
        <h2 className="calibration-dialog__title">Exporter le plan</h2>

        {preview}

        <div className="export-dialog__sheets">
          <label className="calibration-dialog__field">
            <span>Feuille</span>
            <select value={sheet.id} onChange={(event) => onSelectSheet(event.target.value)}>
              {sheets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
            </select>
          </label>
          <div className="export-dialog__sheet-actions">
            <button type="button" onClick={onAddSheet}>＋</button>
            <button type="button" onClick={onDuplicateSheet}>⧉</button>
            <button type="button" onClick={onDeleteSheet} disabled={sheets.length <= 1}>🗑</button>
          </div>
        </div>

        <label className="calibration-dialog__field">
          <span>Nom de la feuille</span>
          <input type="text" value={sheet.name} onChange={(event) => onChange({ name: event.target.value })} />
        </label>

        <details className="export-dialog__title-fields">
          <summary>Cartouche</summary>
          <div className="export-dialog__title-grid">
            {([
              ["client", "Client"],
              ["author", "Auteur"],
              ["revision", "Indice de révision"],
              ["planNumber", "Numéro de plan"],
              ["comments", "Commentaires"],
            ] as const).map(([key, label]) => (
              <label key={key} className="calibration-dialog__field">
                <span>{label}</span>
                <input value={sheet.titleBlock?.[key] ?? ""} onChange={(event) => onChange({ titleBlock: { ...sheet.titleBlock, [key]: event.target.value || undefined } })} />
              </label>
            ))}
            <label className="calibration-dialog__field">
              <span>Logo</span>
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(event) => { const file = event.target.files?.[0]; if (file) void fileToJpegDataUrl(file).then((logoDataUrl) => onChange({ titleBlock: { ...sheet.titleBlock, logoDataUrl } })); }} />
              {sheet.titleBlock?.logoDataUrl && <button type="button" onClick={() => onChange({ titleBlock: { ...sheet.titleBlock, logoDataUrl: undefined } })}>Retirer le logo</button>}
            </label>
            <label className="calibration-dialog__field">
              <span>Champs personnalisés (un par ligne : Libellé=Valeur)</span>
              <textarea value={(sheet.titleBlock?.customFields ?? []).map((field) => `${field.label}=${field.value}`).join("\n")} onChange={(event) => onChange({ titleBlock: { ...sheet.titleBlock, customFields: event.target.value.split("\n").map((line) => { const separator = line.indexOf("="); return separator > 0 ? { label: line.slice(0, separator).trim(), value: line.slice(separator + 1).trim() } : null; }).filter((field): field is { label: string; value: string } => field !== null && field.label.length > 0 && field.value.length > 0) } })} />
            </label>
          </div>
        </details>

        <label className="calibration-dialog__field">
          <span>Format de papier</span>
          <select value={sheet.paperSize} onChange={(e) => onChange({ paperSize: e.target.value as PaperSize })}>
            {PAPER_SIZE_ORDER.map((size) => (
              <option key={size} value={size}>
                {size}
              </option>
            ))}
          </select>
        </label>

        <label className="calibration-dialog__field">
          <span>Orientation</span>
          <select
            value={sheet.orientation}
            onChange={(e) => onChange({ orientation: e.target.value as Orientation })}
          >
            {ORIENTATIONS.map((orientation) => (
              <option key={orientation} value={orientation}>
                {orientation === "landscape" ? "Paysage" : "Portrait"}
              </option>
            ))}
          </select>
        </label>

        <label className="calibration-dialog__field">
          <span>Échelle</span>
          <select
            value={sheet.scaleDenominator}
            onChange={(e) => onChange({ scaleDenominator: Number(e.target.value) })}
          >
            {STANDARD_SCALE_DENOMINATORS.map((denominator) => (
              <option key={denominator} value={denominator}>
                {formatScale(denominator)}
              </option>
            ))}
          </select>
        </label>

        <label className="export-dialog__check">
          <input type="checkbox" checked={showGrid} onChange={(e) => onShowGridChange(e.target.checked)} />
          <span>Imprimer la grille métrique</span>
        </label>
        <label className="export-dialog__check"><input type="checkbox" checked={transparentPng} onChange={(event) => onTransparentPngChange(event.target.checked)} /><span>PNG avec zones vides transparentes</span></label>

        <div className="export-dialog__summary">
          <div className="properties-panel__static">
            <span>La feuille couvre</span>
            <span>
              {formatMeters(covered.widthM)} × {formatMeters(covered.heightM)}
            </span>
          </div>
          {contentSize && (
            <div className="properties-panel__static">
              <span>Le plan mesure</span>
              <span>
                {formatMeters(contentSize.widthM)} × {formatMeters(contentSize.heightM)}
              </span>
            </div>
          )}
          {contentSize === null && <p className="properties-panel__hint">Le plan est vide.</p>}
          {contentSize && !fits && (
            <p className="export-dialog__warning">
              ⚠ À {formatScale(sheet.scaleDenominator)}, le plan dépasse la feuille et sera tronqué.
              {suggested !== null && suggested !== sheet.scaleDenominator && (
                <>
                  {" "}
                  <button type="button" className="export-dialog__link" onClick={() => onChange({ scaleDenominator: suggested })}>
                    Ajuster à {formatScale(suggested)}
                  </button>
                </>
              )}
            </p>
          )}
          {contentSize && fits && (
            <p className="properties-panel__hint">
              Le plan tient sur la feuille. Une fois imprimé sans mise à l'échelle, 1 m au sol mesure{" "}
              {(1000 / sheet.scaleDenominator).toFixed(1).replace(/\.0$/, "")} mm sur le papier.
            </p>
          )}
        </div>

        <div className="calibration-dialog__actions">
          <button type="button" className="properties-panel__button" onClick={onClose} disabled={busy}>
            Fermer
          </button>
          <button type="button" className="properties-panel__button" onClick={onExportPng} disabled={busy}>
            PNG
          </button>
          <button type="button" className="properties-panel__button" onClick={onExportMultiPage} disabled={busy || contentBounds === null} title="Découper automatiquement avec 10 mm de recouvrement">
            PDF multi-feuilles
          </button>
          <button type="button" className="calibration-dialog__confirm" onClick={onExportPdf} disabled={busy}>
            {busy ? "Export…" : "Exporter en PDF"}
          </button>
        </div>
      </div>
    </div>
  );
}
