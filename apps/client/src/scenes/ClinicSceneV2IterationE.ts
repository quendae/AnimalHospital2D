import Phaser from "phaser";
import {
  ITEM_LABELS,
  PATIENT_DEFINITIONS,
  currentWorkflowStep,
  type ItemType,
  type MultiplayerPacket,
  type PatientCase,
  type ProcedureType,
} from "@animal-care/shared";
import type { P2PSession } from "../multiplayer/P2PSession";
import { ClinicSceneV2 } from "./ClinicSceneV2";

type RuntimeWindow = Window & typeof globalThis & {
  __ANIMAL_CARE_NETWORK__?: P2PSession;
  __animalCareDebug?: { getState: () => unknown };
};

type NetworkPlayerState = {
  peerId: string;
  name: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  carriedItem?: string;
};

type PatientSnapshot = {
  patient: PatientCase;
  workflow: any;
  phase: string;
  route: Array<{ x: number; y: number }>;
  moveIntent: string;
  stationId?: string;
  assignedStationId?: string;
  waitingForDestination?: string;
  patienceMs: number;
  seatIndex?: number;
  x: number;
  y: number;
  status: string;
  progress: string;
};

type ItemSnapshot = {
  id: string;
  type: ItemType;
  location: "floor" | "counter";
  counterId?: string;
  slotIndex?: number;
  x: number;
  y: number;
};

type WorldSnapshot = {
  tick: number;
  remainingMs: number;
  elapsedMs: number;
  treated: number;
  coins: number;
  mistakes: number;
  clinicStress: number;
  patientSequence: number;
  waitingQueue: string[];
  patients: PatientSnapshot[];
  stations: Array<{ id: string; mode: string; patientId?: string }>;
  items: ItemSnapshot[];
  remoteCarries: Array<{ peerId: string; type: ItemType }>;
  spills: Array<{ id: string; x: number; y: number; age: number; stressTicks: number; cleanMs: number }>;
};

type RemoteView = {
  container: Phaser.GameObjects.Container;
  carryLabel: Phaser.GameObjects.Text;
};

const PORTRAIT_TEXTURE = "patient-portraits-v1";
const SNAPSHOT_INTERVAL_MS = 120;
const PRESENCE_INTERVAL_MS = 50;
const SPILL_CLEAN_MS = 1500;

function network(scene: any): P2PSession | undefined {
  return (window as RuntimeWindow).__ANIMAL_CARE_NETWORK__;
}

function isGuest(scene: any): boolean {
  const session = network(scene);
  return Boolean(session && !session.isHost);
}

function portraitFrame(patient: PatientCase): number {
  const byName = PATIENT_DEFINITIONS.findIndex((definition) => definition.displayName === patient.displayName);
  if (byName >= 0) return byName;
  const byRole = PATIENT_DEFINITIONS.findIndex((definition) => definition.role === patient.role);
  return Math.max(0, byRole);
}

function hashTint(value: string): number {
  const palette = [0x4f9fa0, 0xc27672, 0x7b8fc8, 0xc79b55, 0x7ea36b, 0x9a79ae];
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  return palette[hash % palette.length];
}

function createPortraitPatientView(scene: any, patient: PatientCase): any {
  const shadow = scene.add.ellipse(2, 8, 53, 24, 0x173236, 0.17);
  const halo = scene.add.circle(0, 0, 31, 0xfffbf3, 1).setStrokeStyle(3, patient.color, 0.9);
  const portrait = scene.add.image(0, 0, PORTRAIT_TEXTURE, portraitFrame(patient)).setDisplaySize(56, 56);
  const status = scene.add.text(0, -44, "WCHODZI", scene.textStyle(8, "#ffffff", 900))
    .setOrigin(0.5)
    .setBackgroundColor(scene.priorityColor(patient.priority))
    .setPadding(6, 2, 6, 2);
  const progress = scene.add.text(0, 36, "1/?", scene.textStyle(8, "#344d4e", 850))
    .setOrigin(0.5)
    .setBackgroundColor("#fffaf0")
    .setPadding(5, 1, 5, 1);
  const container = scene.add.container(-100, -100, [shadow, halo, portrait, status, progress]).setDepth(27);
  container.setScale(0.82);
  scene.tweens.add({ targets: container, scaleX: 1, scaleY: 1, duration: 220, ease: "Back.Out" });
  return { container, status, progress };
}

