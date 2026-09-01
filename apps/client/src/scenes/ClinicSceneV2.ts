import Phaser from "phaser";
import {
  ITEM_LABELS,
  PATIENT_DEFINITIONS,
  PROCEDURE_LABELS,
  advanceWorkflow,
  createPatient,
  createPatientWorkflow,
  currentWorkflowStep,
  generateClinicLayout,
  generateGameplayLayoutExtras,
  routeThroughClinic,
  workflowProgress,
  workflowRequestedItem,
  type ClinicDecoration,
  type ClinicLayout,
  type ClinicRoomKind,
  type CounterSurface,
  type ItemType,
  type PatientCase,
  type PatientWorkflow,
  type Point,
  type ProcedureType,
  type StationState,
  type WorkflowDestination,
} from "@animal-care/shared";

type ItemLocation = "floor" | "carried" | "counter" | "hidden";
type StationMode = "available" | "occupied" | "ready" | "dirty";
type PatientPhase = "arriving" | "waiting" | "moving" | "station" | "leaving";
type MoveIntent = "waiting" | "reception" | "workflow" | "handoff" | "exit";

type WorldItem = {
  id: string;
  type: ItemType;
  home: Point;
  location: ItemLocation;
  counterId?: string;
  slotIndex?: number;
  container: Phaser.GameObjects.Container;
};

type CounterRuntime = {
  surface: CounterSurface;
  slots: Array<WorldItem | undefined>;
  badge: Phaser.GameObjects.Text;
};

type StationRuntime = {
  station: StationState;
  mode: StationMode;
  patientId?: string;
  badge: Phaser.GameObjects.Text;
};

type PatientView = {
  container: Phaser.GameObjects.Container;
  status: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Text;
};

type PatientRuntime = {
  patient: PatientCase;
  workflow: PatientWorkflow;
  view: PatientView;
  phase: PatientPhase;
  route: Point[];
  moveIntent: MoveIntent;
  stationId?: string;
  waitingForDestination?: WorkflowDestination;
  patienceMs: number;
};

type TimingMinigame = {
  kind: "timing";
  patientId: string;
  procedure: ProcedureType;
  container: Phaser.GameObjects.Container;
  marker: Phaser.GameObjects.Rectangle;
  progress: Phaser.GameObjects.Text;
  attempts: number;
  accuracy: number;
  startedAt: number;
};

type SampleMinigame = {
  kind: "sample";
  patientId: string;
  procedure: ProcedureType;
  container: Phaser.GameObjects.Container;
  prompt: Phaser.GameObjects.Text;
  progress: Phaser.GameObjects.Text;
  sequence: number[];
  index: number;
  correct: number;
  startedAt: number;
};

type ActiveMinigame = TimingMinigame | SampleMinigame;

const WIDTH = 1280;
const HEIGHT = 720;
const HUD_H = 64;
const SHIFT_MS = 4 * 60_000;
const MOVE_SPEED = 250;
const PATIENT_SPEED = 115;
const INTERACT_DISTANCE = 94;
const ITEM_DISTANCE = 70;
const COUNTER_DISTANCE = 88;

const ROOM_COLORS: Record<ClinicRoomKind, number> = {
  waiting: 0xe4f2df,
  reception: 0xe6eee8,
  storage: 0xf1e2bd,
  analyzer: 0xd9eaf3,
  treatment: 0xf1d9d6,
};

const ITEM_COLORS: Record<ItemType, number> = {
  bandage: 0xf4f1df,
  sampleKit: 0xb8d8e8,
  eyeDrops: 0xd9e3ff,
  treat: 0xe5ae67,
  disinfectant: 0x9dd5ca,
};

const ITEM_ICONS: Record<ItemType, string> = {
  bandage: "BD",
  sampleKit: "PR",
  eyeDrops: "KR",
  treat: "♥",
  disinfectant: "DS",
};

const STATION_COLORS: Record<StationState["kind"], number> = {
  reception: 0x9fcbb9,
  storage: 0xbfa070,
  analyzer: 0x8fb8cc,
  treatment: 0xcf9793,
  exit: 0x77aa8e,
};

export class ClinicSceneV2 extends Phaser.Scene {
  private seed = 1;
  private layout!: ClinicLayout;
  private extras!: ReturnType<typeof generateGameplayLayoutExtras>;

  private player!: Phaser.Physics.Arcade.Sprite;
  private obstacleGroup!: Phaser.Physics.Arcade.StaticGroup;
  private stationGroup!: Phaser.Physics.Arcade.StaticGroup;
  private counterGroup!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private pingKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private numberKeys!: Phaser.Input.Keyboard.Key[];
  private facing = new Phaser.Math.Vector2(0, 1);

  private stations = new Map<string, StationRuntime>();
  private counters = new Map<string, CounterRuntime>();
  private patients = new Map<string, PatientRuntime>();
  private waitingQueue: string[] = [];
  private items: WorldItem[] = [];
  private carriedItem?: WorldItem;
  private activeMinigame?: ActiveMinigame;

  private hudText!: Phaser.GameObjects.Text;
  private carriedText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private taskText!: Phaser.GameObjects.Text;
  private briefing?: Phaser.GameObjects.Container;
  private results?: Phaser.GameObjects.Container;

  private shiftStarted = false;
  private remainingMs = SHIFT_MS;
  private elapsedMs = 0;
  private nextPatientAt = 20_000;
  private patientSequence = 0;
  private treated = 0;
  private coins = 0;
  private mistakes = 0;
  private clinicStress = 8;
  private lastUiRefresh = 0;
  private lastStationRetry = 0;

  constructor() {
    super("ClinicSceneV2");
  }

  create(): void {
    const requestedSeed = Number(new URLSearchParams(window.location.search).get("seed"));
    this.seed = Number.isFinite(requestedSeed) && requestedSeed > 0
      ? Math.floor(requestedSeed)
      : Math.floor((Date.now() + Math.random() * 1_000_000) % 9_999_999) + 1;

    this.layout = generateClinicLayout(this.seed, WIDTH, HEIGHT);
    this.extras = generateGameplayLayoutExtras(this.layout);
    this.remainingMs = SHIFT_MS;
    this.elapsedMs = 0;
    this.nextPatientAt = 20_000;
    this.patientSequence = 0;
    this.treated = 0;
    this.coins = 0;
    this.mistakes = 0;
    this.clinicStress = 8;
    this.shiftStarted = false;
    this.stations.clear();
    this.counters.clear();
    this.patients.clear();
    this.waitingQueue = [];
    this.items = [];
    this.carriedItem = undefined;
    this.activeMinigame = undefined;

    this.createInput();
    this.createPlayerTexture();
    this.drawClinic();
    this.createWorldItems();
    this.createPlayer();
    this.createHud();
    this.showBriefing();
    this.refreshUi(true);
  }

