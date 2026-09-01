import Phaser from "phaser";
import {
  advanceWorkflow,
  currentWorkflowStep,
  type WorkflowDestination,
} from "@animal-care/shared";
import { ClinicSceneV2 } from "./ClinicSceneV2";

function stableIndex(value: string, length: number): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return length ? hash % length : 0;
}

function installHiDpiTextFactory(): void {
  const factory = Phaser.GameObjects.GameObjectFactory.prototype as any;
  if (factory.__animalCareHiDpiText) return;
  const originalText = factory.text;
  const textResolution = Math.min(3, Math.max(2, (window.devicePixelRatio || 1) * 1.5));

  factory.text = function hiDpiText(this: any, ...args: any[]) {
    const text = originalText.apply(this, args);
    if (text?.setResolution) text.setResolution(textResolution);
    return text;
  };
  factory.__animalCareHiDpiText = true;
}

function assignConcreteDestination(scene: any, runtime: any, destination: WorkflowDestination): boolean {
  if (destination !== "analyzer" && destination !== "treatment") return false;
  const kind = destination === "analyzer" ? "analyzer" : "treatment";
  const candidates = [...scene.stations.values()].filter((entry: any) => entry.station.kind === kind);
  if (!candidates.length) return false;

  let target = runtime.assignedStationId ? scene.stations.get(runtime.assignedStationId) : undefined;
  if (!target || target.station.kind !== kind) {
    target = candidates[stableIndex(runtime.patient.id, candidates.length)];
    runtime.assignedStationId = target.station.id;
  }

  if (target.mode !== "available") {
    runtime.waitingForDestination = destination;
    runtime.phase = "waiting";
    runtime.view.status.setText(`CZEKA: ${target.station.label}`);
    return true;
  }

  target.mode = "occupied";
  target.patientId = runtime.patient.id;
  runtime.stationId = target.station.id;
  runtime.waitingForDestination = undefined;
  scene.refreshStationBadge(target);
  runtime.view.status.setText(`→ ${target.station.label}`);
  scene.movePatient(runtime, scene.patientPositionAtStation(target.station), "workflow");
  return true;
}

function updateInteractionHighlight(scene: any): void {
  const graphics = scene.__interactionHighlight as Phaser.GameObjects.Graphics | undefined;
  if (!graphics) return;
  graphics.clear();
  if (scene.activeMinigame || scene.results || !scene.player) return;

  const station = scene.nearestStation?.();
  const counter = scene.nearestCounter?.();
  const item = !scene.carriedItem ? scene.nearestFloorItem?.() : undefined;
  graphics.lineStyle(4, 0xfff0a8, 0.95);

  if (station) {
    graphics.strokeRoundedRect(
      station.station.x - station.station.width / 2 - 7,
      station.station.y - station.station.height / 2 - 7,
      station.station.width + 14,
      station.station.height + 14,
      9,
    );
    return;
  }
  if (counter) {
    graphics.strokeRoundedRect(
      counter.surface.x - counter.surface.width / 2 - 7,
      counter.surface.y - counter.surface.height / 2 - 7,
      counter.surface.width + 14,
      counter.surface.height + 14,
      8,
    );
    return;
  }
  if (item) graphics.strokeCircle(item.container.x, item.container.y, 31);
}

function updatePatientMotion(scene: any): void {
  const now = scene.time?.now ?? 0;
  for (const runtime of scene.patients?.values?.() ?? []) {
    const moving = runtime.phase === "moving" || runtime.phase === "leaving";
    if (moving) {
      runtime.view.container.setRotation(Math.sin(now / 115 + stableIndex(runtime.patient.id, 10)) * 0.035);
      runtime.view.container.setScale(1, 1 + Math.sin(now / 90) * 0.025);
    } else {
      runtime.view.container.setRotation(0).setScale(1);
    }
  }
}

