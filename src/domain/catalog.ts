import type { Layer, ObjectStyle, PlanObject } from "./types";
import { polygonAreaM2, polylineLengthM } from "./measure";

export type CatalogShape = "rectangle" | "circle" | "line" | "polygon";

export interface CatalogItem {
  id: string;
  category: string;
  name: string;
  reference: string;
  shape: CatalogShape;
  widthM?: number;
  heightM?: number;
  radiusM?: number;
  pointsM?: { xM: number; yM: number }[];
  unit: string;
  style: ObjectStyle;
}

export const MATERIAL_CATALOG: readonly CatalogItem[] = [
  {
    id: "arc-90",
    category: "Dessin",
    name: "Arc 90° — rayon 2 m",
    reference: "ARC-90",
    shape: "line",
    pointsM: Array.from({ length: 13 }, (_, index) => {
      const angle = ((index / 12) * Math.PI) / 2;
      return { xM: Math.cos(angle) * 2, yM: Math.sin(angle) * 2 };
    }),
    unit: "u",
    style: { stroke: "#0f172a", strokeWidth: 0.08 },
  },
  {
    id: "sector-90",
    category: "Dessin",
    name: "Secteur 90° — rayon 2 m",
    reference: "SECT-90",
    shape: "polygon",
    pointsM: [
      { xM: 0, yM: 0 },
      ...Array.from({ length: 13 }, (_, index) => {
        const angle = ((index / 12) * Math.PI) / 2;
        return { xM: Math.cos(angle) * 2, yM: Math.sin(angle) * 2 };
      }),
    ],
    unit: "u",
    style: { fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 0.08, opacity: 0.7 },
  },
  {
    id: "tent-5x5",
    category: "Structures",
    name: "Chapiteau 5 × 5 m",
    reference: "CHP-5X5",
    shape: "rectangle",
    widthM: 5,
    heightM: 5,
    unit: "u",
    style: { fill: "#dbeafe", stroke: "#2563eb", strokeWidth: 0.08, opacity: 0.8 },
  },
  {
    id: "stage-8x6",
    category: "Structures",
    name: "Scène 8 × 6 m",
    reference: "SCN-8X6",
    shape: "rectangle",
    widthM: 8,
    heightM: 6,
    unit: "u",
    style: { fill: "#e5e7eb", stroke: "#111827", strokeWidth: 0.1, opacity: 0.9 },
  },
  {
    id: "barrier-2m",
    category: "Sécurité",
    name: "Barrière 2 m",
    reference: "BAR-2M",
    shape: "rectangle",
    widthM: 2,
    heightM: 0.12,
    unit: "u",
    style: { fill: "#fef3c7", stroke: "#d97706", strokeWidth: 0.06, opacity: 0.95 },
  },
  {
    id: "exit",
    category: "Sécurité",
    name: "Issue de secours",
    reference: "ISSUE",
    shape: "rectangle",
    widthM: 1.4,
    heightM: 0.3,
    unit: "u",
    style: { fill: "#dcfce7", stroke: "#16a34a", strokeWidth: 0.08, opacity: 0.9 },
  },
  {
    id: "extinguisher",
    category: "Sécurité",
    name: "Extincteur",
    reference: "EXT",
    shape: "circle",
    radiusM: 0.18,
    unit: "u",
    style: { fill: "#fee2e2", stroke: "#dc2626", strokeWidth: 0.07, opacity: 1 },
  },
  {
    id: "power-63a",
    category: "Électricité",
    name: "Coffret électrique 63 A",
    reference: "ELEC-63A",
    shape: "rectangle",
    widthM: 0.6,
    heightM: 0.4,
    unit: "u",
    style: { fill: "#fef9c3", stroke: "#ca8a04", strokeWidth: 0.07, opacity: 1 },
  },
  {
    id: "light",
    category: "Électricité",
    name: "Point lumineux",
    reference: "LUM",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: { fill: "#fef08a", stroke: "#a16207", strokeWidth: 0.06, opacity: 1 },
  },
  {
    id: "table-180",
    category: "Mobilier",
    name: "Table 1,80 × 0,75 m",
    reference: "TAB-180",
    shape: "rectangle",
    widthM: 1.8,
    heightM: 0.75,
    unit: "u",
    style: { fill: "#f5f3ff", stroke: "#7c3aed", strokeWidth: 0.05, opacity: 0.85 },
  },
  {
    id: "round-table",
    category: "Mobilier",
    name: "Table ronde Ø 1,50 m",
    reference: "TAB-R150",
    shape: "circle",
    radiusM: 0.75,
    unit: "u",
    style: { fill: "#f5f3ff", stroke: "#7c3aed", strokeWidth: 0.05, opacity: 0.85 },
  },
  {
    id: "chair",
    category: "Mobilier",
    name: "Chaise",
    reference: "CHAISE",
    shape: "rectangle",
    widthM: 0.45,
    heightM: 0.45,
    unit: "u",
    style: { fill: "#f3f4f6", stroke: "#4b5563", strokeWidth: 0.04, opacity: 0.9 },
  },
  {
    id: "toilet",
    category: "Services",
    name: "Sanitaire mobile",
    reference: "WC-MOB",
    shape: "rectangle",
    widthM: 1.2,
    heightM: 1.2,
    unit: "u",
    style: { fill: "#cffafe", stroke: "#0891b2", strokeWidth: 0.07, opacity: 0.9 },
  },
  {
    id: "waste",
    category: "Services",
    name: "Point déchets",
    reference: "DECH",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: { fill: "#d1fae5", stroke: "#047857", strokeWidth: 0.06, opacity: 0.9 },
  },
  {
    id: "door-140",
    category: "Architecture",
    name: "Porte / ouverture 1,40 m",
    reference: "PORTE-140",
    shape: "rectangle",
    widthM: 1.4,
    heightM: 0.12,
    unit: "u",
    style: { fill: "#ffffff", stroke: "#334155", strokeWidth: 0.08, opacity: 1, dash: "dashed" },
  },
  {
    id: "vehicle-light",
    category: "Véhicules",
    name: "Véhicule léger",
    reference: "VL",
    shape: "rectangle",
    widthM: 4.5,
    heightM: 1.8,
    unit: "u",
    style: { fill: "#e0f2fe", stroke: "#0369a1", strokeWidth: 0.08, opacity: 0.85 },
  },
  {
    id: "truck",
    category: "Véhicules",
    name: "Poids lourd",
    reference: "PL",
    shape: "rectangle",
    widthM: 12,
    heightM: 2.55,
    unit: "u",
    style: { fill: "#e2e8f0", stroke: "#334155", strokeWidth: 0.1, opacity: 0.85 },
  },
  {
    id: "first-aid",
    category: "Sécurité",
    name: "Poste de secours",
    reference: "PSS",
    shape: "rectangle",
    widthM: 3,
    heightM: 3,
    unit: "u",
    style: { fill: "#fee2e2", stroke: "#dc2626", strokeWidth: 0.1, opacity: 0.85 },
  },
  {
    id: "bar",
    category: "Services",
    name: "Bar / comptoir 4 m",
    reference: "BAR-4M",
    shape: "rectangle",
    widthM: 4,
    heightM: 0.8,
    unit: "u",
    style: { fill: "#ffedd5", stroke: "#c2410c", strokeWidth: 0.08, opacity: 0.9 },
  },
];

