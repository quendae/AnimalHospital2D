export type PatientSpecies = "dog" | "cat" | "rabbit";

export type ProcedureType =
  | "bandage"
  | "sampleAnalysis"
  | "eyeDrops"
  | "calming";

export type PatientPriority = "normal" | "urgent" | "critical";
export type PatientState = "queue" | "admitted" | "diagnosis" | "treatment" | "done" | "left";
export type StationKind = "reception" | "storage" | "treatment" | "analyzer" | "exit";
export type StationStatus = "available" | "occupied" | "waitingItem" | "procedure" | "dirty" | "broken";
export type ItemType = "bandage" | "sampleKit" | "eyeDrops" | "treat" | "disinfectant";
export type ShiftPhase = "briefing" | "active" | "closing" | "results";

export interface PatientDefinition {
  species: PatientSpecies;
  displayName: string;
  role: string;
  symptoms: string[];
  procedure: ProcedureType;
  requiredItem: ItemType;
  patienceMs: number;
  priority: PatientPriority;
  baseReward: number;
  treatmentStation: "treatment" | "analyzer";
  color: number;
}

export interface PatientCase extends PatientDefinition {
  id: string;
  state: PatientState;
  stress: number;
  trust: number;
  remainingPatienceMs: number;
  admittedAtMs?: number;
  treatmentStartedAtMs?: number;
  treatmentQuality?: TreatmentQuality;
}

export interface StationState {
  id: string;
  kind: StationKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  status: StationStatus;
  patientId?: string;
  accepts?: ItemType[];
}

export interface PlayerState {
  id: string;
  name: string;
  x: number;
  y: number;
  carriedItem?: ItemType;
  scoreContribution: number;
}

export interface ScoreState {
  care: number;
  tempo: number;
  safety: number;
  cooperation: number;
  coins: number;
  treated: number;
  mistakes: number;
}

export interface ShiftState {
  phase: ShiftPhase;
  shiftNumber: number;
  remainingMs: number;
  clinicStress: number;
  queue: PatientCase[];
  activePatients: PatientCase[];
  completedPatients: PatientCase[];
  stations: StationState[];
  players: PlayerState[];
  score: ScoreState;
  patientSequence: number;
  elapsedMs: number;
}

export type TreatmentQuality = "quick" | "correct" | "perfect";

export interface TreatmentResult {
  quality: TreatmentQuality;
  accuracy: number;
  durationMs: number;
}

export interface ShiftRules {
  durationMs: number;
  queueCapacity: number;
  patientSpawnIntervalMs: number;
  maxClinicStress: number;
}

export const DEFAULT_SHIFT_RULES: ShiftRules = {
  durationMs: 4 * 60_000,
  queueCapacity: 3,
  patientSpawnIntervalMs: 18_000,
  maxClinicStress: 100,
};

export function createInitialScore(): ScoreState {
  return {
    care: 0,
    tempo: 0,
    safety: 100,
    cooperation: 0,
    coins: 0,
    treated: 0,
    mistakes: 0,
  };
}

export function createShiftState(stations: StationState[], durationMs = DEFAULT_SHIFT_RULES.durationMs): ShiftState {
  return {
    phase: "briefing",
    shiftNumber: 1,
    remainingMs: durationMs,
    clinicStress: 8,
    queue: [],
    activePatients: [],
    completedPatients: [],
    stations: stations.map((station) => ({ ...station })),
    players: [],
    score: createInitialScore(),
    patientSequence: 0,
    elapsedMs: 0,
  };
}

export function beginShift(state: ShiftState): ShiftState {
  return { ...state, phase: "active" };
}

export function createPatient(definition: PatientDefinition, sequence: number): PatientCase {
  return {
    ...definition,
    id: `patient-${sequence}`,
    state: "queue",
    stress: 12,
    trust: 70,
    remainingPatienceMs: definition.patienceMs,
  };
}

export function enqueuePatient(state: ShiftState, patient: PatientCase, capacity = DEFAULT_SHIFT_RULES.queueCapacity): ShiftState {
  if (state.queue.length >= capacity || state.phase !== "active") return state;
  return {
    ...state,
    queue: [...state.queue, patient],
    patientSequence: Math.max(state.patientSequence, Number(patient.id.split("-").pop()) || state.patientSequence),
  };
}

export function admitPatient(state: ShiftState, patientId: string): ShiftState {
  const patient = state.queue.find((candidate) => candidate.id === patientId);
  if (!patient) return state;

  const admitted: PatientCase = {
    ...patient,
    state: "admitted",
    admittedAtMs: state.elapsedMs,
  };

  return {
    ...state,
    queue: state.queue.filter((candidate) => candidate.id !== patientId),
    activePatients: [...state.activePatients, admitted],
  };
}

