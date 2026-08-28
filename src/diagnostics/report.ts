import type { PlanObject, Project } from "../domain/types";

export interface DiagnosticEnvironment {
  userAgent: string;
  language: string;
  viewportWidth: number;
  viewportHeight: number;
  devicePixelRatio: number;
  indexedDbAvailable: boolean;
}

export interface DiagnosticReport {
  kind: "kl-implantation/diagnostic";
  generatedAt: string;
  privacy: string;
  environment: DiagnosticEnvironment;
  project: {
    id: string;
    createdAt: string;
    updatedAt: string;
    objectCount: number;
    objectsByType: Record<PlanObject["type"], number>;
    layerCount: number;
    visibleLayerCount: number;
    lockedLayerCount: number;
    sheetCount: number;
    hasBackground: boolean;
    backgroundResolutionPx: { width: number; height: number } | null;
    calibrationSource: Project["calibration"]["source"]["type"];
  };
}

export function buildDiagnosticReport(project: Project, environment: DiagnosticEnvironment, generatedAt = new Date().toISOString()): DiagnosticReport {
  const objectsByType: DiagnosticReport["project"]["objectsByType"] = { rectangle: 0, circle: 0, line: 0, polygon: 0, text: 0, image: 0 };
  project.objects.forEach((object) => { objectsByType[object.type] += 1; });
  return {
    kind: "kl-implantation/diagnostic",
    generatedAt,
    privacy: "Aucun nom d'objet, coordonnée, contenu de texte ou pixel du fond de plan n'est inclus.",
    environment,
    project: {
      id: project.id,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      objectCount: project.objects.length,
      objectsByType,
      layerCount: project.layers.length,
      visibleLayerCount: project.layers.filter((layer) => layer.visible).length,
      lockedLayerCount: project.layers.filter((layer) => layer.locked).length,
      sheetCount: project.sheets.length,
      hasBackground: project.background !== null,
      backgroundResolutionPx: project.background ? { width: project.background.widthPx, height: project.background.heightPx } : null,
      calibrationSource: project.calibration.source.type,
    },
  };
}