function ensurePatientCards(scene: any): void {
  if (!scene.__patientCards) scene.__patientCards = new Map<string, any>();
  const visible = [...scene.patients.values()]
    .filter((runtime: any) => runtime.phase !== "leaving")
    .sort((a: any, b: any) => {
      const priority = { critical: 0, urgent: 1, normal: 2 } as Record<string, number>;
      return (priority[a.patient.priority] ?? 3) - (priority[b.patient.priority] ?? 3) || a.patienceMs - b.patienceMs;
    })
    .slice(0, 4);
  const visibleIds = new Set(visible.map((runtime: any) => runtime.patient.id));

  for (const [patientId, card] of scene.__patientCards as Map<string, any>) {
    if (visibleIds.has(patientId)) continue;
    scene.tweens.add({
      targets: card.container,
      x: 1320,
      alpha: 0,
      duration: 160,
      onComplete: () => card.container.destroy(true),
    });
    scene.__patientCards.delete(patientId);
  }

  visible.forEach((runtime: any, index: number) => {
    let card = scene.__patientCards.get(runtime.patient.id);
    const targetX = 1168;
    const targetY = 102 + index * 76;
    if (!card) {
      const bg = scene.add.rectangle(0, 0, 208, 66, 0xfffbf3, 0.96).setStrokeStyle(2, runtime.patient.color, 0.85);
      const portrait = scene.add.image(-72, 0, PORTRAIT_TEXTURE, portraitFrame(runtime.patient)).setDisplaySize(52, 52);
      const name = scene.add.text(-39, -22, runtime.patient.displayName, scene.textStyle(10, "#284b50", 900)).setOrigin(0, 0);
      const detail = scene.add.text(-39, -6, "", scene.textStyle(8, "#607774", 800)).setOrigin(0, 0);
      const patienceBg = scene.add.rectangle(-39, 23, 116, 6, 0xcfd8d3, 1).setOrigin(0, 0.5);
      const patience = scene.add.rectangle(-39, 23, 116, 6, 0x79ae8c, 1).setOrigin(0, 0.5);
      const container = scene.add.container(1325, targetY, [bg, portrait, name, detail, patienceBg, patience]).setDepth(205).setAlpha(0);
      card = { container, detail, patience };
      scene.__patientCards.set(runtime.patient.id, card);
      scene.tweens.add({ targets: container, x: targetX, alpha: 1, duration: 220, ease: "Cubic.Out" });
    }
    card.container.y += (targetY - card.container.y) * 0.22;
    const step = currentWorkflowStep(runtime.workflow);
    const item = step?.item ? ITEM_LABELS[step.item] : step?.action === "procedure" ? "Zabieg" : runtime.phase === "waiting" ? "Oczekuje" : "W drodze";
    card.detail.setText(`${runtime.patient.role.toUpperCase()} • ${item}`);
    const ratio = Phaser.Math.Clamp(runtime.patienceMs / runtime.patient.patienceMs, 0, 1);
    card.patience.setScale(ratio, 1);
    card.patience.setFillStyle(ratio < 0.25 ? 0xc55e56 : ratio < 0.5 ? 0xd6a44f : 0x79ae8c, 1);
    if (runtime.patient.priority === "critical" && ratio < 0.5) {
      card.container.setScale(1 + Math.sin(scene.time.now / 120) * 0.012);
    } else {
      card.container.setScale(1);
    }
  });
}