  update(time: number, delta: number): void {
    if (this.activeMinigame) {
      this.stopPlayer();
      this.updateMinigame(time);
      this.updateCarriedItem();
      return;
    }

    if (!this.shiftStarted) {
      this.stopPlayer();
      if (this.interactionPressed()) this.startShift();
      return;
    }

    if (this.remainingMs <= 0) {
      this.stopPlayer();
      this.updateCarriedItem();
      if (!this.results) this.showResults();
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) this.scene.restart();
      return;
    }

    this.movePlayer();
    this.updateCarriedItem();
    this.updatePatientMovement(delta);
    this.updatePatientPatience(delta);

    this.elapsedMs += delta;
    this.remainingMs = Math.max(0, this.remainingMs - delta);

    if (this.elapsedMs >= this.nextPatientAt && this.waitingQueue.length < 3) {
      this.spawnPatient();
      this.nextPatientAt += 20_000;
    }

    if (time - this.lastStationRetry > 500) {
      this.retryWaitingPatients();
      this.lastStationRetry = time;
    }

    if (this.interactionPressed()) this.handleInteraction();
    if (Phaser.Input.Keyboard.JustDown(this.pingKey)) this.pingPriorityTask();

    if (time - this.lastUiRefresh > 100) {
      this.refreshUi();
      this.lastUiRefresh = time;
    }
  }

  private createInput(): void {
    const keyboard = this.input.keyboard!;
    this.cursors = keyboard.createCursorKeys();
    this.wasd = {
      up: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
    this.interactKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.spaceKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE);
    this.pingKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.restartKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.numberKeys = [1, 2, 3, 4].map((value) => keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE + value - 1));
  }

  private interactionPressed(): boolean {
    return Phaser.Input.Keyboard.JustDown(this.interactKey) || Phaser.Input.Keyboard.JustDown(this.spaceKey);
  }

  private createPlayerTexture(): void {
    if (this.textures.exists("intern-v2")) return;
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x2f8588, 1);
    graphics.fillCircle(24, 24, 21);
    graphics.lineStyle(4, 0x235d62, 1);
    graphics.strokeCircle(24, 24, 20);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(17, 8, 14, 32, 4);
    graphics.fillRoundedRect(8, 17, 32, 14, 4);
    graphics.generateTexture("intern-v2", 48, 48);
    graphics.destroy();
  }

  private drawClinic(): void {
    this.obstacleGroup = this.physics.add.staticGroup();
    this.stationGroup = this.physics.add.staticGroup();
    this.counterGroup = this.physics.add.staticGroup();

    const bg = this.add.graphics().setDepth(0);
    bg.fillStyle(0xd8d0c3, 1);
    bg.fillRect(0, 0, WIDTH, HEIGHT);
    bg.fillStyle(0x294c50, 1);
    bg.fillRect(0, 0, WIDTH, HUD_H);
    bg.fillStyle(0xc9c0b4, 1);
    bg.fillRect(this.layout.corridor.x, this.layout.corridor.y, this.layout.corridor.width, this.layout.corridor.height);

    for (const room of this.layout.rooms) {
      bg.fillStyle(ROOM_COLORS[room.kind], 1);
      bg.fillRect(room.x, room.y, room.width, room.height);
      this.add.text(room.x + 18, room.y + 15, room.label, this.textStyle(13, "#385557", 900)).setDepth(4);
      this.add.text(room.x + 18, room.y + 34, this.roomSubtitle(room.kind), this.textStyle(9, "#71807b", 700)).setDepth(4);

      for (let x = room.x + 30; x < room.x + room.width; x += 48) {
        for (let y = room.y + 28; y < room.y + room.height; y += 48) {
          bg.fillStyle(room.kind === "treatment" || room.kind === "analyzer" ? 0xffffff : 0x48655f, 0.07);
          bg.fillCircle(x, y, 2.2);
        }
      }

      this.add.rectangle(room.doorX, room.doorY, 66, 8, 0xfffaf0, 1).setDepth(6).setStrokeStyle(2, 0x9b9185, 0.75);
      this.addDoorJambs(room.doorX, room.doorY, room.doorSide === "bottom");
    }

    for (const wall of this.layout.walls) {
      const node = this.add.rectangle(wall.x, wall.y, wall.width, wall.height, 0x596764, 1).setDepth(8);
      node.setStrokeStyle(2, 0x414e4b, 1);
      this.physics.add.existing(node, true);
      this.obstacleGroup.add(node);
    }

    const rightBlock = this.add.rectangle(
      WIDTH - 10,
      this.layout.corridor.y + this.layout.corridor.height / 2,
      20,
      this.layout.corridor.height,
      0x596764,
      1,
    ).setDepth(8);
    this.physics.add.existing(rightBlock, true);
    this.obstacleGroup.add(rightBlock);

    this.drawExit();
    this.drawDecorations();
    this.drawCounters();
    this.drawStations();
  }

  private addDoorJambs(doorX: number, doorY: number, horizontalWall: boolean): void {
    if (!horizontalWall) return;
    for (const dx of [-36, 36]) {
      const jamb = this.add.rectangle(doorX + dx, doorY, 8, 16, 0x4e5b58, 1).setDepth(9);
      this.physics.add.existing(jamb, true);
      this.obstacleGroup.add(jamb);
    }
  }

  private drawExit(): void {
    const node = this.add.rectangle(this.layout.exit.x, this.layout.exit.y, 34, this.layout.corridor.height - 16, 0x76ad92, 0.82).setDepth(3);
    node.setStrokeStyle(2, 0x487d68, 0.8);
    this.add.text(this.layout.exit.x + 12, this.layout.exit.y, "WYJŚCIE", this.textStyle(9, "#ffffff", 900))
      .setOrigin(0.5)
      .setAngle(-90)
      .setDepth(4);
  }

  private drawDecorations(): void {
    for (const decoration of this.extras.decorations) {
      const node = this.makeDecoration(decoration);
      if (decoration.blocksMovement) {
        this.physics.add.existing(node, true);
        this.obstacleGroup.add(node);
      }
    }
  }

  private makeDecoration(decoration: ClinicDecoration): Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse {
    let node: Phaser.GameObjects.Rectangle | Phaser.GameObjects.Ellipse;
    if (decoration.kind === "plant") {
      node = this.add.ellipse(decoration.x, decoration.y, decoration.width, decoration.height, 0x6f9a72, 1);
      this.add.circle(decoration.x, decoration.y + 9, 10, 0xa77e58, 1).setDepth(9);
    } else {
      const colors: Record<ClinicDecoration["kind"], number> = {
        chair: 0x9bb8a8,
        plant: 0x6f9a72,
        cabinet: 0x9f8c72,
        sink: 0xa9c8c8,
        bin: 0x71807d,
      };
      node = this.add.rectangle(decoration.x, decoration.y, decoration.width, decoration.height, colors[decoration.kind], 1);
      node.setStrokeStyle(2, 0x53625e, 0.45);
    }
    node.setDepth(9);
    return node;
  }

  private drawCounters(): void {
    for (const surface of this.extras.counters) {
      const shadow = this.add.rectangle(surface.x + 4, surface.y + 6, surface.width, surface.height, 0x263b38, 0.18).setDepth(10);
      shadow.setVisible(true);
      const node = this.add.rectangle(surface.x, surface.y, surface.width, surface.height, 0xb89a69, 1).setDepth(11);
      node.setStrokeStyle(3, 0x6e654f, 0.75);
      this.physics.add.existing(node, true);
      this.counterGroup.add(node);

      const badge = this.add.text(surface.x, surface.y + surface.height / 2 + 12, "BLAT 0/" + surface.capacity, this.textStyle(8, "#ffffff", 900))
        .setOrigin(0.5)
        .setBackgroundColor("#77684f")
        .setPadding(5, 2, 5, 2)
        .setDepth(16);
      this.counters.set(surface.id, { surface, slots: Array(surface.capacity).fill(undefined), badge });
    }
  }

  private drawStations(): void {
    for (const station of this.layout.stations) {
      const shadow = this.add.rectangle(station.x + 5, station.y + 6, station.width, station.height, 0x293b39, 0.18).setDepth(10);
      shadow.setVisible(true);
      const node = this.add.rectangle(station.x, station.y, station.width, station.height, STATION_COLORS[station.kind], 1).setDepth(12);
      node.setStrokeStyle(3, 0x536663, 0.72);
      this.physics.add.existing(node, true);
      this.stationGroup.add(node);

      this.add.text(station.x, station.y - 8, station.label, this.textStyle(11, "#2e4548", 900)).setOrigin(0.5).setDepth(13);
      this.add.text(station.x, station.y + 11, this.stationSubtitle(station), this.textStyle(8, "#566c68", 700)).setOrigin(0.5).setDepth(13);
      const badge = this.add.text(station.x, station.y + station.height / 2 + 12, "WOLNE", this.textStyle(8, "#ffffff", 900))
        .setOrigin(0.5)
        .setBackgroundColor("#668779")
        .setPadding(5, 2, 5, 2)
        .setDepth(16);
      this.stations.set(station.id, { station, mode: "available", badge });
    }
  }

  private createWorldItems(): void {
    for (const spawn of this.layout.itemSpawns) {
      for (let copy = 0; copy < 2; copy += 1) {
        const offsetX = copy === 0 ? -18 : 18;
        const offsetY = copy === 0 ? -12 : 18;
        const id = `${spawn.id}-copy-${copy}`;
        this.items.push(this.makeWorldItem(id, spawn.item, spawn.x + offsetX, spawn.y + offsetY));
      }
    }
  }

  private makeWorldItem(id: string, type: ItemType, x: number, y: number): WorldItem {
    const shadow = this.add.ellipse(3, 9, 30, 14, 0x172b2c, 0.15);
    const body = this.add.rectangle(0, 0, 34, 30, ITEM_COLORS[type], 1).setStrokeStyle(2, 0x536b67, 0.72);
    const icon = this.add.text(0, -1, ITEM_ICONS[type], this.textStyle(type === "treat" ? 15 : 10, "#334b4d", 900)).setOrigin(0.5);
    const label = this.add.text(0, 22, ITEM_LABELS[type], this.textStyle(8, "#3f595a", 800))
      .setOrigin(0.5)
      .setBackgroundColor("#fffaf0")
      .setPadding(4, 1, 4, 1);
    const container = this.add.container(x, y, [shadow, body, icon, label]).setDepth(15);
    return { id, type, home: { x, y }, location: "floor", container };
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(this.layout.playerSpawn.x, this.layout.playerSpawn.y, "intern-v2").setDepth(35);
    this.player.setCircle(19, 5, 5);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.obstacleGroup);
    this.physics.add.collider(this.player, this.stationGroup);
    this.physics.add.collider(this.player, this.counterGroup);

    const label = this.add.text(0, 0, "STAŻYSTA", this.textStyle(9, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#294c50")
      .setPadding(5, 2, 5, 2)
      .setDepth(36);
    this.events.on("update", () => label.setPosition(this.player.x, this.player.y + 34));
  }

  private createHud(): void {
    this.hudText = this.add.text(16, 15, "", this.textStyle(16, "#ffffff", 900)).setDepth(100);
    this.carriedText = this.add.text(WIDTH - 16, 15, "", this.textStyle(13, "#ffffff", 900)).setOrigin(1, 0).setDepth(100);
    this.taskText = this.add.text(WIDTH / 2, 15, "", this.textStyle(11, "#d9ece7", 800)).setOrigin(0.5, 0).setDepth(100);
    this.hintText = this.add.text(WIDTH / 2, HEIGHT - 17, "", this.textStyle(12, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#294c50")
      .setPadding(11, 5, 11, 5)
      .setDepth(120);
    this.toastText = this.add.text(WIDTH / 2, 83, "", this.textStyle(13, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(12, 6, 12, 6)
      .setAlpha(0)
      .setDepth(160);
  }

  private showBriefing(): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.77);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 790, 440, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 190, "KLINIKA V2 — CZYTELNY CHAOS", this.textStyle(29, "#284b50", 900)).setOrigin(0.5);
    const seed = this.add.text(WIDTH / 2, 228, `SEED ${this.seed}`, this.textStyle(12, "#788981", 800)).setOrigin(0.5);
    const body = this.add.text(
      WIDTH / 2,
      352,
      "Pacjenci poruszają się sami między poczekalnią, recepcją, diagnostyką i gabinetami.\nTy odpowiadasz za przepływ pracy: przyjęcie, dostarczenie narzędzi, staging na blatach, zabieg i sprzątanie.\nPrzypadki diagnostyczne mają dłuższy łańcuch: próbka → analiza → leczenie.\nKażdy blat ma ograniczoną liczbę miejsc — wykorzystuj go jako bufor zamiast rzucać wszystko na podłogę.",
      { ...this.textStyle(16, "#405b5b", 750), align: "center", lineSpacing: 9 },
    ).setOrigin(0.5);
    const controls = this.add.text(
      WIDTH / 2,
      505,
      "WASD / STRZAŁKI — ruch     E / SPACE — akcja     Q — priorytet     1–4 — analiza",
      this.textStyle(12, "#5f7470", 850),
    ).setOrigin(0.5);
    const start = this.add.text(WIDTH / 2, 557, "NACIŚNIJ E, ABY OTWORZYĆ KLINIKĘ", this.textStyle(14, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(18, 9, 18, 9);
    this.briefing = this.add.container(0, 0, [shade, panel, title, seed, body, controls, start]).setDepth(300);
  }

  private startShift(): void {
    this.shiftStarted = true;
    this.briefing?.destroy(true);
    this.briefing = undefined;
    this.spawnPatient();
    this.spawnPatient();
    this.spawnPatient();
    this.toast("Klinika otwarta — ustaw narzędzia na blatach zanim zrobi się tłok!");
  }

  private spawnPatient(): void {
    if (this.waitingQueue.length >= 3) return;
    this.patientSequence += 1;
    const definition = PATIENT_DEFINITIONS[(this.patientSequence - 1) % PATIENT_DEFINITIONS.length];
    const patient = createPatient(definition, this.patientSequence);
    const workflow = createPatientWorkflow(patient);
    const view = this.createPatientView(patient);
    const seatIndex = this.waitingQueue.length % this.layout.patientSpawns.length;
    const target = this.layout.patientSpawns[seatIndex];
    const runtime: PatientRuntime = {
      patient,
      workflow,
      view,
      phase: "arriving",
      route: [],
      moveIntent: "waiting",
      patienceMs: patient.patienceMs,
    };
    this.patients.set(patient.id, runtime);
    this.waitingQueue.push(patient.id);
    view.container.setPosition(this.layout.exit.x + 12, this.layout.exit.y);
    this.movePatient(runtime, target, "waiting");
  }

  private createPatientView(patient: PatientCase): PatientView {
    const body = this.add.circle(0, 0, 23, patient.color, 1).setStrokeStyle(3, 0x51615e, 0.78);
    const eye = this.add.circle(7, 1, 4, 0xffffff, 1);
    const pupil = this.add.circle(8, 1, 1.7, 0x263f40, 1);
    const nose = this.add.circle(17, 9, 3, 0x4c5552, 1);
    const bits: Phaser.GameObjects.GameObject[] = [];
    if (patient.species === "rabbit") {
      bits.push(this.add.ellipse(-10, -26, 11, 29, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.6));
      bits.push(this.add.ellipse(8, -28, 11, 31, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.6));
    } else if (patient.species === "cat") {
      bits.push(this.add.triangle(-11, -19, 0, 18, 9, 0, 18, 18, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.6));
      bits.push(this.add.triangle(8, -19, 0, 18, 9, 0, 18, 18, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.6));
    } else {
      bits.push(this.add.ellipse(-16, -13, 13, 24, patient.color, 1).setAngle(25).setStrokeStyle(2, 0x51615e, 0.6));
      bits.push(this.add.ellipse(15, -13, 13, 24, patient.color, 1).setAngle(-25).setStrokeStyle(2, 0x51615e, 0.6));
    }
    const status = this.add.text(0, -45, "WCHODZI", this.textStyle(8, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor(this.priorityColor(patient.priority))
      .setPadding(5, 2, 5, 2);
    const progress = this.add.text(0, 34, "1/?", this.textStyle(8, "#344d4e", 850))
      .setOrigin(0.5)
      .setBackgroundColor("#fffaf0")
      .setPadding(4, 1, 4, 1);
    const container = this.add.container(-100, -100, [...bits, body, eye, pupil, nose, status, progress]).setDepth(27);
    return { container, status, progress };
  }

  private movePatient(runtime: PatientRuntime, target: Point, intent: MoveIntent): void {
    runtime.route = routeThroughClinic(this.layout, { x: runtime.view.container.x, y: runtime.view.container.y }, target);
    runtime.moveIntent = intent;
    runtime.phase = intent === "exit" ? "leaving" : "moving";
  }

  private updatePatientMovement(delta: number): void {
    const distance = PATIENT_SPEED * (delta / 1000);
    for (const runtime of this.patients.values()) {
      if (runtime.phase !== "moving" && runtime.phase !== "leaving") continue;
      const point = runtime.route[0];
      if (!point) {
        this.onPatientRouteComplete(runtime);
        continue;
      }
      const dx = point.x - runtime.view.container.x;
      const dy = point.y - runtime.view.container.y;
      const length = Math.hypot(dx, dy);
      if (length <= distance + 1) {
        runtime.view.container.setPosition(point.x, point.y);
        runtime.route.shift();
        if (runtime.route.length === 0) this.onPatientRouteComplete(runtime);
      } else {
        runtime.view.container.x += (dx / length) * distance;
        runtime.view.container.y += (dy / length) * distance;
      }
    }
  }

  private onPatientRouteComplete(runtime: PatientRuntime): void {
    if (runtime.moveIntent === "waiting") {
      runtime.phase = "waiting";
      runtime.view.status.setText("CZEKA");
      this.updatePatientProgress(runtime);
      return;
    }
    if (runtime.moveIntent === "reception") {
      runtime.view.status.setText("PRZYJĘTY");
      this.sendPatientToWorkflowDestination(runtime);
      return;
    }
    if (runtime.moveIntent === "workflow") {
      const step = currentWorkflowStep(runtime.workflow);
      if (!step || step.action !== "arrive") return;
      runtime.workflow = advanceWorkflow(runtime.workflow, { type: "arrive", destination: step.destination });
      runtime.phase = "station";
      runtime.waitingForDestination = undefined;
      const station = runtime.stationId ? this.stations.get(runtime.stationId) : undefined;
      if (station) {
        station.mode = "occupied";
        station.patientId = runtime.patient.id;
        this.refreshStationBadge(station);
      }
      runtime.view.status.setText(workflowRequestedItem(runtime.workflow) ? `POTRZEBA: ${ITEM_LABELS[workflowRequestedItem(runtime.workflow)!]}` : "GOTOWY");
      this.updatePatientProgress(runtime);
      return;
    }
    if (runtime.moveIntent === "handoff") {
      runtime.phase = "waiting";
      this.sendPatientToWorkflowDestination(runtime);
      return;
    }
    if (runtime.moveIntent === "exit") {
      runtime.workflow = advanceWorkflow(runtime.workflow, { type: "release" });
      this.treated += 1;
      this.coins += runtime.workflow.kind === "diagnostic" ? 78 : 48;
      runtime.view.status.setText("ZDROWY!");
      runtime.view.status.setBackgroundColor("#4f9e75");
      this.tweens.add({
        targets: runtime.view.container,
        alpha: 0,
        duration: 450,
        onComplete: () => {
          runtime.view.container.destroy(true);
          this.patients.delete(runtime.patient.id);
        },
      });
    }
  }

  private sendPatientToWorkflowDestination(runtime: PatientRuntime): void {
    const step = currentWorkflowStep(runtime.workflow);
    if (!step) return;
    if (step.action === "release") {
      runtime.view.status.setText("DO WYJŚCIA");
      this.movePatient(runtime, this.layout.exit, "exit");
      return;
    }
    if (step.action !== "arrive") return;

    const stationKind = step.destination === "analyzer" ? "analyzer" : step.destination === "treatment" ? "treatment" : undefined;
    if (!stationKind) return;
    const station = [...this.stations.values()].find((candidate) => candidate.station.kind === stationKind && candidate.mode === "available");
    if (!station) {
      runtime.waitingForDestination = step.destination;
      runtime.phase = "waiting";
      runtime.view.status.setText(step.destination === "analyzer" ? "CZEKA NA DIAGNOSTYKĘ" : "CZEKA NA GABINET");
      return;
    }

    station.mode = "occupied";
    station.patientId = runtime.patient.id;
    runtime.stationId = station.station.id;
    this.refreshStationBadge(station);
    runtime.view.status.setText("IDZIE DO STACJI");
    this.movePatient(runtime, this.patientPositionAtStation(station.station), "workflow");
  }

  private retryWaitingPatients(): void {
    for (const runtime of this.patients.values()) {
      if (!runtime.waitingForDestination || runtime.phase !== "waiting") continue;
      this.sendPatientToWorkflowDestination(runtime);
    }
  }

  private patientPositionAtStation(station: StationState): Point {
    return { x: station.x, y: station.y - station.height / 2 - 31 };
  }

  private updatePatientPatience(delta: number): void {
    for (const runtime of this.patients.values()) {
      if (runtime.phase === "leaving") continue;
      runtime.patienceMs -= delta;
      if (runtime.patienceMs > 0) continue;
      this.patientGivesUp(runtime);
    }
  }

  private patientGivesUp(runtime: PatientRuntime): void {
    this.mistakes += 1;
    this.clinicStress = Math.min(100, this.clinicStress + 12);
    this.waitingQueue = this.waitingQueue.filter((id) => id !== runtime.patient.id);
    if (runtime.stationId) {
      const station = this.stations.get(runtime.stationId);
      if (station) {
        station.mode = "dirty";
        station.patientId = undefined;
        this.refreshStationBadge(station);
      }
    }
    runtime.view.status.setText("REZYGNUJE");
    runtime.view.status.setBackgroundColor("#a25e58");
    runtime.waitingForDestination = undefined;
    runtime.stationId = undefined;
    this.movePatient(runtime, this.layout.exit, "exit");
    runtime.workflow = { ...runtime.workflow, completed: true };
  }

  private movePlayer(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;
    let vx = Number(right) - Number(left);
    let vy = Number(down) - Number(up);
    if (vx || vy) {
      const length = Math.hypot(vx, vy) || 1;
      vx /= length;
      vy /= length;
      this.facing.set(vx, vy);
    }
    body.setVelocity(vx * MOVE_SPEED, vy * MOVE_SPEED);
  }

  private stopPlayer(): void {
    const body = this.player?.body as Phaser.Physics.Arcade.Body | undefined;
    body?.setVelocity(0, 0);
  }

  private updateCarriedItem(): void {
    if (!this.carriedItem) return;
    this.carriedItem.container.setPosition(this.player.x + this.facing.x * 8, this.player.y - 46).setDepth(45);
  }

  private handleInteraction(): void {
    const station = this.nearestStation();
    const counter = this.nearestCounter();

    if (station?.mode === "dirty" && this.carriedItem?.type === "disinfectant") {
      station.mode = "available";
      this.consumeCarriedItem();
      this.refreshStationBadge(station);
      this.toast(`${station.station.label}: zdezynfekowane.`);
      return;
    }

    if (station?.patientId && station.mode === "occupied" && this.carriedItem) {
      const runtime = this.patients.get(station.patientId);
      const requested = runtime ? workflowRequestedItem(runtime.workflow) : undefined;
      if (!runtime || !requested) return;
      if (requested !== this.carriedItem.type) {
        this.mistakes += 1;
        this.clinicStress = Math.min(100, this.clinicStress + 3);
        this.toast(`Nie ten przedmiot — potrzebny: ${ITEM_LABELS[requested]}.`, 0x9b5a55);
        return;
      }
      runtime.workflow = advanceWorkflow(runtime.workflow, { type: "deliver", item: requested });
      this.consumeCarriedItem();
      station.mode = "ready";
      this.refreshStationBadge(station);
      runtime.view.status.setText("GOTOWY DO ZABIEGU");
      this.updatePatientProgress(runtime);
      this.toast(`${ITEM_LABELS[requested]} dostarczony.`);
      return;
    }

    if (station?.patientId && station.mode === "ready" && !this.carriedItem) {
      const runtime = this.patients.get(station.patientId);
      const step = runtime ? currentWorkflowStep(runtime.workflow) : undefined;
      if (runtime && step?.action === "procedure" && step.procedure) {
        this.startMinigame(runtime, step.procedure);
        return;
      }
    }

    if (this.carriedItem && counter) {
      if (this.placeOnCounter(counter, this.carriedItem)) return;
    }

    if (!this.carriedItem && counter) {
      const item = counter.slots.find(Boolean);
      if (item) {
        this.pickUpItem(item);
        return;
      }
    }

    if (!this.carriedItem) {
      const item = this.nearestFloorItem();
      if (item) {
        this.pickUpItem(item);
        return;
      }
    }

    if (station?.station.kind === "reception" && !this.carriedItem) {
      if (this.admitNextPatient()) return;
    }

    if (this.carriedItem) {
      this.dropCarriedItem();
      return;
    }

    if (station?.mode === "dirty") {
      this.toast("Brudne stanowisko — potrzebny środek do dezynfekcji.", 0x8f6358);
      return;
    }

    this.toast("Tu nie ma teraz akcji.", 0x6d7775);
  }

  private admitNextPatient(): boolean {
    const patientId = this.waitingQueue.find((id) => this.patients.get(id)?.phase === "waiting");
    if (!patientId) {
      this.toast(this.waitingQueue.length ? "Pacjent jeszcze dochodzi do poczekalni." : "Brak pacjentów w kolejce.", 0x6d7775);
      return false;
    }
    const runtime = this.patients.get(patientId)!;
    runtime.workflow = advanceWorkflow(runtime.workflow, { type: "admit" });
    this.waitingQueue = this.waitingQueue.filter((id) => id !== patientId);
    runtime.view.status.setText("DO RECEPCJI");
    this.updatePatientProgress(runtime);
    const reception = [...this.stations.values()].find((candidate) => candidate.station.kind === "reception")!;
    this.movePatient(runtime, this.patientPositionAtStation(reception.station), "reception");
    this.toast(`${runtime.patient.displayName}: przyjęty. Pacjent sam idzie dalej.`);
    return true;
  }

  private placeOnCounter(counter: CounterRuntime, item: WorldItem): boolean {
    const slotIndex = counter.slots.findIndex((slot) => !slot);
    if (slotIndex < 0) {
      this.toast("Blat jest pełny.", 0x8f6358);
      return false;
    }
    this.detachItemFromCounter(item);
    counter.slots[slotIndex] = item;
    item.location = "counter";
    item.counterId = counter.surface.id;
    item.slotIndex = slotIndex;
    item.container.setScale(1).setDepth(17);
    const pos = this.counterSlotPosition(counter.surface, slotIndex);
    item.container.setPosition(pos.x, pos.y);
    this.carriedItem = undefined;
    this.refreshCounterBadge(counter);
    this.toast(`${ITEM_LABELS[item.type]} odłożony na blat.`);
    return true;
  }

  private counterSlotPosition(surface: CounterSurface, index: number): Point {
    const gap = surface.width / surface.capacity;
    return {
      x: surface.x - surface.width / 2 + gap * (index + 0.5),
      y: surface.y - 5,
    };
  }

  private pickUpItem(item: WorldItem): void {
    this.detachItemFromCounter(item);
    item.location = "carried";
    item.counterId = undefined;
    item.slotIndex = undefined;
    item.container.setScale(1.1).setVisible(true);
    this.carriedItem = item;
    this.toast(`Podnosisz: ${ITEM_LABELS[item.type]}.`);
  }

  private detachItemFromCounter(item: WorldItem): void {
    if (!item.counterId) return;
    const counter = this.counters.get(item.counterId);
    if (counter && item.slotIndex !== undefined) {
      counter.slots[item.slotIndex] = undefined;
      this.refreshCounterBadge(counter);
    }
    item.counterId = undefined;
    item.slotIndex = undefined;
  }

  private dropCarriedItem(): void {
    if (!this.carriedItem) return;
    const item = this.carriedItem;
    item.location = "floor";
    item.container.setScale(1).setDepth(15).setPosition(
      Phaser.Math.Clamp(this.player.x + this.facing.x * 54, 26, WIDTH - 26),
      Phaser.Math.Clamp(this.player.y + this.facing.y * 54, HUD_H + 20, HEIGHT - 26),
    );
    this.carriedItem = undefined;
    this.toast(`${ITEM_LABELS[item.type]} odłożony na podłogę.`);
  }

  private consumeCarriedItem(): void {
    if (!this.carriedItem) return;
    const item = this.carriedItem;
    this.detachItemFromCounter(item);
    this.carriedItem = undefined;
    item.location = "hidden";
    item.container.setVisible(false).setScale(1);
    this.time.delayedCall(4200, () => {
      item.location = "floor";
      item.container.setPosition(item.home.x, item.home.y).setVisible(true).setDepth(15);
    });
  }

  private nearestFloorItem(): WorldItem | undefined {
    let best: WorldItem | undefined;
    let distance = ITEM_DISTANCE;
    for (const item of this.items) {
      if (item.location !== "floor" || !item.container.visible) continue;
      const current = Phaser.Math.Distance.Between(this.player.x, this.player.y, item.container.x, item.container.y);
      if (current < distance) {
        distance = current;
        best = item;
      }
    }
    return best;
  }

  private nearestCounter(): CounterRuntime | undefined {
    let best: CounterRuntime | undefined;
    let distance = COUNTER_DISTANCE;
    for (const counter of this.counters.values()) {
      const dx = Math.max(Math.abs(this.player.x - counter.surface.x) - counter.surface.width / 2, 0);
      const dy = Math.max(Math.abs(this.player.y - counter.surface.y) - counter.surface.height / 2, 0);
      const current = Math.hypot(dx, dy);
      if (current < distance) {
        distance = current;
        best = counter;
      }
    }
    return best;
  }

  private nearestStation(): StationRuntime | undefined {
    let best: StationRuntime | undefined;
    let distance = INTERACT_DISTANCE;
    for (const station of this.stations.values()) {
      const dx = Math.max(Math.abs(this.player.x - station.station.x) - station.station.width / 2, 0);
      const dy = Math.max(Math.abs(this.player.y - station.station.y) - station.station.height / 2, 0);
      const current = Math.hypot(dx, dy);
      if (current < distance) {
        distance = current;
        best = station;
      }
    }
    return best;
  }

  private startMinigame(runtime: PatientRuntime, procedure: ProcedureType): void {
    if (procedure === "sampleAnalysis") this.startSampleMinigame(runtime, procedure);
    else this.startTimingMinigame(runtime, procedure);
  }

  private startTimingMinigame(runtime: PatientRuntime, procedure: ProcedureType): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.67);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 650, 330, 0xfffbf3, 1).setStrokeStyle(4, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 245, PROCEDURE_LABELS[procedure], this.textStyle(25, "#284b50", 900)).setOrigin(0.5);
    const info = this.add.text(WIDTH / 2, 286, "E / Space w zielonej strefie • 3 próby", this.textStyle(13, "#607774", 750)).setOrigin(0.5);
    const bar = this.add.rectangle(WIDTH / 2, 365, 380, 24, 0xcbd6d1, 1).setStrokeStyle(2, 0x6e817c, 1);
    const zone = this.add.rectangle(WIDTH / 2, 365, 95, 24, 0x75b98f, 1);
    const marker = this.add.rectangle(WIDTH / 2 - 185, 365, 10, 46, 0xe07063, 1);
    const progress = this.add.text(WIDTH / 2, 425, "Próby: 0 / 3", this.textStyle(15, "#385557", 900)).setOrigin(0.5);
    const container = this.add.container(0, 0, [shade, panel, title, info, bar, zone, marker, progress]).setDepth(400);
    this.activeMinigame = { kind: "timing", patientId: runtime.patient.id, procedure, container, marker, progress, attempts: 0, accuracy: 0, startedAt: this.time.now };
  }

  private startSampleMinigame(runtime: PatientRuntime, procedure: ProcedureType): void {
    const sequence = [0, 1, 2].map(() => Phaser.Math.Between(1, 4));
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.67);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 660, 350, 0xfffbf3, 1).setStrokeStyle(4, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 235, "ANALIZA PRÓBKI", this.textStyle(25, "#284b50", 900)).setOrigin(0.5);
    const info = this.add.text(WIDTH / 2, 280, "Dobierz właściwy filtr klawiszami 1–4.", this.textStyle(13, "#607774", 750)).setOrigin(0.5);
    const prompt = this.add.text(WIDTH / 2, 360, `FILTR ${sequence[0]}`, this.textStyle(36, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#4b8c91")
      .setPadding(26, 11, 26, 11);
    const progress = this.add.text(WIDTH / 2, 440, "Próbka: 1 / 3", this.textStyle(15, "#385557", 900)).setOrigin(0.5);
    const container = this.add.container(0, 0, [shade, panel, title, info, prompt, progress]).setDepth(400);
    this.activeMinigame = { kind: "sample", patientId: runtime.patient.id, procedure, container, prompt, progress, sequence, index: 0, correct: 0, startedAt: this.time.now };
  }

  private updateMinigame(time: number): void {
    const game = this.activeMinigame;
    if (!game) return;
    if (game.kind === "timing") {
      const phase = ((time - game.startedAt) % 1800) / 1800;
      game.marker.x = WIDTH / 2 - 185 + Math.abs(Math.sin(phase * Math.PI)) * 370;
      if (this.interactionPressed()) {
        const accuracy = Math.max(0, 1 - Math.abs(game.marker.x - WIDTH / 2) / 180);
        game.accuracy += accuracy;
        game.attempts += 1;
        game.progress.setText(`Próby: ${game.attempts} / 3   Trafienie: ${Math.round(accuracy * 100)}%`);
        if (game.attempts >= 3) this.finishProcedure(game.patientId, game.procedure, game.accuracy / 3);
      }
      return;
    }

    for (let index = 0; index < this.numberKeys.length; index += 1) {
      if (!Phaser.Input.Keyboard.JustDown(this.numberKeys[index])) continue;
      const choice = index + 1;
      if (choice === game.sequence[game.index]) game.correct += 1;
      else {
        this.mistakes += 1;
        this.clinicStress = Math.min(100, this.clinicStress + 2);
      }
      game.index += 1;
      if (game.index >= game.sequence.length) this.finishProcedure(game.patientId, game.procedure, game.correct / game.sequence.length);
      else {
        game.prompt.setText(`FILTR ${game.sequence[game.index]}`);
        game.progress.setText(`Próbka: ${game.index + 1} / ${game.sequence.length}`);
      }
      break;
    }
  }

  private finishProcedure(patientId: string, procedure: ProcedureType, accuracy: number): void {
    const runtime = this.patients.get(patientId);
    if (!runtime) return;
    this.activeMinigame?.container.destroy(true);
    this.activeMinigame = undefined;
    runtime.workflow = advanceWorkflow(runtime.workflow, { type: "procedure", procedure });

    const station = runtime.stationId ? this.stations.get(runtime.stationId) : undefined;
    if (station) {
      station.mode = "dirty";
      station.patientId = undefined;
      this.refreshStationBadge(station);
    }
    runtime.stationId = undefined;
    this.clinicStress = Math.max(0, this.clinicStress - Math.round(accuracy * 4));
    this.coins += Math.round(accuracy * 8);
    this.updatePatientProgress(runtime);

    const next = currentWorkflowStep(runtime.workflow);
    if (next?.action === "arrive") {
      runtime.view.status.setText("PRZENOSZONY DALEJ");
      const currentRoom = this.layout.rooms.find((room) =>
        runtime.view.container.x > room.x && runtime.view.container.x < room.x + room.width && runtime.view.container.y > room.y && runtime.view.container.y < room.y + room.height,
      );
      const handoff = currentRoom
        ? { x: currentRoom.doorX, y: this.layout.corridor.y + this.layout.corridor.height / 2 }
        : { x: this.layout.playerSpawn.x, y: this.layout.corridor.y + this.layout.corridor.height / 2 };
      runtime.waitingForDestination = next.destination;
      this.movePatient(runtime, handoff, "handoff");
      this.toast(`${runtime.patient.displayName}: wynik gotowy, potrzebny kolejny etap.`);
    } else if (next?.action === "release") {
      runtime.view.status.setText("WYLECZONY");
      this.movePatient(runtime, this.layout.exit, "exit");
      this.toast(`${runtime.patient.displayName}: leczenie zakończone.`);
    }
  }

  private refreshStationBadge(runtime: StationRuntime): void {
    if (runtime.mode === "available") runtime.badge.setText("WOLNE").setBackgroundColor("#668779");
    else if (runtime.mode === "occupied") {
      const patient = runtime.patientId ? this.patients.get(runtime.patientId) : undefined;
      const item = patient ? workflowRequestedItem(patient.workflow) : undefined;
      runtime.badge.setText(item ? `POTRZEBA: ${ITEM_LABELS[item]}` : "ZAJĘTE").setBackgroundColor("#a87a4c");
    } else if (runtime.mode === "ready") runtime.badge.setText("GOTOWE DO ZABIEGU").setBackgroundColor("#4d8b87");
    else runtime.badge.setText("BRUDNE").setBackgroundColor("#9d5f57");
  }

  private refreshCounterBadge(counter: CounterRuntime): void {
    const used = counter.slots.filter(Boolean).length;
    counter.badge.setText(`BLAT ${used}/${counter.surface.capacity}`);
    counter.badge.setBackgroundColor(used >= counter.surface.capacity ? "#9d6557" : "#77684f");
  }

  private updatePatientProgress(runtime: PatientRuntime): void {
    const progress = workflowProgress(runtime.workflow);
    runtime.view.progress.setText(`${runtime.workflow.kind === "diagnostic" ? "DIAG" : "ZAB"} ${progress.current}/${progress.total}`);
  }

  private pingPriorityTask(): void {
    const occupied = [...this.stations.values()].find((station) => station.mode === "occupied" && station.patientId);
    if (occupied?.patientId) {
      const runtime = this.patients.get(occupied.patientId);
      const item = runtime ? workflowRequestedItem(runtime.workflow) : undefined;
      if (runtime && item) {
        this.toast(`Priorytet: ${ITEM_LABELS[item]} → ${occupied.station.label}.`);
        return;
      }
    }
    const ready = [...this.stations.values()].find((station) => station.mode === "ready");
    if (ready) {
      this.toast(`Priorytet: wykonaj procedurę przy ${ready.station.label}.`);
      return;
    }
    const dirty = [...this.stations.values()].find((station) => station.mode === "dirty");
    if (dirty) {
      this.toast(`Priorytet: dezynfekcja → ${dirty.station.label}.`);
      return;
    }
    if (this.waitingQueue.some((id) => this.patients.get(id)?.phase === "waiting")) {
      this.toast("Priorytet: podejdź do recepcji i przyjmij pacjenta.");
      return;
    }
    this.toast("Spokojnie — wykorzystaj chwilę na staging przedmiotów na blatach.");
  }

  private refreshUi(force = false): void {
    const totalSeconds = Math.ceil(this.remainingMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = String(totalSeconds % 60).padStart(2, "0");
    this.hudText.setText(`ZMIANA 1   ${minutes}:${seconds}   •   Wyleczeni ${this.treated}   •   Monety ${this.coins}   •   Stres ${Math.round(this.clinicStress)}%`);
    this.carriedText.setText(this.carriedItem ? `NIESIESZ: ${ITEM_LABELS[this.carriedItem.type]}` : "RĘCE WOLNE");
    const diagnostic = [...this.patients.values()].filter((patient) => patient.workflow.kind === "diagnostic" && patient.phase !== "leaving").length;
    this.taskText.setText(`Kolejka ${this.waitingQueue.length}/3   •   Diagnostyczni ${diagnostic}   •   Seed ${this.seed}`);
    this.updateHint();
    if (force) {
      for (const station of this.stations.values()) this.refreshStationBadge(station);
      for (const counter of this.counters.values()) this.refreshCounterBadge(counter);
      for (const patient of this.patients.values()) this.updatePatientProgress(patient);
    }
  }

  private updateHint(): void {
    const station = this.nearestStation();
    const counter = this.nearestCounter();
    const floorItem = !this.carriedItem ? this.nearestFloorItem() : undefined;

    if (station?.mode === "dirty" && this.carriedItem?.type === "disinfectant") this.hintText.setText("E — zdezynfekuj stanowisko");
    else if (station?.mode === "occupied" && station.patientId && this.carriedItem) {
      const runtime = this.patients.get(station.patientId);
      const item = runtime ? workflowRequestedItem(runtime.workflow) : undefined;
      this.hintText.setText(item ? `E — dostarcz • potrzebny ${ITEM_LABELS[item]}` : "E — interakcja");
    } else if (station?.mode === "ready" && station.patientId && !this.carriedItem) this.hintText.setText("E — rozpocznij procedurę");
    else if (this.carriedItem && counter) this.hintText.setText("E — odłóż przedmiot na blat");
    else if (!this.carriedItem && counter?.slots.some(Boolean)) this.hintText.setText("E — podnieś przedmiot z blatu");
    else if (floorItem) this.hintText.setText(`E — podnieś ${ITEM_LABELS[floorItem.type]}`);
    else if (station?.station.kind === "reception" && !this.carriedItem) this.hintText.setText("E — przyjmij kolejnego pacjenta");
    else if (this.carriedItem) this.hintText.setText(`E — odłóż ${ITEM_LABELS[this.carriedItem.type]} na podłogę`);
    else this.hintText.setText("Q — pokaż priorytet • blaty służą do stagingu");
  }

  private showResults(): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.77);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 690, 420, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const score = this.treated * 160 + this.coins * 2 - this.mistakes * 45;
    const stars = score >= 1100 ? 3 : score >= 650 ? 2 : score >= 250 ? 1 : 0;
    const title = this.add.text(WIDTH / 2, 205, "KONIEC ZMIANY", this.textStyle(29, "#284b50", 900)).setOrigin(0.5);
    const starText = this.add.text(WIDTH / 2, 260, `${"★".repeat(stars)}${"☆".repeat(3 - stars)}`, this.textStyle(39, "#d3a34d", 900)).setOrigin(0.5);
    const body = this.add.text(
      WIDTH / 2,
      370,
      `Wyleczeni: ${this.treated}\nMonety: ${this.coins}\nBłędy: ${this.mistakes}\nWynik: ${Math.max(0, score)}\nSeed kliniki: ${this.seed}`,
      { ...this.textStyle(17, "#405b5b", 800), align: "center", lineSpacing: 8 },
    ).setOrigin(0.5);
    const again = this.add.text(WIDTH / 2, 520, "R — NOWY SZPITAL", this.textStyle(14, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(18, 9, 18, 9);
    this.results = this.add.container(0, 0, [shade, panel, title, starText, body, again]).setDepth(500);
  }

  private toast(message: string, color = 0x3c8f91): void {
    this.toastText.setText(message).setBackgroundColor(`#${color.toString(16).padStart(6, "0")}`).setAlpha(1);
    this.tweens.killTweensOf(this.toastText);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1900, duration: 320 });
  }

  private roomSubtitle(kind: ClinicRoomKind): string {
    if (kind === "waiting") return "poczekalnia i krzesła";
    if (kind === "reception") return "przyjęcie uruchamia trasę";
    if (kind === "storage") return "zapas + bufory robocze";
    if (kind === "analyzer") return "próbki i analiza";
    return "leczenie + sprzątanie";
  }

  private stationSubtitle(station: StationState): string {
    if (station.kind === "reception") return "przyjmij pacjenta";
    if (station.kind === "storage") return "punkt zaopatrzenia";
    if (station.kind === "analyzer") return "diagnostyka";
    return "stół zabiegowy";
  }

  private priorityColor(priority: PatientCase["priority"]): string {
    if (priority === "critical") return "#b9504f";
    if (priority === "urgent") return "#c88445";
    return "#5d8d76";
  }

  private textStyle(size: number, color: string, fontWeight: number): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "Inter, Segoe UI, Arial, sans-serif",
      fontSize: `${size}px`,
      color,
      fontStyle: "normal",
      fontWeight: `${fontWeight}`,
    } as Phaser.Types.GameObjects.Text.TextStyle;
  }
}
