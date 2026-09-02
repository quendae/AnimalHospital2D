import Phaser from "phaser";
import {
  PATIENT_DEFINITIONS,
  createPatient,
  createPatientWorkflow,
  type ItemType,
  type ProcedureType,
} from "@animal-care/shared";
import { ClinicSceneV2 } from "../scenes/ClinicSceneV2";
import { P2PSession, type GamePacket, type HeroId, type LobbyPlayer } from "./P2PSession";

const MOVE_SPEED = 250;
const SNAPSHOT_INTERVAL = 100;
const INPUT_INTERVAL = 45;
const SPILL_CLEAN_MS = 1500;

const HERO_COLORS: Record<HeroId, number> = {
  lena: 0x2f8588,
  maks: 0xd28c46,
  iga: 0x7466a8,
  bruno: 0xb85f5b,
};

type InputState = {
  seq: number;
  x: number;
  y: number;
  interact: boolean;
  interactHeld: boolean;
  ping: boolean;
  numberChoice?: number;
  receivedAt: number;
};

type ActorRuntime = {
  sessionId: string;
  name: string;
  hero: HeroId;
  sprite: Phaser.Physics.Arcade.Sprite | Phaser.GameObjects.Sprite;
  label: Phaser.GameObjects.Text;
  facing: Phaser.Math.Vector2;
  carriedItem?: any;
  input: InputState;
};

type SnapshotPlayer = {
  sessionId: string;
  name: string;
  hero: HeroId;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  carriedItemId?: string;
};

type WorldSnapshot = {
  version: 1;
  tick: number;
  patientSequence: number;
  waitingQueue: string[];
  shift: {
    started: boolean;
    remainingMs: number;
    elapsedMs: number;
    nextPatientAt: number;
    treated: number;
    coins: number;
    mistakes: number;
    clinicStress: number;
  };
  players: SnapshotPlayer[];
  patients: Array<{
    id: string;
    sequence: number;
    patient: any;
    workflow: any;
    phase: string;
    route: any[];
    moveIntent: string;
    stationId?: string;
    waitingForDestination?: string;
    patienceMs: number;
    seatIndex?: number;
    x: number;
    y: number;
    status: string;
    progress: string;
  }>;
  stations: Array<{ id: string; mode: string; patientId?: string }>;
  items: Array<{
    id: string;
    type: ItemType;
    location: string;
    counterId?: string;
    slotIndex?: number;
    x: number;
    y: number;
    visible: boolean;
    ownerId?: string;
  }>;
  spills: Array<{ id: string; x: number; y: number; age: number; stressTicks: number; cleanMs: number }>;
};

function emptyInput(): InputState {
  return { seq: 0, x: 0, y: 0, interact: false, interactHeld: false, ping: false, receivedAt: 0 };
}

function playerFromLobby(session: P2PSession, sessionId: string): LobbyPlayer | undefined {
  return session.lobby?.players.find((player) => player.sessionId === sessionId);
}

function textureFor(scene: any, hero: HeroId): string {
  const key = `intern-${hero}`;
  return scene.textures.exists(key) ? key : "intern-v2";
}

