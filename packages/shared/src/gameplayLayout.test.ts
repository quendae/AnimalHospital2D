import { describe, expect, it } from "vitest";
import { generateClinicLayout, generateGameplayLayoutExtras, routeThroughClinic } from "./index";

describe("gameplay layout extras", () => {
  it("adds staging counters to every work room type that needs them", () => {
    for (const seed of [1, 2, 77, 8123]) {
      const layout = generateClinicLayout(seed);
      const extras = generateGameplayLayoutExtras(layout);
      const workRooms = layout.rooms.filter((room) => ["storage", "analyzer", "treatment"].includes(room.kind));

      expect(extras.counters).toHaveLength(workRooms.length);
      for (const room of workRooms) {
        expect(extras.counters.some((counter) => counter.roomId === room.id)).toBe(true);
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
