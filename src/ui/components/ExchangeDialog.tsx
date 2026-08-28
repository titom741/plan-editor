import { useRef, useState, type FormEvent } from "react";
import { geoJsonToObjects, objectsToDxf, objectsToGeoJson, objectsToSvg } from "../../exchange/exportFormats";
import type { PlanObject, Project } from "../../domain/types";

interface ExchangeDialogProps {
  project: Project;
  /** Everything currently visible — what gets exported when nothing is selected. */
  objects: readonly PlanObject[];
  selection: readonly PlanObject[];
  /** Where imported geometry lands. `null` disables the import, since an object needs a layer. */
  targetLayerId: string | null;
  onImportObjects: (objects: PlanObject[]) => void;
  onSetGeoreference: (georeference: Project["georeference"] | undefined) => void;
  onClose: () => void;
}

/**
 * Getting geometry in and out of the other tools an event plan meets:
 * SVG and DXF on the way out, GeoJSON both ways.
 *
 * The georeference form is part of this dialog rather than a separate one
 * because it only means anything here: without a WGS84 anchor the GeoJSON
 * export can only emit the plan's local metric coordinates, which no GIS
 * will place correctly.
 */
export function ExchangeDialog({
  project,
  objects,
  selection,
  targetLayerId,
  onImportObjects,
  onSetGeoreference,
  onClose,
}: ExchangeDialogProps) {
  const source = selection.length > 0 ? selection : objects;
  const baseFileName = `${slug(project.name)}-${selection.length > 0 ? "selection" : "plan"}`;
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditingGeoreference, setIsEditingGeoreference] = useState(false);

  const handleImportFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    // Reset so picking the same file twice still fires a change event.
    event.target.value = "";
    if (!file || !targetLayerId) return;
    void file
      .text()
      .then((text) => {
        onImportObjects(geoJsonToObjects(text, targetLayerId, project.georeference));
        setError(null);
      })
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : String(reason)));
  };

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="exchange-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="dialog__header">
          <h2 id="exchange-title">Échanges vectoriels</h2>
          <button type="button" className="dialog__close" onClick={onClose}>
            ✕
          </button>
        </div>

        <p>
          {selection.length > 0
            ? `${selection.length} objet(s) sélectionné(s)`
            : `${objects.length} objet(s) visibles`}{" "}
          seront exportés.{" "}
          {project.georeference
            ? `GeoJSON WGS84 ancré à ${project.georeference.originLatitude.toFixed(6)}, ${project.georeference.originLongitude.toFixed(6)}.`
            : "Coordonnées en mètres dans le repère local du plan."}
        </p>

        <div className="dialog__actions">
          <button type="button" onClick={() => download(objectsToSvg(source), "image/svg+xml", `${baseFileName}.svg`)}>
            SVG
          </button>
          <button type="button" onClick={() => download(objectsToDxf(source), "application/dxf", `${baseFileName}.dxf`)}>
            DXF
          </button>
          <button
            type="button"
            onClick={() =>
              download(
                objectsToGeoJson(source, project.georeference),
                "application/geo+json",
                `${baseFileName}.geojson`,
              )
            }
          >
            GeoJSON
          </button>
          <button type="button" onClick={() => inputRef.current?.click()} disabled={!targetLayerId}>
            Importer GeoJSON…
          </button>
        </div>

        {isEditingGeoreference ? (
          <GeoreferenceForm
            georeference={project.georeference}
            onCancel={() => setIsEditingGeoreference(false)}
            onConfirm={(georeference) => {
              onSetGeoreference(georeference);
              setIsEditingGeoreference(false);
            }}
          />
        ) : (
          <div className="dialog__actions">
            <button type="button" onClick={() => setIsEditingGeoreference(true)}>
              {project.georeference ? "Modifier l’ancrage GPS…" : "Définir l’ancrage GPS…"}
            </button>
            {project.georeference && (
              <button type="button" onClick={() => onSetGeoreference(undefined)}>
                Retirer l’ancrage
              </button>
            )}
          </div>
        )}

        <input
          ref={inputRef}
          hidden
          type="file"
          accept=".geojson,.json,application/geo+json"
          onChange={handleImportFile}
        />
        {error && <p className="export-dialog__warning">{error}</p>}
        <p className="properties-panel__hint">
          DWG reste propriétaire : ouvrez le DXF dans AutoCAD, BricsCAD ou ODA File Converter. L’import
          SVG/DXF complexe nécessite un moteur CAO externe ; GeoJSON est importé nativement.
        </p>
      </section>
    </div>
  );
}

interface GeoreferenceFormProps {
  georeference: Project["georeference"];
  onConfirm: (georeference: NonNullable<Project["georeference"]>) => void;
  onCancel: () => void;
}

/** Where the plan's local origin sits on Earth. Number fields, validated before they reach the project. */
function GeoreferenceForm({ georeference, onConfirm, onCancel }: GeoreferenceFormProps) {
  const [longitude, setLongitude] = useState(String(georeference?.originLongitude ?? 0));
  const [latitude, setLatitude] = useState(String(georeference?.originLatitude ?? 0));
  const [rotation, setRotation] = useState(String(georeference?.rotationDeg ?? 0));

  const values = [Number(longitude), Number(latitude), Number(rotation)] as const;
  const isValid =
    values.every(Number.isFinite) &&
    values[0] >= -180 &&
    values[0] <= 180 &&
    values[1] >= -90 &&
    values[1] <= 90;

  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!isValid) return;
    onConfirm({
      crs: "EPSG:4326",
      originLongitude: values[0],
      originLatitude: values[1],
      rotationDeg: values[2],
    });
  };

  return (
    <form className="exchange-dialog__geo" onSubmit={handleSubmit}>
      <label className="calibration-dialog__field">
        <span>Longitude WGS84 de l’origine locale</span>
        <input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} />
      </label>
      <label className="calibration-dialog__field">
        <span>Latitude WGS84 de l’origine locale</span>
        <input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} />
      </label>
      <label className="calibration-dialog__field">
        <span>Rotation du plan vers l’est géographique (degrés)</span>
        <input type="number" step="any" value={rotation} onChange={(event) => setRotation(event.target.value)} />
      </label>
      <div className="dialog__actions">
        <button type="button" onClick={onCancel}>
          Annuler
        </button>
        <button type="submit" disabled={!isValid}>
          Enregistrer l’ancrage
        </button>
      </div>
      {!isValid && <p className="export-dialog__warning">Coordonnées géographiques invalides.</p>}
    </form>
  );
}

function slug(value: string): string {
  return (value.trim() || "plan").replace(/[^a-z0-9_-]+/gi, "-").toLowerCase();
}

/** Hands the browser a generated text file. Revoked on the next tick — the click has already consumed the URL. */
function download(text: string, type: string, name: string): void {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
