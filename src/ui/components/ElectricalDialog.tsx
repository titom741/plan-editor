import { Fragment, useMemo } from "react";
import {
  ELECTRICAL_ROLE_LABELS,
  electricalSummary,
  flattenNetwork,
  formatCurrentA,
  formatPowerW,
  type ElectricalNetwork,
} from "../../domain/electrical";
import { formatMeters } from "../../domain/labels";
import type { Project } from "../../domain/types";
import { SYNOPTIC_DISCLAIMER, buildSynopticPdf } from "../../printing/synopticPdf";
import {
  EDGE_LABEL_SIZE_PT,
  LINE_SIZE_PT,
  ROLE_FILLS,
  TITLE_SIZE_PT,
  TYPE_METRICS,
  edgeLabel,
  layoutSynoptic,
  listedLoadRows,
  severityStroke,
} from "../../printing/synopticLayout";

interface ElectricalDialogProps {
  project: Project;
  network: ElectricalNetwork;
  /** Selects the object on the plan and closes the dialog, so the user lands on what an alert is about. */
  onSelectObject: (id: string) => void;
  onClose: () => void;
}

const SEVERITY_ICONS = { error: "⛔", warning: "⚠", info: "ℹ" } as const;
/** Screen pixels per layout millimetre: the diagram at roughly the size it prints. */
const PX_PER_MM = 3.2;