function ensureRemoteView(scene: any, state: NetworkPlayerState): RemoteView {
  if (!scene.__remoteViews) scene.__remoteViews = new Map<string, RemoteView>();
  let view = scene.__remoteViews.get(state.peerId) as RemoteView | undefined;
  if (view) return view;

  const shadow = scene.add.ellipse(0, 15, 43, 18, 0x173236, 0.18);
  const sprite = scene.add.sprite(0, 0, "intern-v2").setTint(hashTint(state.peerId));
  const label = scene.add.text(0, 34, state.name, scene.textStyle(8, "#ffffff", 900))
    .setOrigin(0.5)
    .setBackgroundColor("#294c50")
    .setPadding(5, 2, 5, 2);
  const carryLabel = scene.add.text(0, -39, "", scene.textStyle(8, "#294c50", 900))
    .setOrigin(0.5)
    .setBackgroundColor("#fff2c7")
    .setPadding(4, 2, 4, 2)
    .setVisible(false);
  const container = scene.add.container(state.x, state.y, [shadow, sprite, label, carryLabel]).setDepth(34);
  view = { container, carryLabel };
  scene.__remoteViews.set(state.peerId, view);
  return view;
}

function updateRemoteViews(scene: any): void {
  const session = network(scene);
  if (!session) return;
  const liveIds = new Set((session.state?.members ?? []).filter((member) => member.connected).map((member) => member.id));
  for (const state of scene.__networkPlayers?.values?.() ?? []) {
    if (state.peerId === session.selfId) continue;
    const view = ensureRemoteView(scene, state);
    view.container.x += (state.x - view.container.x) * 0.45;
    view.container.y += (state.y - view.container.y) * 0.45;
    view.container.setRotation(Math.sin(scene.time.now / 120 + state.x) * 0.02);
    view.carryLabel.setVisible(Boolean(state.carriedItem));
    if (state.carriedItem) view.carryLabel.setText(ITEM_LABELS[state.carriedItem] ?? state.carriedItem);
  }
  for (const [peerId, view] of scene.__remoteViews ?? []) {
    if (liveIds.has(peerId)) continue;
    view.container.destroy(true);
    scene.__remoteViews.delete(peerId);
  }
}

function makeSnapshot(scene: any): WorldSnapshot {
  const remoteCarries = [...(scene.__remoteCarriedItems?.entries?.() ?? [])]
    .filter(([, item]: [string, any]) => Boolean(item))
    .map(([peerId, item]: [string, any]) => ({ peerId, type: item.type as ItemType }));
  return {
    tick: Date.now(),
    remainingMs: scene.remainingMs,
    elapsedMs: scene.elapsedMs,
    treated: scene.treated,
    coins: scene.coins,
    mistakes: scene.mistakes,
    clinicStress: scene.clinicStress,
    patientSequence: scene.patientSequence,
    waitingQueue: [...scene.waitingQueue],
    patients: [...scene.patients.values()].map((runtime: any) => ({
      patient: runtime.patient,
      workflow: runtime.workflow,
      phase: runtime.phase,
      route: runtime.route,
      moveIntent: runtime.moveIntent,
      stationId: runtime.stationId,
      assignedStationId: runtime.assignedStationId,
      waitingForDestination: runtime.waitingForDestination,
      patienceMs: runtime.patienceMs,
      seatIndex: runtime.seatIndex,
      x: runtime.view.container.x,
      y: runtime.view.container.y,
      status: runtime.view.status.text,
      progress: runtime.view.progress.text,
    })),
    stations: [...scene.stations.values()].map((runtime: any) => ({
      id: runtime.station.id,
      mode: runtime.mode,
      patientId: runtime.patientId,
    })),
    items: scene.items
      .filter((item: any) => item.location === "floor" || item.location === "counter")
      .map((item: any) => ({
        id: item.id,
        type: item.type,
        location: item.location,
        counterId: item.counterId,
        slotIndex: item.slotIndex,
        x: item.container.x,
        y: item.container.y,
      })),
    remoteCarries,
    spills: (scene.__maintenanceSpills ?? []).map((spill: any) => ({
      id: spill.id,
      x: spill.x,
      y: spill.y,
      age: spill.age,
      stressTicks: spill.stressTicks,
      cleanMs: spill.cleanMs,
    })),
  };
}

