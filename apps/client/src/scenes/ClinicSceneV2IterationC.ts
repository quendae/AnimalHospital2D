import Phaser from "phaser";
import {
  PATIENT_DEFINITIONS,
  createPatient,
  createPatientWorkflow,
} from "@animal-care/shared";
import { ClinicSceneV2 } from "./ClinicSceneV2";

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;
const SPILL_CLEAN_MS = 1500;

type TrailPoint = { x: number; y: number; at: number; patientId: string };

type SpillRuntime = {
  id: string;
  x: number;
  y: number;
  node: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  progressBg: Phaser.GameObjects.Rectangle;
  progressFill: Phaser.GameObjects.Rectangle;
  age: number;
  stressTicks: number;
  cleanMs: number;
};

function fitWorldCamera(scene: any, width?: number, height?: number): void {
  const camera = scene.cameras?.main as Phaser.Cameras.Scene2D.Camera | undefined;
  if (!camera) return;
  const gameSize = scene.scale?.gameSize;
  const w = Math.max(1, width ?? gameSize?.width ?? WORLD_WIDTH);
  const h = Math.max(1, height ?? gameSize?.height ?? WORLD_HEIGHT);
  const zoom = Math.min(w / WORLD_WIDTH, h / WORLD_HEIGHT);

  camera.setViewport(0, 0, w, h);
  camera.setZoom(zoom);
  camera.centerOn(WORLD_WIDTH / 2, WORLD_HEIGHT / 2);
  camera.setRoundPixels(true);
}

function occupiedSeatIndexes(scene: any): Set<number> {
  const used = new Set<number>();
  for (const runtime of scene.patients?.values?.() ?? []) {
    if (runtime.phase === "leaving") continue;
    if (Number.isInteger(runtime.seatIndex)) used.add(runtime.seatIndex);
  }
  return used;
}

function spawnPatientIntoSeat(scene: any): void {
  if (scene.waitingQueue.length >= scene.layout.patientSpawns.length) return;

  const used = occupiedSeatIndexes(scene);
  const seatIndex = scene.layout.patientSpawns.findIndex((_: unknown, index: number) => !used.has(index));
  if (seatIndex < 0) return;

  scene.patientSequence += 1;
  const definition = PATIENT_DEFINITIONS[(scene.patientSequence - 1) % PATIENT_DEFINITIONS.length];
  const patient = createPatient(definition, scene.patientSequence);
  const workflow = createPatientWorkflow(patient);
  const view = scene.createPatientView(patient);
  const target = scene.layout.patientSpawns[seatIndex];

  const runtime: any = {
    patient,
    workflow,
    view,
    phase: "arriving",
    route: [],
    moveIntent: "waiting",
    patienceMs: patient.patienceMs,
    seatIndex,
  };

  scene.patients.set(patient.id, runtime);
  scene.waitingQueue.push(patient.id);
  view.container.setPosition(scene.layout.exit.x + 12, scene.layout.exit.y);
  scene.movePatient(runtime, target, "waiting");
}

function seatWaitingPatients(scene: any): void {
  for (const runtime of scene.patients?.values?.() ?? []) {
    if (runtime.phase !== "waiting" || runtime.waitingForDestination || !Number.isInteger(runtime.seatIndex)) continue;
    const seat = scene.layout.patientSpawns[runtime.seatIndex];
    if (!seat) continue;
    runtime.view.container.setPosition(seat.x, seat.y - 8).setRotation(0).setScale(0.9);
    runtime.view.status.setText("CZEKA • MIEJSCE " + (runtime.seatIndex + 1));
  }
}

function moveAdmittedPatientOffSeat(scene: any, runtime: any): void {
  if (!runtime?.waitingForDestination) return;
  const reception = scene.layout.rooms.find((room: any) => room.kind === "reception");
  if (!reception) return;
  const holdingPoint = {
    x: reception.doorX,
    y: scene.layout.corridor.y + scene.layout.corridor.height / 2,
  };
  scene.movePatient(runtime, holdingPoint, "handoff");
}

function recordPatientTrail(scene: any): void {
  const now = scene.time.now;
  const corridor = scene.layout.corridor;
  const points = scene.__patientTrailPoints as TrailPoint[];

  for (const runtime of scene.patients?.values?.() ?? []) {
    if (runtime.phase !== "moving" && runtime.phase !== "leaving") continue;
    const x = runtime.view.container.x;
    const y = runtime.view.container.y;
    const insideCorridor =
      x > corridor.x + 42 &&
      x < corridor.x + corridor.width - 42 &&
      y > corridor.y + 14 &&
      y < corridor.y + corridor.height - 14;
    if (!insideCorridor) continue;
    if (now - (runtime.__lastTrailSampleAt ?? 0) < 280) continue;

    runtime.__lastTrailSampleAt = now;
    const last = points.at(-1);
    if (!last || Phaser.Math.Distance.Between(last.x, last.y, x, y) > 28 || last.patientId !== runtime.patient.id) {
      points.push({ x, y, at: now, patientId: runtime.patient.id });
    }
  }

  if (points.length > 120) points.splice(0, points.length - 120);
}

