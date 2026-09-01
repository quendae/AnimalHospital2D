import { describe, expect, it } from "vitest";
import {
  MVP_STATIONS,
  PATIENT_DEFINITIONS,
  admitPatient,
  assignPatientToStation,
  beginShift,
  completeTreatment,
  createPatient,
  createShiftState,
  deliverRequiredItem,
  enqueuePatient,
  generateClinicLayout,
  starRating,
  tickShift,
} from "./index";

describe("clinic domain", () => {
  it("admits a queued patient without duplicating it", () => {
    let state = beginShift(createShiftState(MVP_STATIONS));
    const patient = createPatient(PATIENT_DEFINITIONS[0], 1);
    state = enqueuePatient(state, patient);
    state = admitPatient(state, patient.id);

    expect(state.queue).toHaveLength(0);
    expect(state.activePatients).toHaveLength(1);
    expect(state.activePatients[0].state).toBe("admitted");
  });

  it("requires the correct item before a procedure", () => {
    let state = beginShift(createShiftState(MVP_STATIONS));
    const patient = createPatient(PATIENT_DEFINITIONS[0], 1);
    state = enqueuePatient(state, patient);
    state = admitPatient(state, patient.id);
    state = assignPatientToStation(state, patient.id, "treatment-a");

    const mistakeState = deliverRequiredItem(state, patient.id, "eyeDrops");
    expect(mistakeState.score.mistakes).toBe(1);

    const readyState = deliverRequiredItem(state, patient.id, "bandage");
    expect(readyState.stations.find((station) => station.id === "treatment-a")?.status).toBe("procedure");
  });

  it("scores a successful treatment and dirties the station", () => {
    let state = beginShift(createShiftState(MVP_STATIONS));
    const patient = createPatient(PATIENT_DEFINITIONS[2], 1);
    state = enqueuePatient(state, patient);
    state = admitPatient(state, patient.id);
    state = assignPatientToStation(state, patient.id, "analyzer");
    state = deliverRequiredItem(state, patient.id, "sampleKit");
    state = completeTreatment(state, patient.id, { quality: "perfect", accuracy: 0.98, durationMs: 5400 });

    expect(state.completedPatients).toHaveLength(1);
    expect(state.score.treated).toBe(1);
    expect(state.score.coins).toBeGreaterThan(0);
    expect(state.stations.find((station) => station.id === "analyzer")?.status).toBe("dirty");
  });

  it("dirties and frees a station if its patient loses patience", () => {
    let state = beginShift(createShiftState(MVP_STATIONS));
    const patient = { ...createPatient(PATIENT_DEFINITIONS[0], 1), remainingPatienceMs: 10 };
    state = enqueuePatient(state, patient);
    state = admitPatient(state, patient.id);
    state = assignPatientToStation(state, patient.id, "treatment-a");
    state = tickShift(state, 20);

    expect(state.activePatients).toHaveLength(0);
    expect(state.stations.find((station) => station.id === "treatment-a")).toMatchObject({ status: "dirty", patientId: undefined });
  });

  it("ends the shift when the timer expires", () => {
    let state = beginShift(createShiftState(MVP_STATIONS, 1000));
    state = tickShift(state, 1001);
    expect(state.phase).toBe("results");
    expect(state.remainingMs).toBe(0);
  });

  it("never awards more than three stars", () => {
    expect(starRating({ care: 5000, tempo: 5000, safety: 100, cooperation: 5000, coins: 1000, treated: 20, mistakes: 0 })).toBe(3);
  });
});

describe("procedural clinic layout", () => {
  it("is deterministic for a seed and changes for another seed", () => {
    const first = generateClinicLayout(12345);
    const same = generateClinicLayout(12345);
    const different = generateClinicLayout(98765);

    expect(first).toEqual(same);
    expect(first.rooms.map((room) => room.kind)).not.toEqual(different.rooms.map((room) => room.kind));
  });

  it("always generates the required functional rooms and stations", () => {
    for (const seed of [1, 2, 3, 111, 999999]) {
      const layout = generateClinicLayout(seed);
      const roomKinds = layout.rooms.map((room) => room.kind);
      const stationKinds = layout.stations.map((station) => station.kind);

      expect(layout.rooms).toHaveLength(6);
      expect(roomKinds.filter((kind) => kind === "treatment")).toHaveLength(3);
      expect(roomKinds).toEqual(expect.arrayContaining(["reception", "storage", "analyzer"]));
      expect(roomKinds).not.toContain("waiting");
      expect(stationKinds.filter((kind) => kind === "treatment")).toHaveLength(3);
      expect(stationKinds).toEqual(expect.arrayContaining(["reception", "storage", "analyzer"]));
      expect(layout.itemSpawns).toHaveLength(5);
      expect(layout.patientSpawns).toHaveLength(3);
      expect(layout.walls.length).toBeGreaterThan(20);
    }
  });
});