function createNetworkSpill(scene: any, data: WorldSnapshot["spills"][number]): any {
  const node = scene.add.ellipse(data.x, data.y, 66, 30, 0x72a9a2, 0.4).setStrokeStyle(2, 0x4c7d79, 0.72).setDepth(7);
  const label = scene.add.text(data.x, data.y - 24, "ROZLANE", scene.textStyle(9, "#315d5c", 900))
    .setOrigin(0.5).setBackgroundColor("#e7f2ee").setPadding(4, 1, 4, 1).setDepth(8);
  const progressBg = scene.add.rectangle(data.x - 30, data.y + 27, 60, 7, 0x325452, 0.8).setOrigin(0, 0.5).setDepth(10).setVisible(false);
  const progressFill = scene.add.rectangle(data.x - 29, data.y + 27, 58, 5, 0xa9dfc8, 1).setOrigin(0, 0.5).setDepth(11).setScale(0, 1).setVisible(false);
  return { ...data, node, label, progressBg, progressFill };
}

function applySnapshot(scene: any, snapshot: WorldSnapshot): void {
  if ((scene.__lastSnapshotTick ?? 0) >= snapshot.tick) return;
  scene.__lastSnapshotTick = snapshot.tick;
  scene.remainingMs = snapshot.remainingMs;
  scene.elapsedMs = snapshot.elapsedMs;
  scene.treated = snapshot.treated;
  scene.coins = snapshot.coins;
  scene.mistakes = snapshot.mistakes;
  scene.clinicStress = snapshot.clinicStress;
  scene.patientSequence = snapshot.patientSequence;
  scene.waitingQueue = [...snapshot.waitingQueue];

  for (const stationState of snapshot.stations) {
    const runtime = scene.stations.get(stationState.id);
    if (!runtime) continue;
    runtime.mode = stationState.mode;
    runtime.patientId = stationState.patientId;
    scene.refreshStationBadge(runtime);
  }

  const patientIds = new Set(snapshot.patients.map((entry) => entry.patient.id));
  for (const entry of snapshot.patients) {
    let runtime = scene.patients.get(entry.patient.id);
    if (!runtime) {
      const view = scene.createPatientView(entry.patient);
      runtime = {
        patient: entry.patient,
        workflow: entry.workflow,
        view,
        phase: entry.phase,
        route: entry.route,
        moveIntent: entry.moveIntent,
        patienceMs: entry.patienceMs,
      };
      scene.patients.set(entry.patient.id, runtime);
    }
    runtime.patient = entry.patient;
    runtime.workflow = entry.workflow;
    runtime.phase = entry.phase;
    runtime.route = entry.route;
    runtime.moveIntent = entry.moveIntent;
    runtime.stationId = entry.stationId;
    runtime.assignedStationId = entry.assignedStationId;
    runtime.waitingForDestination = entry.waitingForDestination;
    runtime.patienceMs = entry.patienceMs;
    runtime.seatIndex = entry.seatIndex;
    runtime.view.container.setPosition(entry.x, entry.y);
    runtime.view.status.setText(entry.status);
    runtime.view.progress.setText(entry.progress);
  }
  for (const [patientId, runtime] of [...scene.patients.entries()] as Array<[string, any]>) {
    if (patientIds.has(patientId)) continue;
    runtime.view.container.destroy(true);
    scene.patients.delete(patientId);
  }

  const snapshotItems = new Map(snapshot.items.map((item) => [item.id, item]));
  for (const itemState of snapshot.items) {
    let item = scene.items.find((candidate: any) => candidate.id === itemState.id);
    if (!item) {
      item = scene.makeWorldItem(itemState.id, itemState.type, itemState.x, itemState.y);
      scene.items.push(item);
    }
    item.location = itemState.location;
    item.counterId = itemState.counterId;
    item.slotIndex = itemState.slotIndex;
    item.container.setPosition(itemState.x, itemState.y).setVisible(true).setDepth(itemState.location === "counter" ? 17 : 15);
  }
  for (const item of [...scene.items] as any[]) {
    if (item.location === "carried" || snapshotItems.has(item.id)) continue;
    item.container.destroy(true);
    scene.items = scene.items.filter((candidate: any) => candidate !== item);
  }
  for (const counter of scene.counters.values() as Iterable<any>) counter.slots.fill(undefined);
  for (const item of scene.items as any[]) {
    if (item.location !== "counter" || !item.counterId || item.slotIndex === undefined) continue;
    const counter = scene.counters.get(item.counterId);
    if (counter) counter.slots[item.slotIndex] = item;
  }
  for (const counter of scene.counters.values() as Iterable<any>) scene.refreshCounterBadge(counter);

  const spillIds = new Set(snapshot.spills.map((spill) => spill.id));
  const localSpills = scene.__maintenanceSpills ?? [];
  for (const spillState of snapshot.spills) {
    let spill = localSpills.find((candidate: any) => candidate.id === spillState.id);
    if (!spill) {
      spill = createNetworkSpill(scene, spillState);
      localSpills.push(spill);
    }
    spill.age = spillState.age;
    spill.stressTicks = spillState.stressTicks;
    spill.cleanMs = spillState.cleanMs;
  }
  for (const spill of [...localSpills]) {
    if (spillIds.has(spill.id)) continue;
    spill.node.destroy(); spill.label.destroy(); spill.progressBg.destroy(); spill.progressFill.destroy();
    localSpills.splice(localSpills.indexOf(spill), 1);
  }

  const selfId = network(scene)?.selfId;
  scene.__selfNetworkCarry = snapshot.remoteCarries.find((entry) => entry.peerId === selfId)?.type;
}