export interface ScheduleRow {
  layer: string;
  category: string;
  reference: string;
  name: string;
  quantity: number;
  unit: string;
}

export function buildSchedule(
  objects: readonly PlanObject[],
  layers: readonly Layer[] = [],
): ScheduleRow[] {
  const rows = new Map<string, ScheduleRow>();
  const layerNames = new Map(layers.map((layer) => [layer.id, layer.name]));
  for (const object of objects) {
    const layer = layerNames.get(object.layerId) ?? "Calque inconnu";
    const category = object.category?.trim() || "Sans catégorie";
    const reference = object.reference?.trim() || object.catalogId?.trim() || "—";
    const hasManualUnit = Boolean(object.unit?.trim());
    const unit =
      object.unit?.trim() ||
      (object.type === "line" ? "m" : object.type === "polygon" ? "m²" : "u");
    const manualQuantity =
      Number.isFinite(object.quantity) && (object.quantity ?? 0) > 0 ? object.quantity! : 1;
    const quantity =
      !hasManualUnit && object.type === "line"
        ? polylineLengthM(object.pointsM)
        : !hasManualUnit && object.type === "polygon"
          ? polygonAreaM2(object.pointsM)
          : manualQuantity;
    const key = `${layer}\u0000${category}\u0000${reference}\u0000${object.name}\u0000${unit}`;
    const row = rows.get(key);
    if (row) row.quantity += quantity;
    else rows.set(key, { layer, category, reference, name: object.name, quantity, unit });
  }
  return [...rows.values()].sort(
    (a, b) =>
      a.layer.localeCompare(b.layer, "fr") ||
      a.category.localeCompare(b.category, "fr") ||
      a.name.localeCompare(b.name, "fr"),
  );
}

function csvCell(value: string | number): string {
  const text = String(value).replaceAll('"', '""');
  return `"${text}"`;
}

export function scheduleToCsv(rows: readonly ScheduleRow[]): string {
  return [
    ["Calque", "Catégorie", "Référence", "Désignation", "Quantité", "Unité"],
    ...rows.map((row) => [
      row.layer,
      row.category,
      row.reference,
      row.name,
      Math.round(row.quantity * 100) / 100,
      row.unit,
    ]),
  ]
    .map((cells) => cells.map(csvCell).join(";"))
    .join("\r\n");
}
