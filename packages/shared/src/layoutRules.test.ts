import { describe, expect, it } from "vitest";
import { generateClinicLayout } from "./layout";

describe("clinic layout intake contract", () => {
  it("integrates the waiting area into reception and uses the freed slot for treatment", () => {
    for (const seed of [1, 2, 3, 7, 42, 1337, 9001, 6608106, 6226743]) {
      const layout = generateClinicLayout(seed);
      const reception = layout.rooms.find((room) => room.kind === "reception");

      expect(reception).toBeDefined();
      expect(layout.rooms.some((room) => room.kind === "waiting")).toBe(false);
      expect(layout.rooms.filter((room) => room.kind === "treatment")).toHaveLength(3);
      expect(layout.patientSpawns).toHaveLength(3);

      for (const seat of layout.patientSpawns) {
        expect(seat.x).toBeGreaterThan(reception!.x + 24);
        expect(seat.x).toBeLessThan(reception!.x + reception!.width - 24);
        expect(seat.y).toBeGreaterThan(reception!.y + 24);
        expect(seat.y).toBeLessThan(reception!.y + reception!.height - 24);
      }
    }
  });

  it("keeps every supply spawn inside storage and away from the supply table", () => {
    for (const seed of [1, 5, 17, 81, 512, 6608106, 6226743]) {
      const layout = generateClinicLayout(seed);
      const storage = layout.rooms.find((room) => room.kind === "storage")!;
      const station = layout.stations.find((candidate) => candidate.kind === "storage")!;

      expect(layout.itemSpawns).toHaveLength(5);
      for (const spawn of layout.itemSpawns) {
        expect(spawn.x).toBeGreaterThan(storage.x + 40);
        expect(spawn.x).toBeLessThan(storage.x + storage.width - 40);
        expect(spawn.y).toBeGreaterThan(storage.y + 28);
        expect(spawn.y).toBeLessThan(storage.y + storage.height - 28);

        const dx = Math.max(Math.abs(spawn.x - station.x) - station.width / 2, 0);
        const dy = Math.max(Math.abs(spawn.y - station.y) - station.height / 2, 0);
        expect(Math.hypot(dx, dy)).toBeGreaterThan(24);
      }
    }
  });
});