function removeHostSpill(scene: any, spillId: string): void {
  const spill = (scene.__maintenanceSpills ?? []).find((candidate: any) => candidate.id === spillId);
  if (!spill) return;
  scene.__maintenanceSpills = scene.__maintenanceSpills.filter((candidate: any) => candidate !== spill);
  spill.node.destroy(); spill.label.destroy(); spill.progressBg.destroy(); spill.progressFill.destroy();
  scene.clinicStress = Math.max(0, scene.clinicStress - 4);
}

function withRemotePlayerContext(scene: any, peerId: string, fn: () => void): void {
  const state = scene.__networkPlayers?.get(peerId) as NetworkPlayerState | undefined;
  if (!state) return;
  if (!scene.__remoteCarriedItems) scene.__remoteCarriedItems = new Map<string, any>();
  const saved = {
    x: scene.player.x,
    y: scene.player.y,
    facingX: scene.facing.x,
    facingY: scene.facing.y,
    carriedItem: scene.carriedItem,
  };
  scene.player.setPosition(state.x, state.y);
  scene.facing.set(state.facingX, state.facingY);
  scene.carriedItem = scene.__remoteCarriedItems.get(peerId);
  try {
    fn();
    if (scene.carriedItem) scene.__remoteCarriedItems.set(peerId, scene.carriedItem);
    else scene.__remoteCarriedItems.delete(peerId);
  } finally {
    scene.carriedItem = saved.carriedItem;
    scene.player.setPosition(saved.x, saved.y);
    scene.facing.set(saved.facingX, saved.facingY);
  }
}

function updateRemoteCarries(scene: any): void {
  for (const [peerId, item] of scene.__remoteCarriedItems?.entries?.() ?? []) {
    const state = scene.__networkPlayers?.get(peerId) as NetworkPlayerState | undefined;
    if (!state || !item) continue;
    item.location = "carried";
    item.container.setVisible(true).setDepth(44).setPosition(state.x + state.facingX * 8, state.y - 46);
  }
}

function pulseInteraction(scene: any): void {
  if (!scene.__interactionPulse) scene.__interactionPulse = scene.add.graphics().setDepth(94);
  const graphics = scene.__interactionPulse as Phaser.GameObjects.Graphics;
  graphics.clear();
  const age = scene.time.now - (scene.__lastInteractionPulseAt ?? -9999);
  if (age > 260) return;
  const t = age / 260;
  graphics.lineStyle(3, 0xfff2ad, 0.85 * (1 - t));
  graphics.strokeCircle(scene.player.x, scene.player.y, 24 + t * 25);
}

