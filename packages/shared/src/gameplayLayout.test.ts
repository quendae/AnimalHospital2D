import { describe, expect, it } from "vitest";
import { generateClinicLayout, generateGameplayLayoutExtras, routeThroughClinic } from "./index";

describe("gameplay layout extras", () => {
  it("adds staging counters to diagnostics and treatment rooms", () => {
    for (const seed of [1, 2, 77, 8123]) {
      const layout = generateClinicLayout(seed);
      const extras = generateGameplayLayoutExtras(layout);
      const workRooms = layout.rooms.filter((room) => ["analyzer", "treatment"].includes(room.kind));

      expect(extras.counters).toHaveLength(workRooms.length);
      for (const room of workRooms) {
        expect(extras.counters.some((counter) => counter.roomId === room.id)).toBe(true);
      }
      expect(extras.counters.some((counter) => layout.rooms.find((room) => room.id === counter.roomId)?.kind === "storage")).toBe(false);
    }
  });

  it("creates one dedicated reachable storage cabinet for every supply type", () => {
    for (const seed of [1, 42, 99, 6226743]) {
      const layout = generateClinicLayout(seed);
      const extras = generateGameplayLayoutExtras(layout);
      const storage = layout.rooms.find((room) => room.kind === "storage")!;
      const types = extras.supplyCabinets.map((cabinet) => cabinet.item);

      expect(extras.supplyCabinets).toHaveLength(5);
      expect(new Set(types).size).toBe(5);
      expect(types).toEqual(expect.arrayContaining(["bandage", "sampleKit", "eyeDrops", "treat", "disinfectant"]));

      for (const cabinet of extras.supplyCabinets) {
        expect(cabinet.roomId).toBe(storage.id);
        expect(cabinet.x - cabinet.width / 2).toBeGreaterThan(storage.x + 8);
        expect(cabinet.x + cabinet.width / 2).toBeLessThan(storage.x + storage.width - 8);
        expect(cabinet.y - cabinet.height / 2).toBeGreaterThan(storage.y + 8);
        expect(cabinet.y + cabinet.height / 2).toBeLessThan(storage.y + storage.height - 8);
      }
    }
  });

  it("creates one physical reception chair for every queue seat", () => {
    for (const seed of [1, 42, 99, 6226743]) {
      const layout = generateClinicLayout(seed);
      const extras = generateGameplayLayoutExtras(layout);
      const reception = layout.rooms.find((room) => room.kind === "reception")!;
      const chairs = extras.decorations.filter((entry) => entry.roomId === reception.id && entry.kind === "chair");

      expect(chairs).toHaveLength(layout.patientSpawns.length);
      for (const seat of layout.patientSpawns) {
        expect(chairs.some((chair) => chair.x === seat.x && chair.y === seat.y)).toBe(true);
      }
    }
  });

  it("keeps decorative furniture away from the central door lane", () => {
    const layout = generateClinicLayout(42);
    const extras = generateGameplayLayoutExtras(layout);

    for (const decoration of extras.decorations.filter((entry) => entry.kind !== "chair")) {
      const room = layout.rooms.find((candidate) => candidate.id === decoration.roomId)!;
      const halfWidth = decoration.width / 2;
      const overlapsDoorLane =
        decoration.x + halfWidth > room.doorX - 48 &&
        decoration.x - halfWidth < room.doorX + 48 &&
        Math.abs(decoration.y - room.doorY) < room.height * 0.45;
      expect(overlapsDoorLane).toBe(false);
    }
  });

  it("routes seated reception patients through the shared corridor to treatment", () => {
    const layout = generateClinicLayout(99);
    const treatment = layout.rooms.find((room) => room.kind === "treatment")!;
    const from = layout.patientSpawns[0];
    const target = { x: treatment.x + treatment.width / 2, y: treatment.y + treatment.height / 2 };
    const route = routeThroughClinic(layout, from, target);

    expect(route.length).toBeGreaterThanOrEqual(5);
    expect(route.some((point) => Math.abs(point.y - (layout.corridor.y + layout.corridor.height / 2)) < 1)).toBe(true);
    expect(route.at(-1)).toEqual(target);
  });
});