function safeName(name: string) {
  return (name.trim() || "projet")
    .replace(/[^a-z0-9_-]+/gi, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/**
 * The plan's electrical network as a single-line diagram (KL-046), with
 * its balance, the cable to buy and every alert. The diagram is drawn
 * from `printing/synopticLayout.ts`, the layout the PDF uses, so what is
 * seen here is what prints.
 */
export function ElectricalDialog({
  project,
  network,
  onSelectObject,
  onClose,
}: ElectricalDialogProps) {
  const layout = useMemo(() => layoutSynoptic(network), [network]);
  const nodes = flattenNetwork(network.trees);
  const names = new Map(project.objects.map((object) => [object.id, object.name]));
  // "Câble 4" says little in a list of alerts; what it feeds says which one.
  for (const node of nodes) {
    if (node.feeder) names.set(node.feeder.id, `${node.feeder.name} vers ${node.device.name}`);
  }
  const { PADDING_MM, TITLE_STEP_MM, LINE_STEP_MM, PT_TO_MM } = TYPE_METRICS;
  const errors = network.issues.filter((issue) => issue.severity === "error").length;
  const warnings = network.issues.filter((issue) => issue.severity === "warning").length;

  const downloadPdf = () => {
    const bytes = buildSynopticPdf(network, project.name, new Date());
    const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: "application/pdf" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${safeName(project.name)}-schema-electrique.pdf`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog electrical-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="electrical-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="electrical-title">Schéma électrique</h2>
          <button type="button" className="dialog__close" onClick={onClose} aria-label="Fermer">
            ✕
          </button>
        </div>

        {network.isEmpty ? (
          <p>
            Le plan ne contient encore aucun élément électrique. Posez une alimentation, des
            coffrets et des récepteurs avec les outils Électricité, puis reliez-les par des câbles.
          </p>
        ) : (
          <div className="electrical-dialog__body">
            <p className="electrical-dialog__summary">
              Puissance installée <strong>{formatPowerW(network.totalLoadW)}</strong> ·{" "}
              {network.trees.length} alimentation(s) · {errors} erreur(s) · {warnings}{" "}
              avertissement(s)
            </p>

            <h3>Synoptique unifilaire</h3>
            {layout.boxes.length === 0 ? (
              <p>Aucun équipement à représenter.</p>
            ) : (
              <div className="electrical-dialog__diagram">
                <svg
                  width={(layout.widthMm + 4) * PX_PER_MM}
                  height={(layout.heightMm + 4) * PX_PER_MM}
                  viewBox={`-2 -2 ${layout.widthMm + 4} ${layout.heightMm + 4}`}
                  role="img"
                  aria-label="Synoptique unifilaire du réseau électrique"
                >
                  {layout.edges.map((edge) => (
                    <g key={edge.key} className="electrical-dialog__edge">
                      <polyline
                        points={edge.pointsMm.map(([x, y]) => `${x},${y}`).join(" ")}
                        fill="none"
                        stroke={severityStroke(edge.severity)}
                        strokeWidth={edge.severity === "error" ? 0.45 : 0.3}
                        strokeDasharray={edge.dashed ? "1.2 0.8" : undefined}
                      />
                      <text
                        x={edge.labelXMm}
                        y={edge.labelYMm}
                        fontSize={EDGE_LABEL_SIZE_PT * PT_TO_MM}
                        className="electrical-dialog__svg-text"
                        onClick={() => onSelectObject(edge.objectId)}
                      >
                        {edge.label}
                      </text>
                    </g>
                  ))}
                  {layout.boxes.map((box) => (
                    <g
                      key={box.key}
                      className="electrical-dialog__box"
                      onClick={() => onSelectObject(box.objectId)}
                    >
                      <title>Sélectionner {box.title} sur le plan</title>
                      <rect
                        x={box.xMm}
                        y={box.yMm}
                        width={box.widthMm}
                        height={box.heightMm}
                        rx={0.8}
                        fill={ROLE_FILLS[box.role]}
                        stroke={severityStroke(box.severity)}
                        strokeWidth={box.severity === "error" ? 0.5 : 0.3}
                      />
                      <text
                        x={box.xMm + PADDING_MM}
                        y={box.yMm + PADDING_MM + TITLE_STEP_MM * 0.8}
                        fontSize={TITLE_SIZE_PT * PT_TO_MM}
                        fontWeight={600}
                        fill="#0f172a"
                      >
                        {box.title}
                      </text>
                      {box.lines.map((line, index) => (
                        <text
                          key={index}
                          x={box.xMm + PADDING_MM}
                          y={box.yMm + PADDING_MM + TITLE_STEP_MM + LINE_STEP_MM * (index + 0.8)}
                          fontSize={LINE_SIZE_PT * PT_TO_MM}
                          fill="#334155"
                        >
                          {line}
                        </text>
                      ))}
                    </g>
                  ))}
                  {layout.headings.map((heading) => (
                    <text
                      key={heading.text}
                      x={heading.xMm}
                      y={heading.yMm}
                      fontSize={8 * PT_TO_MM}
                      fontWeight={600}
                      className="electrical-dialog__svg-text"
                    >
                      {heading.text}
                    </text>
                  ))}
                </svg>
              </div>
            )}

            <h3>Alertes ({network.issues.length})</h3>
            {network.issues.length === 0 ? (
              <p>Aucune alerte.</p>
            ) : (
              <ul className="electrical-dialog__issues">
                {network.issues.map((issue, index) => (
                  <li key={index} className={`is-${issue.severity}`}>
                    <button type="button" onClick={() => onSelectObject(issue.objectId)}>
                      <span aria-hidden="true">{SEVERITY_ICONS[issue.severity]}</span>{" "}
                      <strong>{names.get(issue.objectId) ?? ""}</strong> — {issue.message}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <h3>Bilan par équipement</h3>
            <div className="schedule-dialog__table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Équipement</th>
                    <th>Rôle</th>
                    <th>Caractéristiques</th>
                    <th>Alimenté par</th>
                    <th>Puissance</th>
                    <th>Courant</th>
                    <th>Chute</th>
                  </tr>
                </thead>
                <tbody>
                  {nodes.map((node) => (
                    <Fragment key={node.device.id}>
                      <tr>
                        <td style={{ paddingLeft: `${0.4 + node.depth * 0.9}rem` }}>
                          {node.device.name}
                        </td>
                        <td>{ELECTRICAL_ROLE_LABELS[node.device.electrical.role]}</td>
                        <td>{electricalSummary(node.device)}</td>
                        <td>{node.feeder ? edgeLabel(node.feeder) : "—"}</td>
                        <td>{formatPowerW(node.loadW)}</td>
                        <td>{formatCurrentA(node.currentA)}</td>
                        <td>{formatMeters(Math.round(node.dropPct * 10) / 10)} %</td>
                      </tr>
                      {listedLoadRows(node).map((row) => (
                        <tr key={row.key} className="electrical-dialog__listed">
                          {row.cells.map((cell, index) => (
                            <td
                              key={index}
                              style={
                                index === 0
                                  ? { paddingLeft: `${0.4 + (node.depth + 1) * 0.9}rem` }
                                  : undefined
                              }
                            >
                              {cell}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </Fragment>
                  ))}
                  {network.unfed.map((device) => (
                    <tr key={device.id} className="electrical-dialog__unfed">
                      <td>{device.name}</td>
                      <td>{ELECTRICAL_ROLE_LABELS[device.electrical.role]}</td>
                      <td>{electricalSummary(device)}</td>
                      <td>non alimenté</td>
                      <td />
                      <td />
                      <td />
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {network.cableTotals.length > 0 && (
              <>
                <h3>Câbles</h3>
                <div className="schedule-dialog__table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Désignation</th>
                        <th>Nombre</th>
                        <th>Longueur totale</th>
                      </tr>
                    </thead>
                    <tbody>
                      {network.cableTotals.map((total) => (
                        <tr key={total.designation}>
                          <td>H07RN-F {total.designation}</td>
                          <td>{total.count}</td>
                          <td>{formatMeters(Math.round(total.lengthM * 10) / 10)} m</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}

            <p className="properties-panel__hint">{SYNOPTIC_DISCLAIMER}</p>
          </div>
        )}

        <div className="dialog__actions">
          <button type="button" onClick={downloadPdf} disabled={network.isEmpty}>
            Exporter le PDF
          </button>
          <button type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </section>
    </div>
  );
}
