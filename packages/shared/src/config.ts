import type { PatientDefinition, StationState } from "./domain";

export const PATIENT_DEFINITIONS: PatientDefinition[] = [
  {
    species: "dog",
    displayName: "Pies listonosz",
    role: "listonosz",
    symptoms: ["skaleczona łapa", "brudna sierść", "kuleje"],
    procedure: "bandage",
    requiredItem: "bandage",
    patienceMs: 75_000,
    priority: "urgent",
    baseReward: 48,
    treatmentStation: "treatment",
    color: 0xd9a15d,
  },
  {
    species: "cat",
    displayName: "Kot astronauta",
    role: "astronauta",
    symptoms: ["zawroty głowy", "zmęczenie", "nierówny puls"],
    procedure: "eyeDrops",
    requiredItem: "eyeDrops",
    patienceMs: 92_000,
    priority: "normal",
    baseReward: 42,
    treatmentStation: "treatment",
    color: 0x8796a7,
  },
  {
    species: "rabbit",
    displayName: "Królik ogrodnik",
    role: "ogrodnik",
    symptoms: ["swędzenie", "ślady pasożytów", "niepokój"],
    procedure: "sampleAnalysis",
    requiredItem: "sampleKit",
    patienceMs: 84_000,
    priority: "urgent",
    baseReward: 55,
    treatmentStation: "analyzer",
    color: 0xe7d7c6,
  },
  {
    species: "dog",
    displayName: "Pies ratownik",
    role: "ratownik",
    symptoms: ["wysoki stres", "drżenie", "niepokój"],
    procedure: "calming",
    requiredItem: "treat",
    patienceMs: 68_000,
    priority: "critical",
    baseReward: 62,
    treatmentStation: "treatment",
    color: 0xb67b4c,
  },
];

export const MVP_STATIONS: StationState[] = [
  { id: "reception", kind: "reception", label: "RECEPCJA", x: 410, y: 326, width: 190, height: 72, status: "available" },
  { id: "storage", kind: "storage", label: "MAGAZYN", x: 535, y: 160, width: 180, height: 76, status: "available", accepts: ["bandage", "sampleKit", "eyeDrops", "treat", "disinfectant"] },
  { id: "treatment-a", kind: "treatment", label: "GABINET A", x: 795, y: 235, width: 180, height: 110, status: "available", accepts: ["bandage", "eyeDrops", "treat"] },
  { id: "treatment-b", kind: "treatment", label: "GABINET B", x: 795, y: 445, width: 180, height: 110, status: "available", accepts: ["bandage", "eyeDrops", "treat"] },
  { id: "analyzer", kind: "analyzer", label: "ANALIZATOR", x: 555, y: 62, width: 170, height: 74, status: "available", accepts: ["sampleKit"] },
  { id: "exit", kind: "exit", label: "WYJŚCIE", x: 485, y: 612, width: 150, height: 56, status: "available" },
];

export const ITEM_LABELS: Record<string, string> = {
  bandage: "Bandaż",
  sampleKit: "Zestaw próbek",
  eyeDrops: "Krople",
  treat: "Przysmak",
  disinfectant: "Środek do dezynfekcji",
};

export const PROCEDURE_LABELS: Record<string, string> = {
  bandage: "Bandażowanie",
  sampleAnalysis: "Analiza próbki",
  eyeDrops: "Krople do oczu",
  calming: "Uspokajanie",
};
