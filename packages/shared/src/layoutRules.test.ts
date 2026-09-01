import { describe, expect, it } from "vitest";
import { generateClinicLayout } from "./layout";

describe("clinic layout intake contract", () => {
  it("always places waiting room directly beside reception", () => {
    for (const seed of [1, 2, 3, 7, 42, 1337, 9001, 6608106]) {
      const layout = generateClinicLayout(seed);
      const waitingIndex = layout.rooms.findIndex((room) => room.kind === "waiting");
      const receptionIndex = layout.rooms.findIndex((room) => room.kind === "reception");

      expect(waitingIndex).toBeGreaterThanOrEqual(0);
      expect(receptionIndex).toBeGreaterThanOrEqual(0);
      expect(Math.floor(waitingIndex / 3)).toBe(Math.floor(receptionIndex / 3));
      expect(Math.abs((waitingIndex % 3) - (receptionIndex % 3))).toBe(1);
    }
  });

  it("keeps every supply spawn inside storage and away from the supply table", () => {
    for (const seed of [1, 5, 17, 81, 512, 6608106]) {
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