function chooseTrailPoint(scene: any): TrailPoint | undefined {
  const spills = scene.__maintenanceSpills as SpillRuntime[];
  const points = (scene.__patientTrailPoints as TrailPoint[]).filter((point) => {
    if (scene.time.now - point.at > 70_000) return false;
    if (Phaser.Math.Distance.Between(scene.player.x, scene.player.y, point.x, point.y) < 90) return false;
    return spills.every((spill) => Phaser.Math.Distance.Between(spill.x, spill.y, point.x, point.y) > 105);
  });
  if (!points.length) return undefined;

  const sequence = scene.__spillSequence ?? 0;
  const index = Math.abs((scene.seed * 31 + sequence * 47) % points.length);
  return points[index];
}

function spawnSpill(scene: any): boolean {
  const spills = scene.__maintenanceSpills as SpillRuntime[];
  if (!spills || spills.length >= 2) return false;
  const point = chooseTrailPoint(scene);
  if (!point) return false;

  const index = scene.__spillSequence ?? 0;
  const node = scene.add.ellipse(point.x, point.y, 66, 30, 0x72a9a2, 0.4)
    .setStrokeStyle(2, 0x4c7d79, 0.72)
    .setDepth(7);
  const label = scene.add.text(point.x, point.y - 24, "ROZLANE", {
    fontFamily: "Nunito, Segoe UI, Arial, sans-serif",
    fontSize: "9px",
    fontStyle: "normal",
    fontWeight: "900",
    color: "#315d5c",
  } as Phaser.Types.GameObjects.Text.TextStyle)
    .setOrigin(0.5)
    .setBackgroundColor("#e7f2ee")
    .setPadding(4, 1, 4, 1)
    .setDepth(8);
  label.setResolution?.(Math.min(4, Math.max(2, window.devicePixelRatio || 1)));

  const progressBg = scene.add.rectangle(point.x - 30, point.y + 27, 60, 7, 0x325452, 0.8)
    .setOrigin(0, 0.5)
    .setDepth(10)
    .setVisible(false);
  const progressFill = scene.add.rectangle(point.x - 29, point.y + 27, 58, 5, 0xa9dfc8, 1)
    .setOrigin(0, 0.5)
    .setDepth(11)
    .setScale(0, 1)
    .setVisible(false);

  spills.push({
    id: `spill-${index}`,
    x: point.x,
    y: point.y,
    node,
    label,
    progressBg,
    progressFill,
    age: 0,
    stressTicks: 0,
    cleanMs: 0,
  });
  scene.__spillSequence = index + 1;
  scene.toast("Pacjent zostawił mokry ślad na swojej trasie — przytrzymaj E, żeby wytrzeć.", 0x5b8885);
  return true;
}

function nearestSpill(scene: any, maxDistance = 78): SpillRuntime | undefined {
  let best: SpillRuntime | undefined;
  let distance = maxDistance;
  for (const spill of scene.__maintenanceSpills ?? []) {
    const current = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, spill.x, spill.y);
    if (current < distance) {
      distance = current;
      best = spill;
    }
  }
  return best;
}

function removeSpill(scene: any, spill: SpillRuntime): void {
  scene.__maintenanceSpills = (scene.__maintenanceSpills as SpillRuntime[]).filter((entry) => entry !== spill);
  spill.node.destroy();
  spill.label.destroy();
  spill.progressBg.destroy();
  spill.progressFill.destroy();
  scene.clinicStress = Math.max(0, scene.clinicStress - 4);
  scene.toast("Podłoga wytarta — przejście jest znowu bezpieczne.");
}

function updateSpillCleaning(scene: any, delta: number): void {
  const active = nearestSpill(scene);
  for (const spill of scene.__maintenanceSpills as SpillRuntime[]) {
    const selected = spill === active;
    spill.progressBg.setVisible(selected);
    spill.progressFill.setVisible(selected);

    if (!selected) {
      spill.cleanMs = 0;
      spill.progressFill.setScale(0, 1);
      continue;
    }

    if (scene.interactKey?.isDown) spill.cleanMs += delta;
    else spill.cleanMs = 0;

    const progress = Phaser.Math.Clamp(spill.cleanMs / SPILL_CLEAN_MS, 0, 1);
    spill.progressFill.setScale(progress, 1);
    if (progress >= 1) {
      removeSpill(scene, spill);
      break;
    }
  }
}

