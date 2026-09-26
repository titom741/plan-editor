import type { ElectricalSpec, Layer, ObjectStyle, PlanObject } from "./types";
import { cableDesignation, cableLengthM, cableStyle, isCable } from "./electrical";
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
  /** What the item is electrically, carried onto the object it inserts (KL-045). */
  electrical?: ElectricalSpec;
}

/**
 * A straight cable of `lengthM`, drawn along x. Named without its length:
 * the run is reshaped the moment it is placed, and a name saying "25 m"
 * on a 40 m cable is a lie the plan would print.
 */
function cableItem(
  id: string,
  name: string,
  reference: string,
  lengthM: number,
  electrical: Extract<ElectricalSpec, { role: "cable" }>,
): CatalogItem {
  return {
    id,
    category: "Électricité",
    name,
    reference,
    shape: "line",
    pointsM: [
      { xM: 0, yM: 0 },
      { xM: lengthM, yM: 0 },
    ],
    unit: "m",
    style: cableStyle(electrical.phases),
    electrical,
  };
}

const SOURCE_STYLE: ObjectStyle = {
  fill: "#fde68a",
  stroke: "#b45309",
  strokeWidth: 2.5,
  opacity: 1,
};
const BOARD_STYLE: ObjectStyle = { fill: "#fef9c3", stroke: "#ca8a04", strokeWidth: 2, opacity: 1 };
const STRIP_STYLE: ObjectStyle = {
  fill: "#e0f2fe",
  stroke: "#0369a1",
  strokeWidth: 1.5,
  opacity: 1,
};
const LOAD_STYLE: ObjectStyle = {
  fill: "#f3e8ff",
  stroke: "#7c3aed",
  strokeWidth: 1.5,
  opacity: 1,
};

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
    id: "generator-60kva",
    category: "Électricité",
    name: "Groupe électrogène 60 kVA",
    reference: "GE-60",
    shape: "rectangle",
    widthM: 2.8,
    heightM: 1.1,
    unit: "u",
    style: SOURCE_STYLE,
    electrical: { role: "source", kind: "generator", phases: "tri", ratingA: 80 },
  },
  {
    id: "grid-63a",
    category: "Électricité",
    name: "Branchement réseau 63 A tri",
    reference: "RES-63",
    shape: "rectangle",
    widthM: 0.6,
    heightM: 0.3,
    unit: "u",
    style: SOURCE_STYLE,
    electrical: { role: "source", kind: "grid", phases: "tri", ratingA: 63 },
  },
  {
    // Kept under its historical id so plans that inserted it before KL-045
    // still count it on the same nomenclature line.
    id: "power-63a",
    category: "Électricité",
    name: "Coffret électrique 63 A",
    reference: "ELEC-63A",
    shape: "rectangle",
    widthM: 0.6,
    heightM: 0.4,
    unit: "u",
    style: BOARD_STYLE,
    electrical: {
      role: "board",
      phases: "tri",
      ratingA: 63,
      rcdMa: 30,
      outputs: [
        { phases: "tri", ratingA: 32, count: 1 },
        { phases: "tri", ratingA: 16, count: 2 },
        { phases: "mono", ratingA: 16, count: 6 },
      ],
    },
  },
  {
    id: "board-32a-tri",
    category: "Électricité",
    name: "Coffret électrique 32 A tri",
    reference: "ELEC-32T",
    shape: "rectangle",
    widthM: 0.5,
    heightM: 0.35,
    unit: "u",
    style: BOARD_STYLE,
    electrical: {
      role: "board",
      phases: "tri",
      ratingA: 32,
      rcdMa: 30,
      outputs: [
        { phases: "tri", ratingA: 16, count: 1 },
        { phases: "mono", ratingA: 16, count: 6 },
      ],
    },
  },
  {
    id: "board-16a-mono",
    category: "Électricité",
    name: "Coffret électrique 16 A mono",
    reference: "ELEC-16M",
    shape: "rectangle",
    widthM: 0.4,
    heightM: 0.3,
    unit: "u",
    style: BOARD_STYLE,
    electrical: {
      role: "board",
      phases: "mono",
      ratingA: 16,
      rcdMa: 30,
      outputs: [{ phases: "mono", ratingA: 16, count: 4 }],
    },
  },
  {
    id: "strip-6",
    category: "Électricité",
    name: "Multiprise 6 prises",
    reference: "MP-6",
    shape: "rectangle",
    widthM: 0.6,
    heightM: 0.2,
    unit: "u",
    style: STRIP_STYLE,
    electrical: { role: "strip", phases: "mono", outlets: 6, ratingA: 16 },
  },
  {
    id: "strip-tri-16",
    category: "Électricité",
    name: "Multiprise tri 16 A — 3 prises",
    reference: "MP-T16",
    shape: "rectangle",
    widthM: 0.5,
    heightM: 0.3,
    unit: "u",
    style: STRIP_STYLE,
    electrical: { role: "strip", phases: "tri", outlets: 3, ratingA: 16 },
  },
  {
    id: "strip-tri-32",
    category: "Électricité",
    name: "Multiprise tri 32 A — 3 prises",
    reference: "MP-T32",
    shape: "rectangle",
    widthM: 0.6,
    heightM: 0.35,
    unit: "u",
    style: STRIP_STYLE,
    electrical: { role: "strip", phases: "tri", outlets: 3, ratingA: 32 },
  },

  cableItem("cable-3g25-25", "Câble 3G2.5", "H07RN-F 3G2.5", 25, {
    role: "cable",
    phases: "mono",
    sectionMm2: 2.5,
    ratingA: 16,
  }),
  cableItem("cable-5g6-25", "Câble 5G6", "H07RN-F 5G6", 25, {
    role: "cable",
    phases: "tri",
    sectionMm2: 6,
    ratingA: 32,
  }),
  cableItem("cable-5g16-25", "Câble 5G16", "H07RN-F 5G16", 25, {
    role: "cable",
    phases: "tri",
    sectionMm2: 16,
    ratingA: 63,
  }),
  {
    id: "light",
    category: "Électricité",
    name: "Point lumineux",
    reference: "LUM",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: { fill: "#fef08a", stroke: "#a16207", strokeWidth: 0.06, opacity: 1 },
    electrical: { role: "load", phases: "mono", powerW: 150 },
  },
  {
    id: "load-fridge",
    category: "Électricité",
    name: "Réfrigérateur",
    reference: "FRIGO",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 500 },
  },
  {
    id: "load-fryer",
    category: "Électricité",
    name: "Friteuse 3,5 kW",
    reference: "FRIT",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 3500 },
  },
  {
    id: "load-sound",
    category: "Électricité",
    name: "Sonorisation 3 kW",
    reference: "SONO",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 3000 },
  },
  {
    id: "load-coffee",
    category: "Électricité",
    name: "Percolateur / cafetière 2 kW",
    reference: "CAFE-2",
    shape: "circle",
    radiusM: 0.25,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 2000 },
  },
  {
    id: "load-espresso",
    category: "Électricité",
    name: "Machine à café pro 3 kW",
    reference: "EXPR-3",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 3000 },
  },
  {
    id: "load-kettle",
    category: "Électricité",
    name: "Bouilloire 2 kW",
    reference: "BOUIL-2",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 2000 },
  },
  {
    id: "load-crepe",
    category: "Électricité",
    name: "Crêpière 3 kW",
    reference: "CREP-3",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 3000 },
  },
  {
    id: "load-waffle",
    category: "Électricité",
    name: "Gaufrier 2 kW",
    reference: "GAUF-2",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 2000 },
  },
  {
    id: "load-plancha-mono",
    category: "Électricité",
    name: "Plancha 3 kW",
    reference: "PLAN-3",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 3000 },
  },
  {
    id: "load-microwave",
    category: "Électricité",
    name: "Micro-ondes 1,2 kW",
    reference: "MO-1",
    shape: "circle",
    radiusM: 0.25,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 1200 },
  },
  {
    id: "load-beer-tap",
    category: "Électricité",
    name: "Tireuse à bière 800 W",
    reference: "TIR-800",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 800 },
  },
  {
    id: "load-ice",
    category: "Électricité",
    name: "Machine à glaçons 500 W",
    reference: "GLAC-500",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 500 },
  },
  {
    id: "load-showcase",
    category: "Électricité",
    name: "Vitrine réfrigérée 400 W",
    reference: "VITR-400",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 400 },
  },
  {
    id: "load-freezer",
    category: "Électricité",
    name: "Congélateur 300 W",
    reference: "CONG-300",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 300 },
  },
  {
    id: "load-heater-mono",
    category: "Électricité",
    name: "Chauffage d'appoint 2 kW",
    reference: "CHAUF-2",
    shape: "circle",
    radiusM: 0.25,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 2000 },
  },
  {
    id: "load-dj",
    category: "Électricité",
    name: "Régie son / DJ 1 kW",
    reference: "DJ-1",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 1000 },
  },
  {
    id: "load-speaker",
    category: "Électricité",
    name: "Enceinte amplifiée 500 W",
    reference: "ENC-500",
    shape: "circle",
    radiusM: 0.25,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 500 },
  },
  {
    id: "load-screen",
    category: "Électricité",
    name: "Écran LED / TV 300 W",
    reference: "ECR-300",
    shape: "circle",
    radiusM: 0.3,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 300 },
  },
  {
    id: "load-garland",
    category: "Électricité",
    name: "Guirlande lumineuse 200 W",
    reference: "GUIR-200",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 200 },
  },
  {
    id: "load-halogen",
    category: "Électricité",
    name: "Projecteur halogène 500 W",
    reference: "HAL-500",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 500 },
  },
  {
    id: "load-till",
    category: "Électricité",
    name: "Caisse / terminal de paiement 100 W",
    reference: "CAISSE",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 100 },
  },
  {
    id: "load-chargers",
    category: "Électricité",
    name: "Station de recharge téléphones 200 W",
    reference: "RECH-200",
    shape: "circle",
    radiusM: 0.2,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 200 },
  },
  {
    id: "load-pump",
    category: "Électricité",
    name: "Pompe à eau 750 W",
    reference: "POMPE-750",
    shape: "circle",
    radiusM: 0.25,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "mono", powerW: 750 },
  },
  {
    id: "load-coldroom",
    category: "Électricité",
    name: "Chambre froide 6 kW tri",
    reference: "CF-6T",
    shape: "circle",
    radiusM: 0.4,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 6000 },
  },
  {
    id: "load-fryer-tri",
    category: "Électricité",
    name: "Friteuse pro 9 kW tri",
    reference: "FRIT-9T",
    shape: "circle",
    radiusM: 0.4,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 9000 },
  },
  {
    id: "load-plancha-tri",
    category: "Électricité",
    name: "Plancha pro 7 kW tri",
    reference: "PLAN-7T",
    shape: "circle",
    radiusM: 0.4,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 7000 },
  },
  {
    id: "load-oven-tri",
    category: "Électricité",
    name: "Four professionnel 10 kW tri",
    reference: "FOUR-10T",
    shape: "circle",
    radiusM: 0.45,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 10000 },
  },
  {
    id: "load-dishwasher-tri",
    category: "Électricité",
    name: "Lave-vaisselle pro 7 kW tri",
    reference: "LV-7T",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 7000 },
  },
  {
    id: "load-reefer-tri",
    category: "Électricité",
    name: "Remorque frigorifique 5 kW tri",
    reference: "FRIGO-5T",
    shape: "circle",
    radiusM: 0.5,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 5000 },
  },
  {
    id: "load-heater-tri",
    category: "Électricité",
    name: "Chauffage soufflant 9 kW tri",
    reference: "CHAUF-9T",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 9000 },
  },
  {
    id: "load-aircon-tri",
    category: "Électricité",
    name: "Climatiseur mobile 7 kW tri",
    reference: "CLIM-7T",
    shape: "circle",
    radiusM: 0.4,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 7000 },
  },
  {
    id: "load-dimmer-tri",
    category: "Électricité",
    name: "Éclairage scène (gradateur) 12 kW tri",
    reference: "GRAD-12T",
    shape: "circle",
    radiusM: 0.45,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 12000 },
  },
  {
    id: "load-pa-tri",
    category: "Électricité",
    name: "Sonorisation grande scène 10 kW tri",
    reference: "SONO-10T",
    shape: "circle",
    radiusM: 0.45,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 10000 },
  },
  {
    id: "load-ev-tri",
    category: "Électricité",
    name: "Borne de recharge 11 kW tri",
    reference: "IRVE-11T",
    shape: "circle",
    radiusM: 0.35,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 11000 },
  },
  {
    id: "load-ride-tri",
    category: "Électricité",
    name: "Manège / attraction 15 kW tri",
    reference: "MAN-15T",
    shape: "circle",
    radiusM: 0.5,
    unit: "u",
    style: LOAD_STYLE,
    electrical: { role: "load", phases: "tri", powerW: 15000 },
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
    // Cables are bought by type, not by run: "Câble 1" to "Câble 12"
    // would be twelve lines of an order that is really two. So a cable is
    // listed under its designation, whatever it is called on the plan.
    const cable = isCable(object) ? cableDesignation(object.electrical) : null;
    const name = cable ? `Câble ${cable}` : object.name;
    const reference =
      object.reference?.trim() || (cable ? `H07RN-F ${cable}` : object.catalogId?.trim()) || "—";
    const hasManualUnit = Boolean(object.unit?.trim());
    const unit =
      object.unit?.trim() ||
      (object.type === "line" ? "m" : object.type === "polygon" ? "m²" : "u");
    const manualQuantity =
      Number.isFinite(object.quantity) && (object.quantity ?? 0) > 0 ? object.quantity! : 1;
    // A cable is bought by the metre it runs, whatever its unit says —
    // the catalogue's own cables carry "m" and would otherwise count 1.
    const quantity = isCable(object)
      ? cableLengthM(object)
      : !hasManualUnit && object.type === "line"
        ? polylineLengthM(object.pointsM)
        : !hasManualUnit && object.type === "polygon"
          ? polygonAreaM2(object.pointsM)
          : manualQuantity;
    const key = `${layer}\u0000${category}\u0000${reference}\u0000${name}\u0000${unit}`;
    const row = rows.get(key);
    if (row) row.quantity += quantity;
    else rows.set(key, { layer, category, reference, name, quantity, unit });
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