export function installClinicSceneV2IterationE(): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__iterationEInstalled) return;

  const originalPreload = prototype.preload;
  prototype.preload = function iterationEPreload(this: any, ...args: any[]) {
    originalPreload?.apply(this, args);
    this.load.spritesheet(PORTRAIT_TEXTURE, "/portraits/patient-portraits.svg", { frameWidth: 128, frameHeight: 128 });
  };

  prototype.createPatientView = function iterationEPatientView(this: any, patient: PatientCase) {
    return createPortraitPatientView(this, patient);
  };

  const originalCreate = prototype.create;
  prototype.create = function iterationECreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    this.__networkPlayers = new Map<string, NetworkPlayerState>();
    this.__remoteCarriedItems = new Map<string, any>();
    this.__remoteViews = new Map<string, RemoteView>();
    this.__patientCards = new Map<string, any>();
    this.__lastSnapshotAt = 0;
    this.__lastPresenceAt = 0;
    this.__guestSpillHoldMs = 0;
    this.__networkBadge = this.add.text(18, 46, "", this.textStyle(8, "#d9ece7", 900)).setDepth(220);

    const session = network(this);
    if (session) {
      session.onTransport((transport) => {
        const label = transport === "p2p" ? "P2P" : transport === "relay" ? "RELAY" : "ŁĄCZENIE";
        this.__networkBadge.setText(`${session.isHost ? "HOST" : "GOŚĆ"} • ${session.roomCode ?? "-----"} • ${label}`);
      });
      session.onPacket((packet, fromId) => this.__handleNetworkPacket(packet, fromId));
      session.onRoomState((state) => {
        for (const member of state.members) {
          const existing = this.__networkPlayers.get(member.id);
          if (existing) existing.name = member.name;
        }
      });
      this.startShift();
      if (!session.isHost) {
        this.nextPatientAt = Number.POSITIVE_INFINITY;
        this.__nextSpillAt = Number.POSITIVE_INFINITY;
      }
    }

    (window as RuntimeWindow).__animalCareDebug = {
      getState: () => ({
        multiplayer: Boolean(session),
        role: session ? (session.isHost ? "host" : "guest") : "solo",
        roomCode: session?.roomCode,
        patients: this.patients.size,
        remotePlayers: this.__remoteViews.size,
        shiftStarted: this.shiftStarted,
        remainingMs: this.remainingMs,
      }),
    };
    return result;
  };

  const originalPatience = prototype.updatePatientPatience;
  prototype.updatePatientPatience = function iterationEPatience(this: any, delta: number) {
    if (isGuest(this)) return;
    return originalPatience.call(this, delta);
  };

  const originalHandleInteraction = prototype.handleInteraction;
  prototype.handleInteraction = function iterationEInteraction(this: any) {
    const session = network(this);
    this.__lastInteractionPulseAt = this.time.now;
    if (!session || session.isHost) return originalHandleInteraction.call(this);

    const station = this.nearestStation?.();
    if (station?.mode === "ready" && station.patientId && !this.__selfNetworkCarry) {
      session.sendToHost({ kind: "procedure-request", stationId: station.station.id });
      this.toast("Czekam na potwierdzenie zabiegu od hosta…", 0x5b8885);
      return;
    }

    session.sendToHost({
      kind: "interact",
      x: this.player.x,
      y: this.player.y,
      facingX: this.facing.x,
      facingY: this.facing.y,
    });
  };

  const originalFinishProcedure = prototype.finishProcedure;
  prototype.finishProcedure = function iterationEFinishProcedure(this: any, patientId: string, procedure: ProcedureType, accuracy: number) {
    const session = network(this);
    if (!session || session.isHost) return originalFinishProcedure.call(this, patientId, procedure, accuracy);
    this.activeMinigame?.container.destroy(true);
    this.activeMinigame = undefined;
    session.sendToHost({ kind: "procedure-result", patientId, procedure, accuracy });
    this.toast("Wynik zabiegu wysłany do hosta.");
  };

  prototype.__handleNetworkPacket = function iterationENetworkPacket(this: any, packet: MultiplayerPacket, fromId: string) {
    const session = network(this);
    if (!session) return;

    if (packet.kind === "player-state") {
      this.__networkPlayers.set(packet.peerId, packet as NetworkPlayerState);
      return;
    }
    if (packet.kind === "world-snapshot" && !session.isHost) {
      applySnapshot(this, packet.snapshot as WorldSnapshot);
      return;
    }
    if (packet.kind === "interact" && session.isHost) {
      const previous = this.__networkPlayers.get(fromId) ?? { peerId: fromId, name: "Gracz", x: packet.x, y: packet.y, facingX: packet.facingX, facingY: packet.facingY };
      this.__networkPlayers.set(fromId, { ...previous, x: packet.x, y: packet.y, facingX: packet.facingX, facingY: packet.facingY });
      withRemotePlayerContext(this, fromId, () => originalHandleInteraction.call(this));
      return;
    }
    if (packet.kind === "procedure-request" && session.isHost) {
      const station = this.stations.get(packet.stationId);
      const runtime = station?.patientId ? this.patients.get(station.patientId) : undefined;
      const step = runtime ? currentWorkflowStep(runtime.workflow) : undefined;
      if (station?.mode === "ready" && runtime && step?.action === "procedure" && step.procedure) {
        session.sendTo(fromId, { kind: "procedure-approved", patientId: runtime.patient.id, procedure: step.procedure });
      }
      return;
    }
    if (packet.kind === "procedure-approved" && !session.isHost) {
      const runtime = this.patients.get(packet.patientId);
      if (runtime && !this.activeMinigame) this.startMinigame(runtime, packet.procedure as ProcedureType);
      return;
    }
    if (packet.kind === "procedure-result" && session.isHost) {
      originalFinishProcedure.call(this, packet.patientId, packet.procedure as ProcedureType, packet.accuracy);
      return;
    }
    if (packet.kind === "clean-spill" && session.isHost) {
      removeHostSpill(this, packet.spillId);
    }
  };

  const originalUpdate = prototype.update;
  prototype.update = function iterationEUpdate(this: any, time: number, delta: number) {
    const result = originalUpdate.call(this, time, delta);
    const session = network(this);

    ensurePatientCards(this);
    pulseInteraction(this);
    updateRemoteViews(this);
    updateRemoteCarries(this);

    if (!session || !this.player) return result;

    if (time - this.__lastPresenceAt >= PRESENCE_INTERVAL_MS) {
      const carried = session.isHost ? this.carriedItem?.type : this.__selfNetworkCarry;
      const presence: MultiplayerPacket = {
        kind: "player-state",
        peerId: session.selfId ?? "local",
        name: session.name,
        x: this.player.x,
        y: this.player.y,
        facingX: this.facing.x,
        facingY: this.facing.y,
        carriedItem: carried,
      };
      session.broadcast(presence);
      this.__lastPresenceAt = time;
    }

    if (session.isHost && time - this.__lastSnapshotAt >= SNAPSHOT_INTERVAL_MS) {
      session.broadcast({ kind: "world-snapshot", snapshot: makeSnapshot(this) });
      this.__lastSnapshotAt = time;
    }

    if (!session.isHost) {
      const nearestSpill = (this.__maintenanceSpills ?? [])
        .map((spill: any) => ({ spill, distance: Phaser.Math.Distance.Between(this.player.x, this.player.y, spill.x, spill.y) }))
        .sort((a: any, b: any) => a.distance - b.distance)[0];
      if (nearestSpill?.distance < 78 && this.interactKey?.isDown) {
        this.__guestSpillHoldMs += delta;
        if (this.__guestSpillHoldMs >= SPILL_CLEAN_MS) {
          session.sendToHost({ kind: "clean-spill", spillId: nearestSpill.spill.id });
          this.__guestSpillHoldMs = 0;
        }
      } else {
        this.__guestSpillHoldMs = 0;
      }
      if (this.__selfNetworkCarry) this.carriedText.setText(`NIESIESZ: ${ITEM_LABELS[this.__selfNetworkCarry] ?? this.__selfNetworkCarry}`);
    }

    return result;
  };

  prototype.__iterationEInstalled = true;
}