/** Iteration B is intentionally installed as a thin scene behaviour layer while V2 is split into systems. */
export function installClinicSceneV2IterationB(): void {
  installHiDpiTextFactory();
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__iterationBInstalled) return;

  const originalCreate = prototype.create;
  prototype.create = function iterationBCreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    this.__interactionHighlight = this.add.graphics().setDepth(95);
    return result;
  };

  const originalUpdate = prototype.update;
  prototype.update = function iterationBUpdate(this: any, ...args: any[]) {
    const result = originalUpdate.apply(this, args);
    updateInteractionHighlight(this);
    updatePatientMotion(this);
    return result;
  };

  prototype.admitNextPatient = function iterationBAdmit(this: any): boolean {
    const patientId = this.waitingQueue.find((id: string) => this.patients.get(id)?.phase === "waiting");
    if (!patientId) {
      this.toast(this.waitingQueue.length ? "Pacjent jeszcze dochodzi do poczekalni." : "Brak pacjentów w kolejce.", 0x6d7775);
      return false;
    }

    const runtime = this.patients.get(patientId);
    runtime.workflow = advanceWorkflow(runtime.workflow, { type: "admit" });
    this.waitingQueue = this.waitingQueue.filter((id: string) => id !== patientId);
    this.updatePatientProgress(runtime);

    const step = currentWorkflowStep(runtime.workflow);
    if (step?.action === "arrive" && assignConcreteDestination(this, runtime, step.destination)) {
      this.toast(`${runtime.patient.displayName}: przyjęty → ${runtime.view.status.text.replace("→ ", "")}.`);
      return true;
    }

    this.toast(`${runtime.patient.displayName}: przyjęty.`);
    return true;
  };

  prototype.sendPatientToWorkflowDestination = function iterationBSend(this: any, runtime: any) {
    const step = currentWorkflowStep(runtime.workflow);
    if (!step) return;
    if (step.action === "release") {
      runtime.view.status.setText("DO WYJŚCIA");
      this.movePatient(runtime, this.layout.exit, "exit");
      return;
    }
    if (step.action !== "arrive") return;
    assignConcreteDestination(this, runtime, step.destination);
  };

  const originalPickUp = prototype.pickUpItem;
  prototype.pickUpItem = function iterationBPickUp(this: any, item: any) {
    const result = originalPickUp.call(this, item);
    item.container.setScale(0.82);
    this.tweens.add({ targets: item.container, scaleX: 1.1, scaleY: 1.1, duration: 130, ease: "Back.Out" });
    return result;
  };

  const originalPlace = prototype.placeOnCounter;
  prototype.placeOnCounter = function iterationBPlace(this: any, counter: any, item: any) {
    const placed = originalPlace.call(this, counter, item);
    if (placed) {
      item.container.setScale(1.16);
      this.tweens.add({ targets: item.container, scaleX: 1, scaleY: 1, duration: 150, ease: "Back.Out" });
    }
    return placed;
  };

  prototype.dropCarriedItem = function iterationBSafeDrop(this: any) {
    if (!this.carriedItem) return;
    const item = this.carriedItem;
    item.location = "floor";
    // Drop almost at the player's feet. The player position is guaranteed by
    // Arcade collisions to be reachable, unlike a point projected through a
    // counter/wall in the old 54px-forward implementation.
    const x = Phaser.Math.Clamp(this.player.x + this.facing.x * 14, 28, 1252);
    const y = Phaser.Math.Clamp(this.player.y + this.facing.y * 14, 86, 692);
    item.container.setScale(1.18).setDepth(15).setPosition(x, y);
    this.carriedItem = undefined;
    this.tweens.add({ targets: item.container, scaleX: 1, scaleY: 1, duration: 150, ease: "Bounce.Out" });
    this.toast(`${item.type === "disinfectant" ? "Środek do dezynfekcji" : "Przedmiot"} odłożony obok Ciebie.`);
  };

  prototype.__iterationBInstalled = true;
}
