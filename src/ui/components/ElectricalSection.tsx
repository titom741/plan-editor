import { useMemo } from "react";
import {
  CABLE_SECTIONS_MM2,
  CABLE_STROKES,
  ELECTRICAL_ROLE_LABELS,
  SOURCE_KIND_LABELS,
  STANDARD_RATINGS_A,
  cableLengthM,
  cableStyle,
  defaultElectricalSpec,
  flattenNetwork,
  formatCurrentA,
  formatPowerW,
  isCable,
  isDevice,
  maxRatingForSectionA,
  minSectionForRatingMm2,
  ratingPowerKva,
  rolesForType,
  type BoardOutput,
  type DirectLoad,
  type ElectricalNetwork,
  type ElectricalRole,
  type ElectricalSpec,
  type Phases,
  type SourceSpec,
} from "../../domain/electrical";
import { MATERIAL_CATALOG } from "../../domain/catalog";
import { formatMeters } from "../../domain/labels";
import { polylineLengthM } from "../../domain/measure";
import type { PlanObject, PlanObjectPatch } from "../../domain/types";
import { NumberField } from "./NumberField";

interface ElectricalSectionProps {
  object: PlanObject;
  /** Every object of the plan — the cable's pickers list the devices among them. */
  objects: readonly PlanObject[];
  network: ElectricalNetwork;
  isLocked: boolean;
  onPatch: (patch: PlanObjectPatch) => void;
  /** Starts a new undo step, like every other field of the panel on focus. */
  onFieldFocus: () => void;
}

const SEVERITY_ICONS = { error: "⛔", warning: "⚠", info: "ℹ" } as const;

/**
 * The electrical part of the properties panel (KL-045): what the shape is
 * electrically, its characteristics, and what the network analysis says
 * about it. Kept out of `PropertiesPanel` because it is a panel of its
 * own in all but name, and that file was already the longest in the app.
 */