export function assignPatientToStation(state: ShiftState, patientId: string, stationId: string): ShiftState {
  const patient = state.activePatients.find((candidate) => candidate.id === patientId);
  const station = state.stations.find((candidate) => candidate.id === stationId);
  if (!patient || !station) return state;
  if (station.status !== "available") return state;
  if (station.kind !== patient.treatmentStation) return state;

  return {
    ...state,
    activePatients: state.activePatients.map((candidate) =>
      candidate.id === patientId ? { ...candidate, state: "treatment", treatmentStartedAtMs: state.elapsedMs } : candidate,
    ),
    stations: state.stations.map((candidate) =>
      candidate.id === stationId ? { ...candidate, status: "waitingItem", patientId } : candidate,
    ),
  };
}

export function deliverRequiredItem(state: ShiftState, patientId: string, item: ItemType): ShiftState {
  const patient = state.activePatients.find((candidate) => candidate.id === patientId);
  if (!patient || patient.requiredItem !== item) return registerMistake(state, 4);

  return {
    ...state,
    stations: state.stations.map((station) =>
      station.patientId === patientId ? { ...station, status: "procedure" } : station,
    ),
  };
}

export function completeTreatment(state: ShiftState, patientId: string, result: TreatmentResult): ShiftState {
  const patient = state.activePatients.find((candidate) => candidate.id === patientId);
  if (!patient) return state;

  const qualityMultiplier = result.quality === "perfect" ? 1.35 : result.quality === "correct" ? 1 : 0.75;
  const patienceRatio = Math.max(0, patient.remainingPatienceMs / patient.patienceMs);
  const reward = Math.round(patient.baseReward * qualityMultiplier * (0.7 + patienceRatio * 0.3));
  const completed: PatientCase = {
    ...patient,
    state: "done",
    treatmentQuality: result.quality,
    stress: Math.max(0, patient.stress - Math.round(result.accuracy * 15)),
    trust: Math.min(100, patient.trust + Math.round(result.accuracy * 20)),
  };

  return {
    ...state,
    activePatients: state.activePatients.filter((candidate) => candidate.id !== patientId),
    completedPatients: [...state.completedPatients, completed],
    stations: state.stations.map((station) =>
      station.patientId === patientId ? { ...station, status: "dirty", patientId: undefined } : station,
    ),
    clinicStress: Math.max(0, state.clinicStress - 4),
    score: {
      ...state.score,
      care: state.score.care + Math.round(100 * result.accuracy * qualityMultiplier),
      tempo: state.score.tempo + Math.round(60 * patienceRatio),
      coins: state.score.coins + reward,
      treated: state.score.treated + 1,
    },
  };
}

export function cleanStation(state: ShiftState, stationId: string): ShiftState {
  return {
    ...state,
    stations: state.stations.map((station) =>
      station.id === stationId && station.status === "dirty" ? { ...station, status: "available" } : station,
    ),
  };
}

export function registerCooperation(state: ShiftState, amount = 8): ShiftState {
  return {
    ...state,
    score: {
      ...state.score,
      cooperation: state.score.cooperation + amount,
    },
  };
}

export function registerMistake(state: ShiftState, stress = 6): ShiftState {
  return {
    ...state,
    clinicStress: Math.min(DEFAULT_SHIFT_RULES.maxClinicStress, state.clinicStress + stress),
    score: {
      ...state.score,
      safety: Math.max(0, state.score.safety - stress),
      mistakes: state.score.mistakes + 1,
    },
  };
}

export function tickShift(state: ShiftState, deltaMs: number): ShiftState {
  if (state.phase !== "active") return state;

  let clinicStress = state.clinicStress;
  let score = state.score;

  const tickPatient = (patient: PatientCase): PatientCase => {
    const remainingPatienceMs = Math.max(0, patient.remainingPatienceMs - deltaMs);
    const lostPatience = remainingPatienceMs === 0 && patient.remainingPatienceMs > 0;
    if (lostPatience) {
      clinicStress = Math.min(DEFAULT_SHIFT_RULES.maxClinicStress, clinicStress + 10);
      score = {
        ...score,
        safety: Math.max(0, score.safety - 4),
        mistakes: score.mistakes + 1,
      };
    }
    return {
      ...patient,
      remainingPatienceMs,
      stress: remainingPatienceMs === 0 ? Math.min(100, patient.stress + 10) : patient.stress,
      state: remainingPatienceMs === 0 ? "left" : patient.state,
    };
  };

  const queue = state.queue.map(tickPatient).filter((patient) => patient.state !== "left");
  const activePatients = state.activePatients.map(tickPatient).filter((patient) => patient.state !== "left");
  const remainingMs = Math.max(0, state.remainingMs - deltaMs);
  const phase: ShiftPhase = remainingMs === 0 ? "results" : "active";

  return {
    ...state,
    queue,
    activePatients,
    clinicStress,
    score,
    remainingMs,
    elapsedMs: state.elapsedMs + deltaMs,
    phase,
  };
}

export function scoreTotal(score: ScoreState): number {
  return Math.max(0, score.care + score.tempo + score.safety + score.cooperation + score.coins * 2);
}

export function starRating(score: ScoreState): 0 | 1 | 2 | 3 {
  const total = scoreTotal(score);
  if (total >= 1_100) return 3;
  if (total >= 650) return 2;
  if (total >= 250) return 1;
  return 0;
}
