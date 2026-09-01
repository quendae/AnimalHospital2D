import Phaser from "phaser";
import {
  PATIENT_DEFINITIONS,
  createPatient,
  createPatientWorkflow,
} from "@animal-care/shared";
import { ClinicSceneV2 } from "./ClinicSceneV2";

const WORLD_WIDTH = 1280;
const WORLD_HEIGHT = 720;

type SpillRuntime = {
  id: string;
  x: number;
  y: number;
  node: Phaser.GameObjects.Ellipse;
  label: Phaser.GameObjects.Text;
  age: number;
  stressTicks: number;
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

function spawnSpill(scene: any): void {
  const spills = scene.__maintenanceSpills as SpillRuntime[];
  if (!spills || spills.length >= 2) return;

  const corridor = scene.layout.corridor;
  const span = Math.max(120, corridor.width - 220);
  const index = scene.__spillSequence ?? 0;
  const seedOffset = ((scene.seed * 97 + index * 211) % 997) / 997;
  const x = corridor.x + 110 + seedOffset * span;
  const y = corridor.y + corridor.height / 2 + (index % 2 === 0 ? -18 : 18);

  const node = scene.add.ellipse(x, y, 66, 30, 0x72a9a2, 0.38)
    .setStrokeStyle(2, 0x4c7d79, 0.7)
    .setDepth(7);
  const label = scene.add.text(x, y - 24, "ROZLANE", {
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

  spills.push({ id: `spill-${index}`, x, y, node, label, age: 0, stressTicks: 0 });
  scene.__spillSequence = index + 1;
  scene.toast("Rozlany płyn w korytarzu — zignorowany podnosi stres kliniki.", 0x5b8885);
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

function cleanSpill(scene: any, spill: SpillRuntime): void {
  scene.__maintenanceSpills = (scene.__maintenanceSpills as SpillRuntime[]).filter((entry) => entry !== spill);
  spill.node.destroy();
  spill.label.destroy();
  scene.consumeCarriedItem();
  scene.clinicStress = Math.max(0, scene.clinicStress - 4);
  scene.toast("Podłoga wyczyszczona — przepływ wraca do normy.");
}

function updateMaintenance(scene: any, delta: number): void {
  if (!scene.shiftStarted || scene.remainingMs <= 0 || scene.activeMinigame || scene.results) return;
  const spills = scene.__maintenanceSpills as SpillRuntime[];

  if (scene.elapsedMs >= scene.__nextSpillAt && spills.length < 2) {
    spawnSpill(scene);
    scene.__nextSpillAt += 42_000;
  }

  for (const spill of spills) {
    spill.age += delta;
    const ticks = Math.floor(spill.age / 7_000);
    if (ticks > spill.stressTicks) {
      scene.clinicStress = Math.min(100, scene.clinicStress + (ticks - spill.stressTicks));
      spill.stressTicks = ticks;
    }
  }

  const hazard = nearestSpill(scene, 48);
  const body = scene.player?.body as Phaser.Physics.Arcade.Body | undefined;
  if (hazard && body) {
    body.velocity.scale(0.68);
  }
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

/**
 * Iteration C: true renderer resize/camera fit, integrated reception seating and
 * the first environmental maintenance event. It stays as a thin behaviour layer
 * while the prototype is being split into smaller systems.
 */
export function installClinicSceneV2IterationC(): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__iterationCInstalled) return;

  const originalCreate = prototype.create;
  prototype.create = function iterationCCreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    this.__maintenanceSpills = [];
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
    if (result && runtime) runtime.seatIndex = undefined;
    return result;
  };

  const originalUpdate = prototype.update;
  prototype.update = function iterationCUpdate(this: any, time: number, delta: number) {
    const result = originalUpdate.call(this, time, delta);
    seatWaitingPatients(this);
    updateMaintenance(this, delta);
    updateMaintenanceHighlight(this);
    return result;
  };

  const originalHandleInteraction = prototype.handleInteraction;
  prototype.handleInteraction = function iterationCInteraction(this: any) {
    const spill = nearestSpill(this);
    if (spill) {
      if (this.carriedItem?.type === "disinfectant") {
        cleanSpill(this, spill);
        return;
      }
      if (!this.carriedItem) {
        this.toast("Rozlany płyn — przynieś środek do dezynfekcji.", 0x6d7775);
        return;
      }
    }
    return originalHandleInteraction.call(this);
  };

  const originalUpdateHint = prototype.updateHint;
  prototype.updateHint = function iterationCHint(this: any) {
    originalUpdateHint.call(this);
    const spill = nearestSpill(this);
    if (!spill) return;
    this.hintText.setText(
      this.carriedItem?.type === "disinfectant"
        ? "E — wyczyść rozlany płyn"
        : "Rozlany płyn • potrzebny środek do dezynfekcji",
    );
  };

  const originalPing = prototype.pingPriorityTask;
  prototype.pingPriorityTask = function iterationCPing(this: any) {
    if ((this.__maintenanceSpills?.length ?? 0) > 0) {
      this.toast("Priorytet środowiskowy: usuń rozlany płyn z korytarza.");
      return;
    }
    return originalPing.call(this);
  };

  prototype.__iterationCInstalled = true;
}