export function ElectricalSection({
  object,
  objects,
  network,
  isLocked,
  onPatch,
  onFieldFocus,
}: ElectricalSectionProps) {
  const roles = rolesForType(object.type);
  const spec = object.electrical;
  const devices = useMemo(
    () =>
      objects
        .filter(isDevice)
        .sort((a, b) => a.name.localeCompare(b.name, "fr", { numeric: true })),
    [objects],
  );
  if (roles.length === 0) return null;

  const node = flattenNetwork(network.trees).find(
    (candidate) => candidate.device.id === object.id || candidate.feeder?.id === object.id,
  );
  const issues = network.issues.filter((issue) => issue.objectId === object.id);
  const setSpec = (next: ElectricalSpec) => onPatch({ electrical: next });

  const changeRole = (role: ElectricalRole | "") => {
    if (role === "") {
      onPatch({ electrical: undefined });
      return;
    }
    const next = defaultElectricalSpec(role);
    // A plain line becoming a cable takes the cable's colour; anything
    // else keeps the look the user gave it.
    onPatch(
      next.role === "cable"
        ? { electrical: next, style: { ...object.style, ...cableStyle(next.phases) } }
        : {
            electrical: next,
            category: object.category ?? "Électricité",
            // Equipment is not a marquee: its stands go with its old role.
            ...(object.type === "rectangle" ? { stands: undefined } : {}),
          },
    );
  };

  const phaseSelect = (value: Phases, onChange: (phases: Phases) => void, label = "Phases") => (
    <label className="properties-panel__field">
      <span>{label}</span>
      <select
        value={value}
        disabled={isLocked}
        onFocus={onFieldFocus}
        onChange={(e) => onChange(e.target.value as Phases)}
      >
        <option value="mono">Monophasé 230 V</option>
        <option value="tri">Triphasé 400 V</option>
      </select>
    </label>
  );

  const ratingSelect = (value: number, onChange: (ratingA: number) => void, label: string) => (
    <label className="properties-panel__field">
      <span>{label}</span>
      <select
        value={value}
        disabled={isLocked}
        onFocus={onFieldFocus}
        onChange={(e) => onChange(Number(e.target.value))}
      >
        {/* A value off the list (hand-edited file, odd generator) stays selectable rather than silently snapping to a neighbour. */}
        {[...new Set([...STANDARD_RATINGS_A, value])]
          .sort((a, b) => a - b)
          .map((rating) => (
            <option key={rating} value={rating}>
              {formatMeters(rating)} A
            </option>
          ))}
      </select>
    </label>
  );

  return (
    <fieldset className="properties-panel__display properties-panel__electrical">
      <legend>Électricité</legend>
      <label className="properties-panel__field">
        <span>Rôle</span>
        <select
          value={spec?.role ?? ""}
          disabled={isLocked}
          onFocus={onFieldFocus}
          onChange={(e) => changeRole(e.target.value as ElectricalRole | "")}
        >
          <option value="">Aucun</option>
          {roles.map((role) => (
            <option key={role} value={role}>
              {ELECTRICAL_ROLE_LABELS[role]}
            </option>
          ))}
        </select>
      </label>

      {spec?.role === "source" && (
        <>
          <label className="properties-panel__field">
            <span>Type</span>
            <select
              value={spec.kind}
              disabled={isLocked}
              onFocus={onFieldFocus}
              onChange={(e) => setSpec({ ...spec, kind: e.target.value as SourceSpec["kind"] })}
            >
              {Object.entries(SOURCE_KIND_LABELS).map(([kind, label]) => (
                <option key={kind} value={kind}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {phaseSelect(spec.phases, (phases) => setSpec({ ...spec, phases }))}
          {ratingSelect(spec.ratingA, (ratingA) => setSpec({ ...spec, ratingA }), "Calibre")}
          <p className="properties-panel__hint">
            Soit environ {formatMeters(Math.round(ratingPowerKva(spec.ratingA, spec.phases)))} kVA.
          </p>
        </>
      )}

      {spec?.role === "board" && (
        <>
          {phaseSelect(spec.phases, (phases) => setSpec({ ...spec, phases }), "Arrivée")}
          {ratingSelect(spec.ratingA, (ratingA) => setSpec({ ...spec, ratingA }), "Calibre")}
          <label className="properties-panel__field">
            <span>Différentiel</span>
            <select
              value={spec.rcdMa ?? ""}
              disabled={isLocked}
              onFocus={onFieldFocus}
              onChange={(e) => {
                const { rcdMa: _omit, ...rest } = spec;
                setSpec(e.target.value ? { ...rest, rcdMa: Number(e.target.value) } : rest);
              }}
            >
              <option value="">Aucun</option>
              <option value="30">30 mA</option>
              <option value="300">300 mA</option>
            </select>
          </label>
          <div className="properties-panel__outputs">
            <span className="properties-panel__outputs-title">Départs (prises)</span>
            {spec.outputs.map((output, index) => {
              const update = (patch: Partial<BoardOutput>) =>
                setSpec({
                  ...spec,
                  outputs: spec.outputs.map((item, i) =>
                    i === index ? { ...item, ...patch } : item,
                  ),
                });
              return (
                <div key={index} className="properties-panel__output-row">
                  <input
                    type="number"
                    min={1}
                    step={1}
                    aria-label="Nombre de prises"
                    value={output.count}
                    disabled={isLocked}
                    onFocus={onFieldFocus}
                    onChange={(e) => {
                      const count = Math.round(Number(e.target.value));
                      if (count >= 1) update({ count });
                    }}
                  />
                  <span aria-hidden="true">×</span>
                  <select
                    aria-label="Calibre"
                    value={output.ratingA}
                    disabled={isLocked}
                    onFocus={onFieldFocus}
                    onChange={(e) => update({ ratingA: Number(e.target.value) })}
                  >
                    {[...new Set([...STANDARD_RATINGS_A, output.ratingA])]
                      .sort((a, b) => a - b)
                      .map((rating) => (
                        <option key={rating} value={rating}>
                          {formatMeters(rating)} A
                        </option>
                      ))}
                  </select>
                  <select
                    aria-label="Phases"
                    value={output.phases}
                    disabled={isLocked}
                    onFocus={onFieldFocus}
                    onChange={(e) => update({ phases: e.target.value as Phases })}
                  >
                    <option value="mono">mono</option>
                    <option value="tri">tri</option>
                  </select>
                  <button
                    type="button"
                    className="properties-panel__icon-button"
                    title="Retirer ce départ"
                    disabled={isLocked}
                    onClick={() =>
                      setSpec({ ...spec, outputs: spec.outputs.filter((_, i) => i !== index) })
                    }
                  >
                    ✕
                  </button>
                </div>
              );
            })}
            <button
              type="button"
              className="properties-panel__add"
              disabled={isLocked}
              onClick={() =>
                setSpec({
                  ...spec,
                  outputs: [...spec.outputs, { phases: "mono", ratingA: 16, count: 1 }],
                })
              }
            >
              + Ajouter un départ
            </button>
          </div>
          <DirectLoadsEditor
            loads={spec.loads ?? []}
            allowTri={spec.phases === "tri"}
            isLocked={isLocked}
            onFieldFocus={onFieldFocus}
            onChange={(loads) => setSpec({ ...spec, loads })}
          />
        </>
      )}

      {spec?.role === "cable" && object.type === "line" && (
        <>
          {phaseSelect(spec.phases, (phases) => {
            // Recolour only a cable still wearing the colour of its old
            // phases: one the user painted keeps their choice.
            const recolour = object.style?.stroke === CABLE_STROKES[spec.phases];
            onPatch({
              electrical: { ...spec, phases },
              ...(recolour ? { style: { ...object.style, ...cableStyle(phases) } } : {}),
            });
          })}
          <label className="properties-panel__field">
            <span>Section</span>
            <select
              value={spec.sectionMm2}
              disabled={isLocked}
              onFocus={onFieldFocus}
              onChange={(e) => setSpec({ ...spec, sectionMm2: Number(e.target.value) })}
            >
              {[...new Set([...CABLE_SECTIONS_MM2, spec.sectionMm2])]
                .sort((a, b) => a - b)
                .map((section) => (
                  <option key={section} value={section}>
                    {formatMeters(section)} mm² (jusqu'à {maxRatingForSectionA(section)} A)
                  </option>
                ))}
            </select>
          </label>
          {ratingSelect(
            spec.ratingA,
            (ratingA) => setSpec({ ...spec, ratingA }),
            "Prise / protection",
          )}
          {(() => {
            const minimum = minSectionForRatingMm2(spec.ratingA);
            return minimum !== null && minimum > spec.sectionMm2 ? (
              <p className="properties-panel__hint">
                Section conseillée pour {formatMeters(spec.ratingA)} A : {formatMeters(minimum)}{" "}
                mm².
              </p>
            ) : null;
          })()}
          <label className="tools-panel__toggle">
            <input
              type="checkbox"
              checked={spec.lengthM !== undefined}
              disabled={isLocked}
              onChange={(e) => {
                const { lengthM: _omit, ...rest } = spec;
                setSpec(
                  e.target.checked
                    ? { ...rest, lengthM: Math.round(polylineLengthM(object.pointsM) * 10) / 10 }
                    : rest,
                );
              }}
            />
            <span>Longueur saisie (sinon, longueur tracée)</span>
          </label>
          {spec.lengthM !== undefined ? (
            <NumberField
              label="Longueur (m)"
              valueM={spec.lengthM}
              step={1}
              disabled={isLocked}
              onCommit={(value) => setSpec({ ...spec, lengthM: Math.max(0.1, value) })}
            />
          ) : (
            <div className="properties-panel__static">
              <span>Longueur</span>
              <span>
                {formatMeters(Math.round(cableLengthM({ ...object, electrical: spec }) * 10) / 10)}{" "}
                m
              </span>
            </div>
          )}
          {(["fromId", "toId"] as const).map((end) => (
            <label key={end} className="properties-panel__field">
              <span>{end === "fromId" ? "Depuis" : "Vers"}</span>
              <select
                value={spec[end] ?? ""}
                disabled={isLocked}
                onFocus={onFieldFocus}
                onChange={(e) => {
                  const { [end]: _omit, ...rest } = spec;
                  setSpec(e.target.value ? { ...rest, [end]: e.target.value } : rest);
                }}
              >
                <option value="">— non raccordé —</option>
                {devices
                  .filter((device) => device.id !== (end === "fromId" ? spec.toId : spec.fromId))
                  .map((device) => (
                    <option key={device.id} value={device.id}>
                      {device.name} ({ELECTRICAL_ROLE_LABELS[device.electrical.role]})
                    </option>
                  ))}
              </select>
            </label>
          ))}
        </>
      )}

      {spec?.role === "strip" && (
        <>
          <NumberField
            label="Nombre de prises"
            valueM={spec.outlets}
            step={1}
            disabled={isLocked}
            onCommit={(value) => setSpec({ ...spec, outlets: Math.max(1, Math.round(value)) })}
          />
          {ratingSelect(spec.ratingA, (ratingA) => setSpec({ ...spec, ratingA }), "Calibre")}
          <DirectLoadsEditor
            loads={spec.loads ?? []}
            allowTri={false}
            isLocked={isLocked}
            onFieldFocus={onFieldFocus}
            onChange={(loads) => setSpec({ ...spec, loads })}
          />
        </>
      )}

      {spec?.role === "load" && (
        <>
          <NumberField
            label="Puissance (W)"
            valueM={spec.powerW}
            step={100}
            disabled={isLocked}
            onCommit={(value) => setSpec({ ...spec, powerW: Math.max(1, value) })}
          />
          {phaseSelect(spec.phases, (phases) => setSpec({ ...spec, phases }))}
        </>
      )}

      {spec && node && (
        <dl className="properties-panel__electrical-figures">
          <dt>Puissance aval</dt>
          <dd>{formatPowerW(node.loadW)}</dd>
          <dt>Courant</dt>
          <dd>{formatCurrentA(node.currentA)}</dd>
          <dt>Chute de tension</dt>
          <dd>{formatMeters(Math.round(node.dropPct * 10) / 10)} %</dd>
        </dl>
      )}
      {spec && !node && !isCable(object) && spec.role !== "source" && issues.length === 0 && (
        <p className="properties-panel__hint">Pas encore relié à une alimentation.</p>
      )}
      {issues.length > 0 && (
        <ul className="properties-panel__issues">
          {issues.map((issue, index) => (
            <li key={index} className={`is-${issue.severity}`}>
              <span aria-hidden="true">{SEVERITY_ICONS[issue.severity]}</span> {issue.message}
            </li>
          ))}
        </ul>
      )}
    </fieldset>
  );
}

/** The consumers of the library, offered as one-click presets. */
const LOAD_PRESETS = MATERIAL_CATALOG.flatMap((item) =>
  item.electrical?.role === "load"
    ? [{ name: item.name, phases: item.electrical.phases, powerW: item.electrical.powerW }]
    : [],
);

interface DirectLoadsEditorProps {
  loads: readonly DirectLoad[];
  /** False on a strip or a single-phase box, which cannot take a three-phase consumer. */
  allowTri: boolean;
  isLocked: boolean;
  onFieldFocus: () => void;
  onChange: (loads: DirectLoad[]) => void;
}

/**
 * The consumers plugged straight into a coffret or a strip (KL-048),
 * listed rather than drawn: one row each, with a quantity, so thirty
 * projectors are one line and not thirty circles and thirty cables.
 * Drawing a load stays possible; both count in the same balance.
 */
function DirectLoadsEditor({
  loads,
  allowTri,
  isLocked,
  onFieldFocus,
  onChange,
}: DirectLoadsEditorProps) {
  const update = (index: number, patch: Partial<DirectLoad>) =>
    onChange(loads.map((load, i) => (i === index ? { ...load, ...patch } : load)));
  const add = (load: Omit<DirectLoad, "quantity">) =>
    onChange([...loads, { ...load, quantity: 1 }]);
  const total = loads.reduce((sum, load) => sum + load.powerW * load.quantity, 0);

  return (
    <div className="properties-panel__outputs">
      <span className="properties-panel__outputs-title">
        Récepteurs raccordés{loads.length > 0 ? ` — ${formatPowerW(total)}` : ""}
      </span>
      {loads.map((load, index) => (
        <div key={index} className="properties-panel__load">
          <input
            type="text"
            aria-label="Nom du récepteur"
            value={load.name}
            disabled={isLocked}
            onFocus={onFieldFocus}
            onChange={(e) => update(index, { name: e.target.value })}
          />
          <div className="properties-panel__load-row">
            <input
              type="number"
              min={1}
              step={1}
              aria-label="Quantité"
              title="Quantité"
              value={load.quantity}
              disabled={isLocked}
              onFocus={onFieldFocus}
              onChange={(e) => {
                const quantity = Math.round(Number(e.target.value));
                if (quantity >= 1) update(index, { quantity });
              }}
            />
            <span aria-hidden="true">×</span>
            <input
              type="number"
              min={1}
              step={50}
              aria-label="Puissance unitaire (W)"
              title="Puissance unitaire (W)"
              value={load.powerW}
              disabled={isLocked}
              onFocus={onFieldFocus}
              onChange={(e) => {
                const powerW = Number(e.target.value);
                if (powerW > 0) update(index, { powerW });
              }}
            />
            <span aria-hidden="true">W</span>
            <select
              aria-label="Phases"
              value={load.phases}
              disabled={isLocked}
              onFocus={onFieldFocus}
              onChange={(e) => update(index, { phases: e.target.value as Phases })}
            >
              <option value="mono">mono</option>
              {(allowTri || load.phases === "tri") && <option value="tri">tri</option>}
            </select>
            <button
              type="button"
              className="properties-panel__icon-button"
              title="Retirer ce récepteur"
              disabled={isLocked}
              onClick={() => onChange(loads.filter((_, i) => i !== index))}
            >
              ✕
            </button>
          </div>
        </div>
      ))}
      <select
        className="properties-panel__add"
        aria-label="Ajouter un récepteur"
        value=""
        disabled={isLocked}
        onFocus={onFieldFocus}
        onChange={(e) => {
          const choice = e.target.value;
          if (choice === "") return;
          const preset = LOAD_PRESETS.find((candidate) => candidate.name === choice);
          add(preset ?? { name: "Récepteur", phases: "mono", powerW: 1000 });
        }}
      >
        <option value="">+ Ajouter un récepteur…</option>
        {LOAD_PRESETS.filter((preset) => allowTri || preset.phases === "mono").map((preset) => (
          <option key={preset.name} value={preset.name}>
            {preset.name} ({formatPowerW(preset.powerW)} {preset.phases})
          </option>
        ))}
        <option value="__custom">Autre récepteur</option>
      </select>
    </div>
  );
}