function createActor(scene: any, player: LobbyPlayer, physical: boolean): ActorRuntime {
  const x = scene.layout.playerSpawn.x + 46;
  const y = scene.layout.playerSpawn.y;
  const sprite = physical
    ? scene.physics.add.sprite(x, y, textureFor(scene, player.hero)).setDepth(34)
    : scene.add.sprite(x, y, textureFor(scene, player.hero)).setDepth(34);

  if (physical) {
    const bodySprite = sprite as Phaser.Physics.Arcade.Sprite;
    bodySprite.setCircle(19, 5, 5);
    bodySprite.setCollideWorldBounds(true);
    scene.physics.add.collider(bodySprite, scene.obstacleGroup);
    scene.physics.add.collider(bodySprite, scene.stationGroup);
    scene.physics.add.collider(bodySprite, scene.counterGroup);
    if (scene.__patientBlockerGroup) scene.physics.add.collider(bodySprite, scene.__patientBlockerGroup);
  }

  const label = scene.add.text(x, y + 33, player.name, {
    fontFamily: "Nunito, Segoe UI, Arial, sans-serif",
    fontSize: "9px",
    fontStyle: "normal",
    fontWeight: "900",
    color: "#ffffff",
    backgroundColor: `#${HERO_COLORS[player.hero].toString(16).padStart(6, "0")}`,
    padding: { x: 5, y: 2 },
  } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(0.5).setDepth(60);
  label.setResolution?.(Math.min(4, Math.max(2, window.devicePixelRatio || 1)));

  return {
    sessionId: player.sessionId,
    name: player.name,
    hero: player.hero,
    sprite,
    label,
    facing: new Phaser.Math.Vector2(0, 1),
    input: emptyInput(),
  };
}

function destroyActor(actor: ActorRuntime): void {
  actor.label.destroy();
  actor.sprite.destroy();
}

function actorPosition(actor: ActorRuntime): { x: number; y: number } {
  return { x: actor.sprite.x, y: actor.sprite.y };
}

function updateActorLabel(actor: ActorRuntime): void {
  actor.label.setPosition(actor.sprite.x, actor.sprite.y + 34);
  if (actor.carriedItem) {
    actor.carriedItem.container
      .setPosition(actor.sprite.x + actor.facing.x * 8, actor.sprite.y - 46)
      .setDepth(45)
      .setVisible(true);
  }
}

function currentNumberChoice(scene: any): number | undefined {
  for (let index = 0; index < (scene.numberKeys?.length ?? 0); index += 1) {
    if (Phaser.Input.Keyboard.JustDown(scene.numberKeys[index])) return index + 1;
  }
  return undefined;
}

function readLocalInput(scene: any, seq: number): InputState {
  const left = scene.cursors.left.isDown || scene.wasd.left.isDown;
  const right = scene.cursors.right.isDown || scene.wasd.right.isDown;
  const up = scene.cursors.up.isDown || scene.wasd.up.isDown;
  const down = scene.cursors.down.isDown || scene.wasd.down.isDown;
  let x = (right ? 1 : 0) - (left ? 1 : 0);
  let y = (down ? 1 : 0) - (up ? 1 : 0);
  if (x || y) {
    const length = Math.hypot(x, y) || 1;
    x /= length;
    y /= length;
  }

  const interact = Phaser.Input.Keyboard.JustDown(scene.interactKey) || Phaser.Input.Keyboard.JustDown(scene.spaceKey);
  return {
    seq,
    x,
    y,
    interact,
    interactHeld: Boolean(scene.interactKey?.isDown || scene.spaceKey?.isDown),
    ping: Phaser.Input.Keyboard.JustDown(scene.pingKey),
    numberChoice: currentNumberChoice(scene),
    receivedAt: scene.time.now,
  };
}

class BridgeRuntime {
  readonly session: P2PSession;
  readonly hero: HeroId;
  readonly name: string;
  readonly actors = new Map<string, ActorRuntime>();
  private scene?: any;
  private lastSnapshotAt = 0;
  private lastInputAt = 0;
  private inputSeq = 0;
  private snapshotTick = 0;
  private latestSnapshot?: WorldSnapshot;
  private remoteMinigameOwner = "";
  private packetListener: (event: Event) => void;
  private rosterListener: (event: Event) => void;

  constructor(session: P2PSession, profile: { hero: HeroId; name: string }) {
    this.session = session;
    this.hero = profile.hero;
    this.name = profile.name;
    this.packetListener = (event) => {
      const detail = (event as CustomEvent<{ from: string; packet: GamePacket }>).detail;
      this.handlePacket(detail.from, detail.packet);
    };
    this.rosterListener = () => {
      if (this.scene) this.syncActorsFromLobby(this.scene);
    };
    this.session.addEventListener("packet", this.packetListener);
    this.session.addEventListener("roster", this.rosterListener);
  }

  attach(scene: any): void {
    this.scene = scene;
    this.syncActorsFromLobby(scene);
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.detach());
  }

  detach(): void {
    this.session.removeEventListener("packet", this.packetListener);
    this.session.removeEventListener("roster", this.rosterListener);
    for (const actor of this.actors.values()) destroyActor(actor);
    this.actors.clear();
    this.scene = undefined;
  }

  beforeHostUpdate(scene: any, delta: number): void {
    this.syncActorsFromLobby(scene);
    for (const actor of this.actors.values()) {
      const body = (actor.sprite as Phaser.Physics.Arcade.Sprite).body as Phaser.Physics.Arcade.Body | undefined;
      if (!body) continue;
      const fresh = scene.time.now - actor.input.receivedAt < 180;
      let vx = fresh ? actor.input.x : 0;
      let vy = fresh ? actor.input.y : 0;
      if (vx || vy) {
        const length = Math.hypot(vx, vy) || 1;
        vx /= length;
        vy /= length;
        actor.facing.set(vx, vy);
      }
      body.setVelocity(vx * MOVE_SPEED, vy * MOVE_SPEED);

      const spill = this.nearestSpill(scene, actor.sprite.x, actor.sprite.y);
      if (spill && actor.input.interactHeld && !scene.activeMinigame) {
        spill.cleanMs += delta;
        spill.progressBg?.setVisible(true);
        spill.progressFill?.setVisible(true).setScale(Phaser.Math.Clamp(spill.cleanMs / SPILL_CLEAN_MS, 0, 1), 1);
        if (spill.cleanMs >= SPILL_CLEAN_MS) this.removeSpill(scene, spill, actor.name);
      } else if (actor.input.interact && !scene.activeMinigame) {
        this.runInteractionAs(scene, actor);
      }

      if (actor.input.ping) scene.toast?.(`${actor.name}: potrzebna pomoc!`, HERO_COLORS[actor.hero]);
      actor.input.interact = false;
      actor.input.ping = false;
      updateActorLabel(actor);
    }
  }

  afterHostUpdate(scene: any): void {
    for (const actor of this.actors.values()) updateActorLabel(actor);
    if (scene.time.now - this.lastSnapshotAt >= SNAPSHOT_INTERVAL) {
      this.lastSnapshotAt = scene.time.now;
      this.snapshotTick += 1;
      this.session.sendPacket({ type: "snapshot", tick: this.snapshotTick, state: this.captureSnapshot(scene) });
    }
  }

  updateGuest(scene: any): void {
    this.syncActorsFromLobby(scene);
    this.inputSeq += 1;
    const input = readLocalInput(scene, this.inputSeq);

    if (scene.activeMinigame) {
      this.updateReplicaMinigame(scene, input);
      scene.stopPlayer?.();
    } else {
      scene.movePlayer?.();
      scene.updateCarriedItem?.();
      if (input.ping) scene.toast?.("Wysłano prośbę o pomoc.", 0x5c8c89);
    }

    const shouldSend = input.interact || input.ping || input.numberChoice !== undefined || scene.time.now - this.lastInputAt >= INPUT_INTERVAL;
    if (shouldSend) {
      this.lastInputAt = scene.time.now;
      this.session.sendPacket({
        type: "input",
        seq: input.seq,
        x: input.x,
        y: input.y,
        interact: input.interact,
        interactHeld: input.interactHeld,
        ping: input.ping,
        numberChoice: input.numberChoice,
      } as GamePacket);
    }

    if (this.latestSnapshot) this.applySnapshot(scene, this.latestSnapshot);
    for (const actor of this.actors.values()) updateActorLabel(actor);

    if (scene.time.now - (scene.__p2pLastUiRefresh ?? 0) > 100) {
      scene.refreshUi?.(true);
      this.updateGuestHint(scene);
      scene.__p2pLastUiRefresh = scene.time.now;
    }
  }

  updateRemoteMinigame(scene: any, time: number, original: (time: number) => void): void {
    if (!this.remoteMinigameOwner) {
      original.call(scene, time);
      return;
    }

    const actor = this.actors.get(this.remoteMinigameOwner);
    const game = scene.activeMinigame;
    if (!actor || !game) {
      this.remoteMinigameOwner = "";
      original.call(scene, time);
      return;
    }

    if (game.kind === "timing") {
      const phase = ((time - game.startedAt) % 1800) / 1800;
      game.marker.x = 640 - 185 + Math.abs(Math.sin(phase * Math.PI)) * 370;
      if (actor.input.interact) {
        const accuracy = Math.max(0, 1 - Math.abs(game.marker.x - 640) / 180);
        game.accuracy += accuracy;
        game.attempts += 1;
        game.progress.setText(`Próby: ${game.attempts} / 3   Trafienie: ${Math.round(accuracy * 100)}%`);
        actor.input.interact = false;
        if (game.attempts >= 3) scene.finishProcedure(game.patientId, game.procedure, game.accuracy / 3);
      }
      return;
    }

    const choice = actor.input.numberChoice;
    if (!choice) return;
    actor.input.numberChoice = undefined;
    if (choice === game.sequence[game.index]) game.correct += 1;
    else {
      scene.mistakes += 1;
      scene.clinicStress = Math.min(100, scene.clinicStress + 2);
    }
    game.index += 1;
    if (game.index >= game.sequence.length) scene.finishProcedure(game.patientId, game.procedure, game.correct / game.sequence.length);
    else {
      game.prompt.setText(`FILTR ${game.sequence[game.index]}`);
      game.progress.setText(`Próbka: ${game.index + 1} / ${game.sequence.length}`);
    }
  }

  finishRemoteMinigame(scene: any, patientId: string, procedure: ProcedureType, accuracy: number, original: (...args: any[]) => void): void {
    const owner = this.remoteMinigameOwner;
    original.call(scene, patientId, procedure, accuracy);
    if (owner) {
      this.session.sendPacketTo(owner, { type: "event", name: "minigame-end", payload: { patientId, accuracy } });
      this.remoteMinigameOwner = "";
    }
  }

  private handlePacket(from: string, packet: GamePacket): void {
    const scene = this.scene;
    if (!scene || !packet || typeof packet !== "object") return;

    if (packet.type === "input" && this.session.isHost) {
      const actor = this.actors.get(from);
      if (!actor || packet.seq <= actor.input.seq) return;
      actor.input = {
        seq: packet.seq,
        x: Phaser.Math.Clamp(Number(packet.x) || 0, -1, 1),
        y: Phaser.Math.Clamp(Number(packet.y) || 0, -1, 1),
        interact: Boolean(packet.interact),
        interactHeld: Boolean((packet as any).interactHeld),
        ping: Boolean(packet.ping),
        numberChoice: Number((packet as any).numberChoice) || undefined,
        receivedAt: scene.time.now,
      };
      return;
    }

    if (packet.type === "snapshot" && !this.session.isHost) {
      const snapshot = packet.state as WorldSnapshot;
      if (snapshot?.version === 1 && (!this.latestSnapshot || snapshot.tick >= this.latestSnapshot.tick)) this.latestSnapshot = snapshot;
      return;
    }

    if (packet.type === "event" && !this.session.isHost) {
      this.handleGuestEvent(scene, packet.name, packet.payload);
    }
  }

  private handleGuestEvent(scene: any, name: string, payload: any): void {
    if (name === "minigame-start") {
      const runtime = scene.patients.get(String(payload?.patientId));
      if (!runtime || scene.activeMinigame) return;
      scene.startMinigame(runtime, payload.procedure as ProcedureType);
      if (scene.activeMinigame?.kind === "sample" && Array.isArray(payload.sequence)) {
        scene.activeMinigame.sequence = payload.sequence.map((value: unknown) => Number(value));
        scene.activeMinigame.index = 0;
        scene.activeMinigame.correct = 0;
        scene.activeMinigame.prompt.setText(`FILTR ${scene.activeMinigame.sequence[0]}`);
      }
      scene.__p2pReplicaMinigame = true;
      return;
    }

    if (name === "minigame-end") {
      scene.activeMinigame?.container?.destroy(true);
      scene.activeMinigame = undefined;
      scene.__p2pReplicaMinigame = false;
    }
  }

  private runInteractionAs(scene: any, actor: ActorRuntime): void {
    const spill = this.nearestSpill(scene, actor.sprite.x, actor.sprite.y);
    if (spill) return;

    const savedPlayer = scene.player;
    const savedItem = scene.carriedItem;
    const savedFacing = scene.facing;
    const beforeMinigame = scene.activeMinigame;
    scene.player = actor.sprite;
    scene.carriedItem = actor.carriedItem;
    scene.facing = actor.facing;
    try {
      scene.handleInteraction?.();
      actor.carriedItem = scene.carriedItem;
      if (!beforeMinigame && scene.activeMinigame) {
        this.remoteMinigameOwner = actor.sessionId;
        scene.activeMinigame.container?.setVisible(false);
        this.session.sendPacketTo(actor.sessionId, {
          type: "event",
          name: "minigame-start",
          payload: {
            patientId: scene.activeMinigame.patientId,
            procedure: scene.activeMinigame.procedure,
            kind: scene.activeMinigame.kind,
            sequence: scene.activeMinigame.kind === "sample" ? scene.activeMinigame.sequence : undefined,
          },
        });
      }
    } finally {
      scene.player = savedPlayer;
      scene.carriedItem = savedItem;
      scene.facing = savedFacing;
    }
  }

  private syncActorsFromLobby(scene: any): void {
    const players = this.session.lobby?.players ?? [];
    const expected = new Set<string>();
    for (const player of players) {
      if (player.sessionId === this.session.sessionId || !player.connected) continue;
      expected.add(player.sessionId);
      const existing = this.actors.get(player.sessionId);
      if (!existing) {
        this.actors.set(player.sessionId, createActor(scene, player, this.session.isHost));
      } else {
        existing.name = player.name;
        existing.hero = player.hero;
        existing.label.setText(player.name);
        existing.sprite.setTexture(textureFor(scene, player.hero));
      }
    }

    for (const [sessionId, actor] of this.actors) {
      if (expected.has(sessionId)) continue;
      if (this.remoteMinigameOwner === sessionId) this.remoteMinigameOwner = "";
      destroyActor(actor);
      this.actors.delete(sessionId);
    }
  }

  private captureSnapshot(scene: any): WorldSnapshot {
    const players: SnapshotPlayer[] = [];
    players.push({
      sessionId: this.session.sessionId,
      name: this.name,
      hero: this.hero,
      x: scene.player.x,
      y: scene.player.y,
      facingX: scene.facing.x,
      facingY: scene.facing.y,
      carriedItemId: scene.carriedItem?.id,
    });
    for (const actor of this.actors.values()) {
      players.push({
        sessionId: actor.sessionId,
        name: actor.name,
        hero: actor.hero,
        x: actor.sprite.x,
        y: actor.sprite.y,
        facingX: actor.facing.x,
        facingY: actor.facing.y,
        carriedItemId: actor.carriedItem?.id,
      });
    }

    const ownerByItem = new Map<string, string>();
    if (scene.carriedItem?.id) ownerByItem.set(scene.carriedItem.id, this.session.sessionId);
    for (const actor of this.actors.values()) if (actor.carriedItem?.id) ownerByItem.set(actor.carriedItem.id, actor.sessionId);

    return {
      version: 1,
      tick: this.snapshotTick,
      patientSequence: scene.patientSequence,
      waitingQueue: [...scene.waitingQueue],
      shift: {
        started: scene.shiftStarted,
        remainingMs: scene.remainingMs,
        elapsedMs: scene.elapsedMs,
        nextPatientAt: scene.nextPatientAt,
        treated: scene.treated,
        coins: scene.coins,
        mistakes: scene.mistakes,
        clinicStress: scene.clinicStress,
      },
      players,
      patients: [...scene.patients.values()].map((runtime: any) => ({
        id: runtime.patient.id,
        sequence: Number(runtime.patient.id.split("-").pop()) || 1,
        patient: { ...runtime.patient },
        workflow: JSON.parse(JSON.stringify(runtime.workflow)),
        phase: runtime.phase,
        route: runtime.route.map((point: any) => ({ x: point.x, y: point.y })),
        moveIntent: runtime.moveIntent,
        stationId: runtime.stationId,
        waitingForDestination: runtime.waitingForDestination,
        patienceMs: runtime.patienceMs,
        seatIndex: runtime.seatIndex,
        x: runtime.view.container.x,
        y: runtime.view.container.y,
        status: runtime.view.status.text,
        progress: runtime.view.progress.text,
      })),
      stations: [...scene.stations.entries()].map(([id, runtime]: [string, any]) => ({ id, mode: runtime.mode, patientId: runtime.patientId })),
      items: scene.items.map((item: any) => ({
        id: item.id,
        type: item.type,
        location: item.location,
        counterId: item.counterId,
        slotIndex: item.slotIndex,
        x: item.container.x,
        y: item.container.y,
        visible: item.container.visible,
        ownerId: ownerByItem.get(item.id),
      })),
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

  private applySnapshot(scene: any, snapshot: WorldSnapshot): void {
    scene.patientSequence = snapshot.patientSequence;
    scene.waitingQueue = [...snapshot.waitingQueue];
    scene.shiftStarted = snapshot.shift.started;
    scene.remainingMs = snapshot.shift.remainingMs;
    scene.elapsedMs = snapshot.shift.elapsedMs;
    scene.nextPatientAt = snapshot.shift.nextPatientAt;
    scene.treated = snapshot.shift.treated;
    scene.coins = snapshot.shift.coins;
    scene.mistakes = snapshot.shift.mistakes;
    scene.clinicStress = snapshot.shift.clinicStress;

    this.applyPlayers(scene, snapshot.players);
    this.applyPatients(scene, snapshot.patients);
    this.applyStations(scene, snapshot.stations);
    this.applyItems(scene, snapshot.items);
    this.applySpills(scene, snapshot.spills);
  }

  private applyPlayers(scene: any, players: SnapshotPlayer[]): void {
    for (const player of players) {
      if (player.sessionId === this.session.sessionId) {
        const distance = Phaser.Math.Distance.Between(scene.player.x, scene.player.y, player.x, player.y);
        if (distance > 80) scene.player.setPosition(player.x, player.y);
        else if (distance > 18) scene.player.setPosition(Phaser.Math.Linear(scene.player.x, player.x, .28), Phaser.Math.Linear(scene.player.y, player.y, .28));
        continue;
      }
      const actor = this.actors.get(player.sessionId);
      if (!actor) continue;
      actor.sprite.setPosition(
        Phaser.Math.Linear(actor.sprite.x, player.x, .55),
        Phaser.Math.Linear(actor.sprite.y, player.y, .55),
      );
      actor.facing.set(player.facingX, player.facingY);
    }
  }

  private applyPatients(scene: any, patients: WorldSnapshot["patients"]): void {
    const expected = new Set(patients.map((entry) => entry.id));
    for (const patientSnapshot of patients) {
      let runtime = scene.patients.get(patientSnapshot.id);
      if (!runtime) {
        const definition = PATIENT_DEFINITIONS[(Math.max(1, patientSnapshot.sequence) - 1) % PATIENT_DEFINITIONS.length];
        const patient = createPatient(definition, patientSnapshot.sequence);
        const view = scene.createPatientView(patient);
        runtime = {
          patient,
          workflow: createPatientWorkflow(patient),
          view,
          phase: "waiting",
          route: [],
          moveIntent: "waiting",
          patienceMs: patient.patienceMs,
        };
        scene.patients.set(patient.id, runtime);
      }

      Object.assign(runtime.patient, patientSnapshot.patient);
      runtime.workflow = patientSnapshot.workflow;
      runtime.phase = patientSnapshot.phase;
      runtime.route = patientSnapshot.route.map((point) => ({ ...point }));
      runtime.moveIntent = patientSnapshot.moveIntent;
      runtime.stationId = patientSnapshot.stationId;
      runtime.waitingForDestination = patientSnapshot.waitingForDestination;
      runtime.patienceMs = patientSnapshot.patienceMs;
      runtime.seatIndex = patientSnapshot.seatIndex;
      runtime.view.container.setPosition(patientSnapshot.x, patientSnapshot.y);
      runtime.view.status.setText(patientSnapshot.status);
      runtime.view.progress.setText(patientSnapshot.progress);
    }

    for (const [patientId, runtime] of [...scene.patients.entries()] as Array<[string, any]>) {
      if (expected.has(patientId)) continue;
      runtime.view.container.destroy(true);
      scene.patients.delete(patientId);
    }
  }

  private applyStations(scene: any, stations: WorldSnapshot["stations"]): void {
    for (const stationSnapshot of stations) {
      const runtime = scene.stations.get(stationSnapshot.id);
      if (!runtime) continue;
      runtime.mode = stationSnapshot.mode;
      runtime.patientId = stationSnapshot.patientId;
      scene.refreshStationBadge?.(runtime);
    }
  }

  private applyItems(scene: any, items: WorldSnapshot["items"]): void {
    const expected = new Set(items.map((entry) => entry.id));
    const byId = new Map(scene.items.map((item: any) => [item.id, item]));

    for (const counter of scene.counters.values() as Iterable<any>) counter.slots.fill(undefined);
    scene.carriedItem = undefined;
    for (const actor of this.actors.values()) actor.carriedItem = undefined;

    for (const itemSnapshot of items) {
      let item = byId.get(itemSnapshot.id) as any;
      if (!item) {
        item = scene.makeWorldItem(itemSnapshot.id, itemSnapshot.type, itemSnapshot.x, itemSnapshot.y);
        scene.items.push(item);
        byId.set(item.id, item);
      }
      item.location = itemSnapshot.location;
      item.counterId = itemSnapshot.counterId;
      item.slotIndex = itemSnapshot.slotIndex;
      item.container.setPosition(itemSnapshot.x, itemSnapshot.y).setVisible(itemSnapshot.visible && itemSnapshot.location !== "hidden");

      if (itemSnapshot.counterId && itemSnapshot.slotIndex !== undefined) {
        const counter = scene.counters.get(itemSnapshot.counterId);
        if (counter) counter.slots[itemSnapshot.slotIndex] = item;
      }
      if (itemSnapshot.ownerId === this.session.sessionId) scene.carriedItem = item;
      else if (itemSnapshot.ownerId) {
        const actor = this.actors.get(itemSnapshot.ownerId);
        if (actor) actor.carriedItem = item;
      }
    }

    for (const item of [...scene.items] as any[]) {
      if (expected.has(item.id)) continue;
      item.container.destroy(true);
    }
    scene.items = scene.items.filter((item: any) => expected.has(item.id));
    for (const counter of scene.counters.values() as Iterable<any>) scene.refreshCounterBadge?.(counter);
  }

  private applySpills(scene: any, spills: WorldSnapshot["spills"]): void {
    scene.__p2pReplicaSpills ??= new Map<string, any>();
    const replicas = scene.__p2pReplicaSpills as Map<string, any>;
    const expected = new Set(spills.map((spill) => spill.id));
    for (const spill of spills) {
      let replica = replicas.get(spill.id);
      if (!replica) {
        const node = scene.add.ellipse(spill.x, spill.y, 66, 30, 0x72a9a2, .4).setStrokeStyle(2, 0x4c7d79, .72).setDepth(7);
        const label = scene.add.text(spill.x, spill.y - 24, "ROZLANE", {
          fontFamily: "Nunito, Segoe UI, Arial, sans-serif",
          fontSize: "9px",
          fontStyle: "normal",
          fontWeight: "900",
          color: "#315d5c",
          backgroundColor: "#e7f2ee",
          padding: { x: 4, y: 1 },
        } as Phaser.Types.GameObjects.Text.TextStyle).setOrigin(.5).setDepth(8);
        const progressBg = scene.add.rectangle(spill.x - 30, spill.y + 27, 60, 7, 0x325452, .8).setOrigin(0, .5).setDepth(10).setVisible(false);
        const progressFill = scene.add.rectangle(spill.x - 29, spill.y + 27, 58, 5, 0xa9dfc8, 1).setOrigin(0, .5).setDepth(11).setVisible(false);
        replica = { ...spill, node, label, progressBg, progressFill };
        replicas.set(spill.id, replica);
      }
      replica.age = spill.age;
      replica.stressTicks = spill.stressTicks;
      replica.cleanMs = spill.cleanMs;
      replica.progressFill.setScale(Phaser.Math.Clamp(spill.cleanMs / SPILL_CLEAN_MS, 0, 1), 1);
    }
    for (const [id, replica] of replicas) {
      if (expected.has(id)) continue;
      replica.node.destroy();
      replica.label.destroy();
      replica.progressBg.destroy();
      replica.progressFill.destroy();
      replicas.delete(id);
    }
  }

  private nearestSpill(scene: any, x: number, y: number): any | undefined {
    let best: any | undefined;
    let distance = 78;
    for (const spill of scene.__maintenanceSpills ?? []) {
      const current = Phaser.Math.Distance.Between(x, y, spill.x, spill.y);
      if (current < distance) {
        distance = current;
        best = spill;
      }
    }
    return best;
  }

  private removeSpill(scene: any, spill: any, cleanerName: string): void {
    scene.__maintenanceSpills = (scene.__maintenanceSpills ?? []).filter((entry: any) => entry !== spill);
    spill.node?.destroy();
    spill.label?.destroy();
    spill.progressBg?.destroy();
    spill.progressFill?.destroy();
    scene.clinicStress = Math.max(0, scene.clinicStress - 4);
    scene.toast?.(`${cleanerName} wytarł mokry ślad.`);
  }

  private updateReplicaMinigame(scene: any, input: InputState): void {
    const game = scene.activeMinigame;
    if (!game) return;
    if (game.kind === "timing") {
      const phase = ((scene.time.now - game.startedAt) % 1800) / 1800;
      game.marker.x = 640 - 185 + Math.abs(Math.sin(phase * Math.PI)) * 370;
      if (input.interact) {
        const accuracy = Math.max(0, 1 - Math.abs(game.marker.x - 640) / 180);
        game.attempts += 1;
        game.progress.setText(`Próby: ${game.attempts} / 3   Trafienie: ${Math.round(accuracy * 100)}%`);
      }
      return;
    }
    if (!input.numberChoice) return;
    game.index += 1;
    if (game.index < game.sequence.length) {
      game.prompt.setText(`FILTR ${game.sequence[game.index]}`);
      game.progress.setText(`Próbka: ${game.index + 1} / ${game.sequence.length}`);
    } else {
      game.progress.setText("Wynik wysłany do hosta…");
    }
  }

  private updateGuestHint(scene: any): void {
    if (scene.activeMinigame) return;
    const replicas: Map<string, any> | undefined = scene.__p2pReplicaSpills;
    if (replicas) {
      for (const spill of replicas.values()) {
        if (Phaser.Math.Distance.Between(scene.player.x, scene.player.y, spill.x, spill.y) < 78) {
          const percent = Math.round(Phaser.Math.Clamp(spill.cleanMs / SPILL_CLEAN_MS, 0, 1) * 100);
          scene.hintText?.setText(`Przytrzymaj E — wytrzyj podłogę ${percent}%`);
          return;
        }
      }
    }
    scene.updateHint?.();
  }
}

/**
 * Installs host-authoritative co-op on top of the existing V2 scene without
 * moving the renderer-independent rules back into the server. Colyseus is only
 * the lobby/signaling path; movement, inputs and snapshots use WebRTC.
 */
export function installClinicSceneV2Multiplayer(session: P2PSession, profile: { hero: HeroId; name: string }): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__p2pBridgeInstalled) return;
  const runtime = new BridgeRuntime(session, profile);

  const originalCreate = prototype.create;
  prototype.create = function p2pCreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    this.player.setTexture(textureFor(this, profile.hero));
    runtime.attach(this);
    this.__p2pBridgeRuntime = runtime;
    if (!this.shiftStarted) this.startShift?.();
    return result;
  };

  const originalUpdate = prototype.update;
  prototype.update = function p2pUpdate(this: any, time: number, delta: number) {
    if (!session.isHost) {
      runtime.updateGuest(this);
      return;
    }
    runtime.beforeHostUpdate(this, delta);
    const result = originalUpdate.call(this, time, delta);
    runtime.afterHostUpdate(this);
    return result;
  };

  const originalUpdateMinigame = prototype.updateMinigame;
  prototype.updateMinigame = function p2pUpdateMinigame(this: any, time: number) {
    return runtime.updateRemoteMinigame(this, time, originalUpdateMinigame);
  };

  const originalFinishProcedure = prototype.finishProcedure;
  prototype.finishProcedure = function p2pFinishProcedure(this: any, patientId: string, procedure: ProcedureType, accuracy: number) {
    return runtime.finishRemoteMinigame(this, patientId, procedure, accuracy, originalFinishProcedure);
  };

  prototype.__p2pBridgeInstalled = true;
}