function updateMaintenance(scene: any, delta: number): void {
  if (!scene.shiftStarted || scene.remainingMs <= 0 || scene.activeMinigame || scene.results) return;
  const spills = scene.__maintenanceSpills as SpillRuntime[];

  if (scene.elapsedMs >= scene.__nextSpillAt && spills.length < 2) {
    scene.__nextSpillAt += spawnSpill(scene) ? 42_000 : 5_000;
  }

  for (const spill of spills) {
    spill.age += delta;
    const ticks = Math.floor(spill.age / 8_000);
    if (ticks > spill.stressTicks) {
      scene.clinicStress = Math.min(100, scene.clinicStress + (ticks - spill.stressTicks));
      spill.stressTicks = ticks;
    }
  }

  const hazard = nearestSpill(scene, 46);
  const body = scene.player?.body as Phaser.Physics.Arcade.Body | undefined;
  if (hazard && body) body.velocity.scale(0.7);
  updateSpillCleaning(scene, delta);
}

function updateMaintenanceHighlight(scene: any): void {
  const graphics = scene.__maintenanceHighlight as Phaser.GameObjects.Graphics | undefined;
  if (!graphics) return;
  graphics.clear();
  const spill = nearestSpill(scene);
  if (!spill) return;
  graphics.lineStyle(4, 0x9de0d4, 0.95);
  graphics.strokeEllipse(spill.x, spill.y, 78, 40);
}

export function installClinicSceneV2IterationC(): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__iterationCInstalled) return;

  const originalCreate = prototype.create;
  prototype.create = function iterationCCreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    this.__maintenanceSpills = [];
    this.__patientTrailPoints = [];
    this.__spillSequence = 0;
    this.__nextSpillAt = 28_000;
    this.__maintenanceHighlight = this.add.graphics().setDepth(96);

    fitWorldCamera(this);
    if (!this.__iterationCResizeHandler) {
      this.__iterationCResizeHandler = (gameSize: Phaser.Structs.Size) => fitWorldCamera(this, gameSize.width, gameSize.height);
      this.scale.on(Phaser.Scale.Events.RESIZE, this.__iterationCResizeHandler);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        this.scale.off(Phaser.Scale.Events.RESIZE, this.__iterationCResizeHandler);
      });
    }
    return result;
  };

  prototype.spawnPatient = function iterationCSpawnPatient(this: any) {
    spawnPatientIntoSeat(this);
  };

  const originalAdmit = prototype.admitNextPatient;
  prototype.admitNextPatient = function iterationCAdmit(this: any) {
    const patientId = this.waitingQueue.find((id: string) => this.patients.get(id)?.phase === "waiting");
    const runtime = patientId ? this.patients.get(patientId) : undefined;
    const result = originalAdmit.call(this);
    if (result && runtime) {
      runtime.seatIndex = undefined;
      moveAdmittedPatientOffSeat(this, runtime);
    }
    return result;
  };

  const originalUpdate = prototype.update;
  prototype.update = function iterationCUpdate(this: any, time: number, delta: number) {
    const result = originalUpdate.call(this, time, delta);
    seatWaitingPatients(this);
    recordPatientTrail(this);
    updateMaintenance(this, delta);
    updateMaintenanceHighlight(this);
    return result;
  };

  const originalHandleInteraction = prototype.handleInteraction;
  prototype.handleInteraction = function iterationCInteraction(this: any) {
    if (nearestSpill(this)) return;
    return originalHandleInteraction.call(this);
  };

  const originalUpdateHint = prototype.updateHint;
  prototype.updateHint = function iterationCHint(this: any) {
    originalUpdateHint.call(this);
    const spill = nearestSpill(this);
    if (!spill) return;
    const percent = Math.round(Phaser.Math.Clamp(spill.cleanMs / SPILL_CLEAN_MS, 0, 1) * 100);
    this.hintText.setText(`Przytrzymaj E — wytrzyj podłogę ${percent}%`);
  };

  const originalPing = prototype.pingPriorityTask;
  prototype.pingPriorityTask = function iterationCPing(this: any) {
    if ((this.__maintenanceSpills?.length ?? 0) > 0) {
      this.toast("Priorytet środowiskowy: wytrzyj mokry ślad na trasie pacjentów.");
      return;
    }
    return originalPing.call(this);
  };

  prototype.__iterationCInstalled = true;
}
