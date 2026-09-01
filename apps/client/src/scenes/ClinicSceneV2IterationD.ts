import Phaser from "phaser";
import { ITEM_LABELS, type ItemType, type SupplyCabinet } from "@animal-care/shared";
import { ClinicSceneV2 } from "./ClinicSceneV2";

type CabinetRuntime = {
  cabinet: SupplyCabinet;
  node: Phaser.GameObjects.Rectangle;
};

type PatientBlocker = {
  node: Phaser.GameObjects.Arc;
};

const CABINET_DISTANCE = 72;
const PATIENT_RADIUS = 21;
const PATIENT_MIN_DISTANCE = 44;

const CABINET_COLORS: Record<ItemType, number> = {
  bandage: 0xe8e2c7,
  sampleKit: 0xaed1e3,
  eyeDrops: 0xcbd8f4,
  treat: 0xdba45c,
  disinfectant: 0x91c9be,
};

const CABINET_ICONS: Record<ItemType, string> = {
  bandage: "BD",
  sampleKit: "PR",
  eyeDrops: "KR",
  treat: "♥",
  disinfectant: "DS",
};

function drawSupplyCabinets(scene: any): void {
  scene.__supplyCabinets = new Map<string, CabinetRuntime>();
  scene.__dispensedItemSequence = 0;

  for (const cabinet of scene.extras.supplyCabinets ?? []) {
    scene.add.rectangle(cabinet.x + 3, cabinet.y + 4, cabinet.width, cabinet.height, 0x263b38, 0.16).setDepth(9);
    const node = scene.add.rectangle(
      cabinet.x,
      cabinet.y,
      cabinet.width,
      cabinet.height,
      CABINET_COLORS[cabinet.item],
      1,
    ).setDepth(12).setStrokeStyle(3, 0x566662, 0.78);

    scene.add.text(cabinet.x, cabinet.y - 4, CABINET_ICONS[cabinet.item], scene.textStyle(11, "#304b4d", 900))
      .setOrigin(0.5)
      .setDepth(13);
    scene.add.text(cabinet.x, cabinet.y + cabinet.height / 2 + 12, ITEM_LABELS[cabinet.item], scene.textStyle(7, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#506762")
      .setPadding(4, 2, 4, 2)
      .setDepth(14);

    scene.physics.add.existing(node, true);
    scene.obstacleGroup.add(node);
    scene.__supplyCabinets.set(cabinet.id, { cabinet, node });
  }
}

function nearestCabinet(scene: any): CabinetRuntime | undefined {
  let best: CabinetRuntime | undefined;
  let bestDistance = CABINET_DISTANCE;
  for (const runtime of scene.__supplyCabinets?.values?.() ?? []) {
    const cabinet = runtime.cabinet as SupplyCabinet;
    const dx = Math.max(Math.abs(scene.player.x - cabinet.x) - cabinet.width / 2, 0);
    const dy = Math.max(Math.abs(scene.player.y - cabinet.y) - cabinet.height / 2, 0);
    const distance = Math.hypot(dx, dy);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = runtime;
    }
  }
  return best;
}

function dispenseFromCabinet(scene: any, runtime: CabinetRuntime): void {
  if (scene.carriedItem) return;
  scene.__dispensedItemSequence += 1;
  const cabinet = runtime.cabinet;
  const item = scene.makeWorldItem(
    `cabinet-${cabinet.item}-${scene.__dispensedItemSequence}`,
    cabinet.item,
    cabinet.x,
    cabinet.y + 18,
  );
  scene.items.push(item);
  scene.pickUpItem(item);
  scene.toast(`${ITEM_LABELS[cabinet.item]} wyjęty z szafki.`);
}

function consumeCarriedItem(scene: any): void {
  const item = scene.carriedItem;
  if (!item) return;
  scene.detachItemFromCounter(item);
  scene.carriedItem = undefined;
  scene.items = scene.items.filter((candidate: any) => candidate !== item);
  item.location = "hidden";
  item.container.destroy(true);
}

function ensurePatientCollisionLayer(scene: any): void {
  if (scene.__patientBlockerGroup) return;
  scene.__patientBlockers = new Map<string, PatientBlocker>();
  scene.__patientBlockerGroup = scene.physics.add.group({
    allowGravity: false,
    immovable: true,
  });
  scene.physics.add.collider(scene.player, scene.__patientBlockerGroup);
}

function ensurePatientBlockers(scene: any): void {
  ensurePatientCollisionLayer(scene);

  for (const [patientId, runtime] of scene.patients.entries()) {
    if (scene.__patientBlockers.has(patientId)) continue;
    const node = scene.add.circle(runtime.view.container.x, runtime.view.container.y, PATIENT_RADIUS, 0xffffff, 0.001).setDepth(26);
    scene.physics.add.existing(node);
    const body = node.body as Phaser.Physics.Arcade.Body;
    body.setCircle(PATIENT_RADIUS);
    body.setAllowGravity(false);
    body.setImmovable(true);
    body.moves = false;
    scene.__patientBlockerGroup.add(node);
    scene.__patientBlockers.set(patientId, { node });
  }

  for (const [patientId, blocker] of [...scene.__patientBlockers.entries()] as Array<[string, PatientBlocker]>) {
    if (scene.patients.has(patientId)) continue;
    scene.__patientBlockerGroup.remove(blocker.node, true, true);
    scene.__patientBlockers.delete(patientId);
  }
}

function separatePatients(scene: any): void {
  const runtimes = [...scene.patients.values()] as any[];
  for (let first = 0; first < runtimes.length; first += 1) {
    for (let second = first + 1; second < runtimes.length; second += 1) {
      const a = runtimes[first];
      const b = runtimes[second];
      if (a.phase === "leaving" && b.phase === "leaving") continue;

      let dx = b.view.container.x - a.view.container.x;
      let dy = b.view.container.y - a.view.container.y;
      let distance = Math.hypot(dx, dy);
      if (distance >= PATIENT_MIN_DISTANCE) continue;

      if (distance < 0.001) {
        dx = first % 2 === 0 ? 1 : -1;
        dy = second % 2 === 0 ? 0.5 : -0.5;
        distance = Math.hypot(dx, dy);
      }

      const overlap = PATIENT_MIN_DISTANCE - distance;
      const nx = dx / distance;
      const ny = dy / distance;
      const pushA = a.phase === "waiting" ? 0.2 : 0.5;
      const pushB = b.phase === "waiting" ? 0.2 : 0.5;
      const divisor = Math.max(0.1, pushA + pushB);

      a.view.container.x -= nx * overlap * (pushA / divisor);
      a.view.container.y -= ny * overlap * (pushA / divisor);
      b.view.container.x += nx * overlap * (pushB / divisor);
      b.view.container.y += ny * overlap * (pushB / divisor);
    }
  }
}

function syncPatientBlockers(scene: any): void {
  for (const [patientId, blocker] of scene.__patientBlockers?.entries?.() ?? []) {
    const runtime = scene.patients.get(patientId);
    if (!runtime) continue;
    blocker.node.setPosition(runtime.view.container.x, runtime.view.container.y);
    const body = blocker.node.body as Phaser.Physics.Arcade.Body;
    body.reset(runtime.view.container.x, runtime.view.container.y);
  }
}

function updateCabinetHighlight(scene: any): void {
  const graphics = scene.__cabinetHighlight as Phaser.GameObjects.Graphics | undefined;
  if (!graphics) return;
  graphics.clear();
  if (scene.carriedItem) return;
  const runtime = nearestCabinet(scene);
  if (!runtime) return;
  const cabinet = runtime.cabinet;
  graphics.lineStyle(4, 0xffef9c, 0.96);
  graphics.strokeRoundedRect(
    cabinet.x - cabinet.width / 2 - 6,
    cabinet.y - cabinet.height / 2 - 6,
    cabinet.width + 12,
    cabinet.height + 12,
    8,
  );
}

/**
 * Iteration D owns physical supply dispensing and patient occupancy. The base
 * scene still owns carried/counter items, but consumed supplies no longer
 * respawn on the floor: cabinets are the only source of fresh stock.
 */
export function installClinicSceneV2IterationD(): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__iterationDInstalled) return;

  prototype.createWorldItems = function iterationDCreateWorldItems(this: any) {
    this.items = [];
    this.carriedItem = undefined;
    drawSupplyCabinets(this);
  };

  prototype.consumeCarriedItem = function iterationDConsume(this: any) {
    consumeCarriedItem(this);
  };

  const originalCreate = prototype.create;
  prototype.create = function iterationDCreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    ensurePatientCollisionLayer(this);
    this.__cabinetHighlight = this.add.graphics().setDepth(97);
    return result;
  };

  const originalUpdate = prototype.update;
  prototype.update = function iterationDUpdate(this: any, ...args: any[]) {
    const result = originalUpdate.apply(this, args);
    ensurePatientBlockers(this);
    separatePatients(this);
    syncPatientBlockers(this);
    updateCabinetHighlight(this);
    return result;
  };

  const originalHandleInteraction = prototype.handleInteraction;
  prototype.handleInteraction = function iterationDInteraction(this: any) {
    if (!this.carriedItem) {
      const cabinet = nearestCabinet(this);
      if (cabinet) {
        dispenseFromCabinet(this, cabinet);
        return;
      }
    }
    return originalHandleInteraction.call(this);
  };

  const originalUpdateHint = prototype.updateHint;
  prototype.updateHint = function iterationDHint(this: any) {
    originalUpdateHint.call(this);
    if (this.carriedItem) return;
    const cabinet = nearestCabinet(this);
    if (cabinet) this.hintText.setText(`E — wyjmij ${ITEM_LABELS[cabinet.cabinet.item]} z szafki`);
  };

  prototype.__iterationDInstalled = true;
}
