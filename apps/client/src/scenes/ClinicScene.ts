import Phaser from "phaser";
import {
  ITEM_LABELS,
  PATIENT_DEFINITIONS,
  PROCEDURE_LABELS,
  admitPatient,
  assignPatientToStation,
  beginShift,
  cleanStation,
  completeTreatment,
  createPatient,
  createShiftState,
  deliverRequiredItem,
  enqueuePatient,
  generateClinicLayout,
  registerMistake,
  scoreTotal,
  starRating,
  tickShift,
  type ClinicLayout,
  type ClinicRoomKind,
  type ItemType,
  type PatientCase,
  type ProcedureType,
  type ShiftState,
  type StationState,
  type TreatmentQuality,
} from "@animal-care/shared";

type WorldItem = {
  id: string;
  type: ItemType;
  homeX: number;
  homeY: number;
  container: Phaser.GameObjects.Container;
  carried: boolean;
};

type PatientView = {
  container: Phaser.GameObjects.Container;
  status: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
};

type TimingMinigame = {
  kind: "timing";
  patientId: string;
  procedure: ProcedureType;
  container: Phaser.GameObjects.Container;
  marker: Phaser.GameObjects.Rectangle;
  progress: Phaser.GameObjects.Text;
  attempts: number;
  accuracySum: number;
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
  attempts: number;
  startedAt: number;
};

type ActiveMinigame = TimingMinigame | SampleMinigame;

const WIDTH = 1280;
const HEIGHT = 720;
const HUD_H = 64;
const MOVE_SPEED = 250;
const INTERACT_DISTANCE = 105;
const ITEM_DISTANCE = 72;

const ROOM_COLORS: Record<ClinicRoomKind, number> = {
  waiting: 0xe4f2df,
  reception: 0xe8eee8,
  storage: 0xf3e7c8,
  analyzer: 0xddebf3,
  treatment: 0xf4dedb,
};

const ITEM_COLORS: Record<ItemType, number> = {
  bandage: 0xf4f1df,
  sampleKit: 0xb9d8e8,
  eyeDrops: 0xd8e4ff,
  treat: 0xe4b06d,
  disinfectant: 0x9fd5ca,
};

const ITEM_ICONS: Record<ItemType, string> = {
  bandage: "BD",
  sampleKit: "PR",
  eyeDrops: "KR",
  treat: "♥",
  disinfectant: "DS",
};

export class ClinicScene extends Phaser.Scene {
  private seed = 1;
  private layout!: ClinicLayout;
  private state!: ShiftState;

  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private spaceKey!: Phaser.Input.Keyboard.Key;
  private pingKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private numberKeys!: Phaser.Input.Keyboard.Key[];

  private wallGroup!: Phaser.Physics.Arcade.StaticGroup;
  private stationGroup!: Phaser.Physics.Arcade.StaticGroup;
  private stationStatusLayer!: Phaser.GameObjects.Container;
  private patientViews = new Map<string, PatientView>();
  private departingPatients = new Set<string>();
  private worldItems: WorldItem[] = [];
  private carriedItem?: WorldItem;
  private escortedPatientId?: string;
  private activeMinigame?: ActiveMinigame;

  private hudText!: Phaser.GameObjects.Text;
  private itemText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private briefingLayer?: Phaser.GameObjects.Container;
  private resultsLayer?: Phaser.GameObjects.Container;
  private nextSpawnAtMs = 18_000;
  private lastUiRefresh = 0;
  private resultsShown = false;
  private facing = new Phaser.Math.Vector2(0, 1);

  constructor() {
    super("ClinicScene");
  }

  create(): void {
    const requestedSeed = Number(new URLSearchParams(window.location.search).get("seed"));
    this.seed = Number.isFinite(requestedSeed) && requestedSeed > 0
      ? Math.floor(requestedSeed)
      : Math.floor((Date.now() + Math.random() * 1_000_000) % 9_999_999) + 1;
    this.layout = generateClinicLayout(this.seed, WIDTH, HEIGHT);
    this.state = createShiftState(this.layout.stations);
    this.nextSpawnAtMs = 18_000;
    this.resultsShown = false;
    this.patientViews.clear();
    this.departingPatients.clear();
    this.worldItems = [];
    this.carriedItem = undefined;
    this.escortedPatientId = undefined;

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

    if (this.state.phase === "briefing") {
      this.stopPlayer();
      if (this.interactionPressed()) this.startShift();
      return;
    }

    if (this.state.phase === "results") {
      this.stopPlayer();
      this.updateCarriedItem();
      if (!this.resultsShown) this.showResults();
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) this.scene.restart();
      return;
    }

    this.movePlayer();
    this.updateCarriedItem();
    this.updatePatientViews();

    const previousIds = new Set([...this.state.queue, ...this.state.activePatients].map((patient) => patient.id));
    this.state = tickShift(this.state, delta);
    const currentIds = new Set([...this.state.queue, ...this.state.activePatients].map((patient) => patient.id));
    for (const id of previousIds) {
      if (!currentIds.has(id) && !this.state.completedPatients.some((patient) => patient.id === id)) {
        this.sendPatientOut(id, false);
        if (this.escortedPatientId === id) this.escortedPatientId = undefined;
      }
    }

    if (this.state.phase === "results") {
      this.refreshUi(true);
      return;
    }

    if (this.state.elapsedMs >= this.nextSpawnAtMs && this.state.queue.length < 3) {
      this.spawnPatient();
      this.nextSpawnAtMs += 18_000;
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
    if (this.textures.exists("intern")) return;
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x2f8588, 1);
    graphics.fillCircle(24, 24, 21);
    graphics.lineStyle(4, 0x235d62, 1);
    graphics.strokeCircle(24, 24, 20);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(17, 8, 14, 32, 4);
    graphics.fillRoundedRect(8, 17, 32, 14, 4);
    graphics.generateTexture("intern", 48, 48);
    graphics.destroy();
  }

  private drawClinic(): void {
    this.wallGroup = this.physics.add.staticGroup();
    this.stationGroup = this.physics.add.staticGroup();
    this.stationStatusLayer = this.add.container(0, 0).setDepth(18);

    const background = this.add.graphics().setDepth(0);
    background.fillStyle(0xd9d1c3, 1);
    background.fillRect(0, 0, WIDTH, HEIGHT);
    background.fillStyle(0x294c50, 1);
    background.fillRect(0, 0, WIDTH, HUD_H);

    background.fillStyle(0xd6cdbf, 1);
    background.fillRect(
      this.layout.corridor.x,
      this.layout.corridor.y,
      this.layout.corridor.width,
      this.layout.corridor.height,
    );

    for (const room of this.layout.rooms) {
      background.fillStyle(ROOM_COLORS[room.kind], 1);
      background.fillRect(room.x, room.y, room.width, room.height);

      const tile = room.kind === "treatment" || room.kind === "analyzer" ? 0xffffff : 0x6c8b80;
      for (let x = room.x + 28; x < room.x + room.width; x += 46) {
        for (let y = room.y + 28; y < room.y + room.height; y += 46) {
          background.fillStyle(tile, room.kind === "treatment" || room.kind === "analyzer" ? 0.12 : 0.055);
          background.fillCircle(x, y, 2.5);
        }
      }

      this.add.text(room.x + 20, room.y + 18, room.label, this.textStyle(14, "#385557", 900)).setDepth(4);
      this.add.text(
        room.x + 20,
        room.y + 40,
        this.roomSubtitle(room.kind),
        this.textStyle(10, "#71807b", 700),
      ).setDepth(4);

      const door = this.add.rectangle(room.doorX, room.doorY, 72, 9, 0xf7f1e6, 1).setDepth(5);
      door.setStrokeStyle(2, 0x9a8f81, 0.7);
    }

    for (const segment of this.layout.walls) {
      const wall = this.add.rectangle(segment.x, segment.y, segment.width, segment.height, 0x5f6b68, 1).setDepth(8);
      wall.setStrokeStyle(2, 0x44504e, 1);
      this.physics.add.existing(wall, true);
      this.wallGroup.add(wall);
    }

    const rightBlock = this.add.rectangle(
      WIDTH - 12,
      this.layout.corridor.y + this.layout.corridor.height / 2,
      24,
      this.layout.corridor.height,
      0x5f6b68,
      1,
    ).setDepth(8);
    this.physics.add.existing(rightBlock, true);
    this.wallGroup.add(rightBlock);

    this.drawExit();

    for (const station of this.state.stations) {
      const shadow = this.add.rectangle(station.x + 5, station.y + 7, station.width, station.height, 0x394744, 0.18).setDepth(9);
      const counter = this.add.rectangle(
        station.x,
        station.y,
        station.width,
        station.height,
        this.stationBaseColor(station.kind),
        1,
      ).setDepth(10);
      counter.setStrokeStyle(3, 0x5d706b, 0.75);
      this.add.text(station.x, station.y - 8, station.label, this.textStyle(12, "#2e4548", 900))
        .setOrigin(0.5)
        .setDepth(11);
      this.add.text(station.x, station.y + 13, this.stationSubtitle(station), this.textStyle(9, "#647673", 700))
        .setOrigin(0.5)
        .setDepth(11);
      shadow.setVisible(true);
      this.physics.add.existing(counter, true);
      this.stationGroup.add(counter);
    }
  }

  private drawExit(): void {
    const x = this.layout.exit.x;
    const y = this.layout.exit.y;
    this.add.rectangle(x, y, 34, this.layout.corridor.height - 18, 0x7eb69d, 0.75).setDepth(2);
    this.add.text(x + 13, y, "WYJŚCIE", this.textStyle(10, "#ffffff", 900))
      .setOrigin(0.5)
      .setAngle(-90)
      .setDepth(3);
  }

  private createWorldItems(): void {
    for (const spawn of this.layout.itemSpawns) {
      this.worldItems.push(this.makeWorldItem(spawn.id, spawn.item, spawn.x, spawn.y));
    }
  }

  private makeWorldItem(id: string, type: ItemType, x: number, y: number): WorldItem {
    const shadow = this.add.ellipse(4, 10, 34, 18, 0x172b2c, 0.16);
    const body = this.add.rectangle(0, 0, 38, 34, ITEM_COLORS[type], 1).setStrokeStyle(3, 0x536b67, 0.75);
    const icon = this.add.text(0, -2, ITEM_ICONS[type], this.textStyle(type === "treat" ? 16 : 11, "#334b4d", 900)).setOrigin(0.5);
    const label = this.add.text(0, 26, ITEM_LABELS[type], this.textStyle(9, "#3f595a", 800))
      .setOrigin(0.5)
      .setBackgroundColor("#fffaf0")
      .setPadding(5, 2, 5, 2);
    const container = this.add.container(x, y, [shadow, body, icon, label]).setDepth(14);
    return { id, type, homeX: x, homeY: y, container, carried: false };
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(this.layout.playerSpawn.x, this.layout.playerSpawn.y, "intern").setDepth(30);
    this.player.setCircle(20, 4, 4);
    this.player.setCollideWorldBounds(true);
    this.physics.add.collider(this.player, this.wallGroup);
    this.physics.add.collider(this.player, this.stationGroup);

    const label = this.add.text(0, 0, "STAŻYSTA", this.textStyle(10, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#294c50")
      .setPadding(6, 2, 6, 2)
      .setDepth(31);
    this.events.on("update", () => label.setPosition(this.player.x, this.player.y + 35));
  }

  private createHud(): void {
    this.hudText = this.add.text(18, 17, "", this.textStyle(17, "#ffffff", 900)).setDepth(100);
    this.itemText = this.add.text(WIDTH - 18, 17, "", this.textStyle(14, "#ffffff", 900))
      .setOrigin(1, 0)
      .setDepth(100);
    this.hintText = this.add.text(WIDTH / 2, HEIGHT - 18, "", this.textStyle(13, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#294c50")
      .setPadding(12, 6, 12, 6)
      .setDepth(100);
    this.toastText = this.add.text(WIDTH / 2, 84, "", this.textStyle(14, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(13, 7, 13, 7)
      .setAlpha(0)
      .setDepth(150);
  }

  private showBriefing(): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.75);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 760, 420, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 205, "NOWA ZMIANA • PROCEDURALNA KLINIKA", this.textStyle(28, "#284b50", 900)).setOrigin(0.5);
    const seed = this.add.text(WIDTH / 2, 242, `SEED ${this.seed}`, this.textStyle(13, "#788981", 800)).setOrigin(0.5);
    const body = this.add.text(
      WIDTH / 2,
      360,
      "Pacjenci czekają fizycznie w poczekalni.\nPrzyjmij ich przy recepcji i zaprowadź do właściwego gabinetu.\nNarzędzia leżą w magazynie — podnosisz jeden przedmiot, niesiesz go i możesz odłożyć.\nPo zabiegu brudny stół wymaga środka do dezynfekcji.",
      { ...this.textStyle(17, "#405b5b", 750), align: "center", lineSpacing: 10 },
    ).setOrigin(0.5);
    const controls = this.add.text(
      WIDTH / 2,
      488,
      "WASD / STRZAŁKI — ruch     E / SPACE — interakcja     Q — podpowiedź",
      this.textStyle(13, "#5f7470", 850),
    ).setOrigin(0.5);
    const start = this.add.text(WIDTH / 2, 545, "NACIŚNIJ E, ABY OTWORZYĆ KLINIKĘ", this.textStyle(15, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(18, 10, 18, 10);
    this.briefingLayer = this.add.container(0, 0, [shade, panel, title, seed, body, controls, start]).setDepth(300);
  }

  private startShift(): void {
    this.state = beginShift(this.state);
    this.briefingLayer?.destroy(true);
    this.briefingLayer = undefined;
    this.spawnPatient();
    this.spawnPatient();
    this.spawnPatient();
    this.toast("Klinika otwarta — pacjenci już czekają!");
    this.refreshUi(true);
  }

  private spawnPatient(): void {
    if (this.state.queue.length >= 3 || this.state.phase !== "active") return;
    const sequence = this.state.patientSequence + 1;
    const definition = PATIENT_DEFINITIONS[(sequence - 1) % PATIENT_DEFINITIONS.length];
    const patient = createPatient(definition, sequence);
    this.state = enqueuePatient(this.state, patient);
    this.ensurePatientView(patient);
    this.repositionQueuePatients();
  }

  private ensurePatientView(patient: PatientCase): PatientView {
    const existing = this.patientViews.get(patient.id);
    if (existing) return existing;

    const body = this.add.circle(0, 0, 24, patient.color, 1).setStrokeStyle(3, 0x51615e, 0.8);
    const face = this.add.circle(7, 2, 4, 0xffffff, 0.95);
    const pupil = this.add.circle(8, 2, 1.8, 0x263f40, 1);
    const nose = this.add.circle(17, 9, 3, 0x4c5552, 1);
    const speciesBits: Phaser.GameObjects.GameObject[] = [];

    if (patient.species === "rabbit") {
      speciesBits.push(this.add.ellipse(-10, -26, 12, 30, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.65));
      speciesBits.push(this.add.ellipse(8, -28, 12, 32, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.65));
    } else if (patient.species === "cat") {
      speciesBits.push(this.add.triangle(-11, -19, 0, 18, 9, 0, 18, 18, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.65));
      speciesBits.push(this.add.triangle(8, -19, 0, 18, 9, 0, 18, 18, patient.color, 1).setStrokeStyle(2, 0x51615e, 0.65));
    } else {
      speciesBits.push(this.add.ellipse(-16, -13, 13, 24, patient.color, 1).setAngle(25).setStrokeStyle(2, 0x51615e, 0.65));
      speciesBits.push(this.add.ellipse(15, -13, 13, 24, patient.color, 1).setAngle(-25).setStrokeStyle(2, 0x51615e, 0.65));
    }

    const status = this.add.text(0, -46, "CZEKA", this.textStyle(9, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor(this.priorityColorCss(patient.priority))
      .setPadding(5, 2, 5, 2);
    const name = this.add.text(0, 36, patient.displayName, this.textStyle(9, "#344d4e", 800))
      .setOrigin(0.5)
      .setBackgroundColor("#fffaf0")
      .setPadding(5, 2, 5, 2);

    const container = this.add.container(-100, -100, [...speciesBits, body, face, pupil, nose, status, name]).setDepth(24);
    const view = { container, status, name };
    this.patientViews.set(patient.id, view);
    return view;
  }

  private repositionQueuePatients(): void {
    this.state.queue.forEach((patient, index) => {
      const view = this.ensurePatientView(patient);
      const point = this.layout.patientSpawns[index % this.layout.patientSpawns.length];
      view.container.setPosition(point.x, point.y);
      view.status.setText(`${patient.priority === "critical" ? "!!!" : patient.priority === "urgent" ? "!" : ""} CZEKA`);
    });
  }

  private updatePatientViews(): void {
    this.repositionQueuePatients();

    for (const patient of this.state.activePatients) {
      const view = this.ensurePatientView(patient);
      if (patient.id === this.escortedPatientId) {
        const targetX = this.player.x - this.facing.x * 42;
        const targetY = this.player.y - this.facing.y * 42 + 8;
        view.container.x = Phaser.Math.Linear(view.container.x, targetX, 0.15);
        view.container.y = Phaser.Math.Linear(view.container.y, targetY, 0.15);
        view.status.setText("ZA TOBĄ");
        continue;
      }

      const station = this.state.stations.find((candidate) => candidate.patientId === patient.id);
      if (station) {
        view.container.x = Phaser.Math.Linear(view.container.x, station.x, 0.14);
        view.container.y = Phaser.Math.Linear(view.container.y, station.y - station.height / 2 - 34, 0.14);
        view.status.setText(station.status === "waitingItem" ? `CZEKA: ${ITEM_LABELS[patient.requiredItem]}` : "ZABIEG");
      }
    }
  }

  private sendPatientOut(patientId: string, happy: boolean): void {
    const view = this.patientViews.get(patientId);
    if (!view || this.departingPatients.has(patientId)) return;
    this.departingPatients.add(patientId);
    view.status.setText(happy ? "ZDROWY!" : "WYCHODZI");
    view.status.setBackgroundColor(happy ? "#4f9e75" : "#a25e58");
    this.tweens.add({
      targets: view.container,
      x: this.layout.exit.x + 10,
      y: this.layout.exit.y,
      alpha: 0,
      duration: 1400,
      ease: "Sine.easeInOut",
      onComplete: () => {
        view.container.destroy(true);
        this.patientViews.delete(patientId);
        this.departingPatients.delete(patientId);
      },
    });
  }

  private movePlayer(): void {
    const body = this.player.body as Phaser.Physics.Arcade.Body;
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    let vx = Number(right) - Number(left);
    let vy = Number(down) - Number(up);
    if (vx !== 0 || vy !== 0) {
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
    this.carriedItem.container.setPosition(this.player.x + this.facing.x * 8, this.player.y - 48);
    this.carriedItem.container.setDepth(40);
  }

  private handleInteraction(): void {
    const station = this.nearestStation();

    if (station?.status === "dirty" && this.carriedItem?.type === "disinfectant") {
      this.state = cleanStation(this.state, station.id);
      this.consumeCarriedItem();
      this.toast(`${station.label}: stanowisko wyczyszczone.`);
      this.refreshUi(true);
      return;
    }

    if (this.escortedPatientId && station?.status === "available") {
      const patient = this.state.activePatients.find((candidate) => candidate.id === this.escortedPatientId);
      if (patient && station.kind === patient.treatmentStation) {
        this.state = assignPatientToStation(this.state, patient.id, station.id);
        this.escortedPatientId = undefined;
        this.toast(`${patient.displayName} trafia do: ${station.label}.`);
        this.refreshUi(true);
        return;
      }
    }

    if (station?.kind === "reception" && !this.escortedPatientId && this.state.queue.length > 0) {
      const patient = this.state.queue[0];
      this.state = admitPatient(this.state, patient.id);
      this.escortedPatientId = patient.id;
      this.toast(`Przyjęto: ${patient.displayName}. Zaprowadź pacjenta do właściwego pokoju.`);
      this.repositionQueuePatients();
      this.refreshUi(true);
      return;
    }

    if (station?.patientId && station.status === "waitingItem" && this.carriedItem) {
      const patient = this.state.activePatients.find((candidate) => candidate.id === station.patientId);
      if (!patient) return;
      const correct = patient.requiredItem === this.carriedItem.type;
      this.state = deliverRequiredItem(this.state, patient.id, this.carriedItem.type);
      if (correct) {
        this.toast(`${ITEM_LABELS[this.carriedItem.type]} dostarczony. Stanowisko gotowe do procedury.`);
        this.consumeCarriedItem();
      } else {
        this.toast(`To nie ten przedmiot. Potrzebny: ${ITEM_LABELS[patient.requiredItem]}.`, 0x9b5a55);
      }
      this.refreshUi(true);
      return;
    }

    if (station?.patientId && station.status === "procedure" && !this.carriedItem) {
      const patient = this.state.activePatients.find((candidate) => candidate.id === station.patientId);
      if (patient) {
        this.startMinigame(patient);
        return;
      }
    }

    if (!this.carriedItem) {
      const item = this.nearestWorldItem();
      if (item) {
        this.pickUpItem(item);
        return;
      }
    } else {
      this.dropCarriedItem();
      return;
    }

    if (station?.status === "dirty") {
      this.toast("Brudne stanowisko — przynieś środek do dezynfekcji.", 0x8f6358);
      return;
    }

    if (station?.status === "waitingItem" && station.patientId) {
      const patient = this.state.activePatients.find((candidate) => candidate.id === station.patientId);
      if (patient) this.toast(`Potrzebny przedmiot: ${ITEM_LABELS[patient.requiredItem]}.`);
      return;
    }

    this.toast("Tu nie ma teraz nic do zrobienia.", 0x6d7775);
  }

  private pickUpItem(item: WorldItem): void {
    item.carried = true;
    this.carriedItem = item;
    item.container.setScale(1.12);
    this.toast(`Podnosisz: ${ITEM_LABELS[item.type]}.`);
    this.refreshUi(true);
  }

  private dropCarriedItem(): void {
    if (!this.carriedItem) return;
    const item = this.carriedItem;
    item.carried = false;
    item.container.setScale(1);
    item.container.setPosition(
      Phaser.Math.Clamp(this.player.x + this.facing.x * 56, 28, WIDTH - 28),
      Phaser.Math.Clamp(this.player.y + this.facing.y * 56, HUD_H + 20, HEIGHT - 26),
    );
    item.container.setDepth(14);
    this.carriedItem = undefined;
    this.toast(`Odkładasz: ${ITEM_LABELS[item.type]}.`);
    this.refreshUi(true);
  }

  private consumeCarriedItem(): void {
    if (!this.carriedItem) return;
    const item = this.carriedItem;
    this.carriedItem = undefined;
    item.carried = false;
    item.container.setVisible(false).setScale(1);
    this.time.delayedCall(1600, () => {
      item.container.setPosition(item.homeX, item.homeY).setVisible(true).setDepth(14);
    });
  }

  private nearestWorldItem(): WorldItem | undefined {
    let best: WorldItem | undefined;
    let distance = ITEM_DISTANCE;
    for (const item of this.worldItems) {
      if (item.carried || !item.container.visible) continue;
      const current = Phaser.Math.Distance.Between(this.player.x, this.player.y, item.container.x, item.container.y);
      if (current < distance) {
        best = item;
        distance = current;
      }
    }
    return best;
  }

  private nearestStation(): StationState | undefined {
    let best: StationState | undefined;
    let distance = INTERACT_DISTANCE;
    for (const station of this.state.stations) {
      const dx = Math.max(Math.abs(this.player.x - station.x) - station.width / 2, 0);
      const dy = Math.max(Math.abs(this.player.y - station.y) - station.height / 2, 0);
      const current = Math.hypot(dx, dy);
      if (current < distance) {
        best = station;
        distance = current;
      }
    }
    return best;
  }

  private startMinigame(patient: PatientCase): void {
    if (patient.procedure === "sampleAnalysis") this.startSampleMinigame(patient);
    else this.startTimingMinigame(patient);
  }

  private startTimingMinigame(patient: PatientCase): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.65);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 650, 330, 0xfffbf3, 1).setStrokeStyle(4, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 245, PROCEDURE_LABELS[patient.procedure], this.textStyle(26, "#284b50", 900)).setOrigin(0.5);
    const info = this.add.text(WIDTH / 2, 286, "Naciśnij E / Space, gdy wskaźnik jest w zielonej strefie. 3 próby.", this.textStyle(13, "#607774", 750)).setOrigin(0.5);
    const bar = this.add.rectangle(WIDTH / 2, 365, 380, 24, 0xcbd6d1, 1).setStrokeStyle(2, 0x6e817c, 1);
    const zone = this.add.rectangle(WIDTH / 2, 365, 95, 24, 0x75b98f, 1);
    const marker = this.add.rectangle(WIDTH / 2 - 185, 365, 10, 46, 0xe07063, 1);
    const progress = this.add.text(WIDTH / 2, 425, "Próby: 0 / 3", this.textStyle(16, "#385557", 900)).setOrigin(0.5);
    const container = this.add.container(0, 0, [shade, panel, title, info, bar, zone, marker, progress]).setDepth(400);

    this.activeMinigame = {
      kind: "timing",
      patientId: patient.id,
      procedure: patient.procedure,
      container,
      marker,
      progress,
      attempts: 0,
      accuracySum: 0,
      startedAt: this.time.now,
    };
  }

  private startSampleMinigame(patient: PatientCase): void {
    const sequence = [0, 1, 2].map(() => Phaser.Math.Between(1, 4));
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.65);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 660, 350, 0xfffbf3, 1).setStrokeStyle(4, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 235, "ANALIZA PRÓBKI", this.textStyle(26, "#284b50", 900)).setOrigin(0.5);
    const info = this.add.text(WIDTH / 2, 280, "Dobierz właściwy filtr klawiszami 1–4.", this.textStyle(14, "#607774", 750)).setOrigin(0.5);
    const prompt = this.add.text(WIDTH / 2, 360, `FILTR ${sequence[0]}`, this.textStyle(38, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#4b8c91")
      .setPadding(28, 12, 28, 12);
    const progress = this.add.text(WIDTH / 2, 440, "Próbka: 1 / 3", this.textStyle(16, "#385557", 900)).setOrigin(0.5);
    const container = this.add.container(0, 0, [shade, panel, title, info, prompt, progress]).setDepth(400);

    this.activeMinigame = {
      kind: "sample",
      patientId: patient.id,
      procedure: patient.procedure,
      container,
      prompt,
      progress,
      sequence,
      index: 0,
      correct: 0,
      attempts: 0,
      startedAt: this.time.now,
    };
  }

  private updateMinigame(time: number): void {
    const minigame = this.activeMinigame;
    if (!minigame) return;

    if (minigame.kind === "timing") {
      const phase = ((time - minigame.startedAt) % 1800) / 1800;
      minigame.marker.x = WIDTH / 2 - 185 + Math.abs(Math.sin(phase * Math.PI)) * 370;
      if (this.interactionPressed()) {
        const accuracy = Math.max(0, 1 - Math.abs(minigame.marker.x - WIDTH / 2) / 180);
        minigame.accuracySum += accuracy;
        minigame.attempts += 1;
        minigame.progress.setText(`Próby: ${minigame.attempts} / 3   Trafienie: ${Math.round(accuracy * 100)}%`);
        if (minigame.attempts >= 3) {
          const average = minigame.accuracySum / minigame.attempts;
          this.finishMinigame(minigame.patientId, average, time - minigame.startedAt);
        }
      }
      return;
    }

    for (let index = 0; index < this.numberKeys.length; index += 1) {
      if (!Phaser.Input.Keyboard.JustDown(this.numberKeys[index])) continue;
      const choice = index + 1;
      const expected = minigame.sequence[minigame.index];
      minigame.attempts += 1;
      if (choice === expected) minigame.correct += 1;
      else this.state = registerMistake(this.state, 2);
      minigame.index += 1;

      if (minigame.index >= minigame.sequence.length) {
        const accuracy = minigame.correct / minigame.sequence.length;
        this.finishMinigame(minigame.patientId, accuracy, time - minigame.startedAt);
      } else {
        minigame.prompt.setText(`FILTR ${minigame.sequence[minigame.index]}`);
        minigame.progress.setText(`Próbka: ${minigame.index + 1} / ${minigame.sequence.length}`);
      }
      break;
    }
  }

  private finishMinigame(patientId: string, accuracy: number, durationMs: number): void {
    const quality: TreatmentQuality = accuracy >= 0.82 ? "perfect" : accuracy >= 0.55 ? "correct" : "quick";
    this.activeMinigame?.container.destroy(true);
    this.activeMinigame = undefined;
    const patient = this.state.activePatients.find((candidate) => candidate.id === patientId);
    this.state = completeTreatment(this.state, patientId, { quality, accuracy, durationMs });
    if (patient) this.toast(`${patient.displayName}: ${quality === "perfect" ? "perfekcyjnie" : quality === "correct" ? "dobrze" : "szybko"}!`);
    this.sendPatientOut(patientId, true);
    this.refreshUi(true);
  }

  private pingPriorityTask(): void {
    if (this.escortedPatientId) {
      const patient = this.state.activePatients.find((candidate) => candidate.id === this.escortedPatientId);
      if (patient) this.toast(`Cel: zaprowadź ${patient.displayName} do ${patient.treatmentStation === "analyzer" ? "diagnostyki" : "gabinetu zabiegowego"}.`);
      return;
    }
    const waiting = this.state.stations.find((station) => station.status === "waitingItem" && station.patientId);
    if (waiting?.patientId) {
      const patient = this.state.activePatients.find((candidate) => candidate.id === waiting.patientId);
      if (patient) this.toast(`Cel: ${ITEM_LABELS[patient.requiredItem]} → ${waiting.label}.`);
      return;
    }
    const dirty = this.state.stations.find((station) => station.status === "dirty");
    if (dirty) {
      this.toast(`Cel: środek do dezynfekcji → ${dirty.label}.`);
      return;
    }
    if (this.state.queue.length > 0) {
      this.toast("Cel: podejdź do recepcji i przyjmij pierwszego pacjenta.");
      return;
    }
    this.toast("Na razie spokojnie — przygotuj się na następnego pacjenta.");
  }

  private refreshUi(force = false): void {
    const seconds = Math.ceil(this.state.remainingMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const sec = String(seconds % 60).padStart(2, "0");
    this.hudText.setText(
      `ZMIANA 1   ${minutes}:${sec}   •   Wynik ${scoreTotal(this.state.score)}   •   Wyleczeni ${this.state.score.treated}   •   Stres ${Math.round(this.state.clinicStress)}%   •   Seed ${this.seed}`,
    );
    this.itemText.setText(this.carriedItem ? `NIESIESZ: ${ITEM_LABELS[this.carriedItem.type]}` : "RĘCE WOLNE");
    this.refreshStationStatuses();
    this.updateHint();
    if (force) this.updatePatientViews();
  }

  private refreshStationStatuses(): void {
    this.stationStatusLayer.removeAll(true);
    for (const station of this.state.stations) {
      if (station.status === "available") continue;
      let label = station.status.toUpperCase();
      let color = "#6c7774";
      if (station.status === "waitingItem") {
        const patient = this.state.activePatients.find((candidate) => candidate.id === station.patientId);
        label = patient ? `POTRZEBA: ${ITEM_LABELS[patient.requiredItem]}` : "CZEKA";
        color = "#b17c4e";
      } else if (station.status === "procedure") {
        label = "GOTOWE DO ZABIEGU";
        color = "#4d8b87";
      } else if (station.status === "dirty") {
        label = "BRUDNE";
        color = "#9d5f57";
      }
      const text = this.add.text(station.x, station.y + station.height / 2 + 16, label, this.textStyle(9, "#ffffff", 900))
        .setOrigin(0.5)
        .setBackgroundColor(color)
        .setPadding(6, 2, 6, 2);
      this.stationStatusLayer.add(text);
    }
  }

  private updateHint(): void {
    if (this.activeMinigame) return;
    const station = this.nearestStation();
    const item = !this.carriedItem ? this.nearestWorldItem() : undefined;

    if (station?.status === "dirty" && this.carriedItem?.type === "disinfectant") {
      this.hintText.setText("E — wyczyść stanowisko");
    } else if (this.escortedPatientId && station?.status === "available") {
      const patient = this.state.activePatients.find((candidate) => candidate.id === this.escortedPatientId);
      this.hintText.setText(patient && station.kind === patient.treatmentStation ? `E — zostaw pacjenta przy ${station.label}` : "To nie jest właściwe stanowisko dla pacjenta");
    } else if (station?.kind === "reception" && this.state.queue.length > 0 && !this.escortedPatientId) {
      this.hintText.setText(`E — przyjmij: ${this.state.queue[0].displayName}`);
    } else if (station?.status === "waitingItem" && station.patientId && this.carriedItem) {
      const patient = this.state.activePatients.find((candidate) => candidate.id === station.patientId);
      this.hintText.setText(patient ? `E — dostarcz przedmiot • potrzebny ${ITEM_LABELS[patient.requiredItem]}` : "E — interakcja");
    } else if (station?.status === "procedure" && station.patientId && !this.carriedItem) {
      this.hintText.setText("E — rozpocznij procedurę");
    } else if (item) {
      this.hintText.setText(`E — podnieś ${ITEM_LABELS[item.type]}`);
    } else if (this.carriedItem) {
      this.hintText.setText(`E — odłóż ${ITEM_LABELS[this.carriedItem.type]}`);
    } else {
      this.hintText.setText("Q — pokaż najważniejsze zadanie");
    }
  }

  private showResults(): void {
    this.resultsShown = true;
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.75);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 680, 420, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const stars = starRating(this.state.score);
    const title = this.add.text(WIDTH / 2, 205, "KONIEC ZMIANY", this.textStyle(30, "#284b50", 900)).setOrigin(0.5);
    const starText = this.add.text(WIDTH / 2, 260, `${"★".repeat(stars)}${"☆".repeat(3 - stars)}`, this.textStyle(40, "#d3a34d", 900)).setOrigin(0.5);
    const body = this.add.text(
      WIDTH / 2,
      370,
      `Wyleczeni: ${this.state.score.treated}\nMonety: ${this.state.score.coins}\nBłędy: ${this.state.score.mistakes}\nWynik: ${scoreTotal(this.state.score)}\nSeed kliniki: ${this.seed}`,
      { ...this.textStyle(17, "#405b5b", 800), align: "center", lineSpacing: 8 },
    ).setOrigin(0.5);
    const again = this.add.text(WIDTH / 2, 520, "R — WYGENERUJ NOWY SZPITAL", this.textStyle(15, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(18, 10, 18, 10);
    this.resultsLayer = this.add.container(0, 0, [shade, panel, title, starText, body, again]).setDepth(500);
  }

  private toast(message: string, color = 0x3c8f91): void {
    this.toastText.setText(message).setBackgroundColor(`#${color.toString(16).padStart(6, "0")}`).setAlpha(1);
    this.tweens.killTweensOf(this.toastText);
    this.tweens.add({ targets: this.toastText, alpha: 0, delay: 1800, duration: 320 });
  }

  private roomSubtitle(kind: ClinicRoomKind): string {
    if (kind === "waiting") return "pacjenci czekają tutaj fizycznie";
    if (kind === "reception") return "przyjmowanie i delegowanie";
    if (kind === "storage") return "narzędzia i środki";
    if (kind === "analyzer") return "próbki i diagnostyka";
    return "leczenie i procedury";
  }

  private stationSubtitle(station: StationState): string {
    if (station.kind === "reception") return "przyjmij pacjenta";
    if (station.kind === "storage") return "przedmioty leżą obok";
    if (station.kind === "analyzer") return "analiza próbek";
    return "stół zabiegowy";
  }

  private stationBaseColor(kind: StationState["kind"]): number {
    if (kind === "reception") return 0xb6d7c9;
    if (kind === "storage") return 0xdcc79e;
    if (kind === "analyzer") return 0xaecbdd;
    return 0xd8b4ac;
  }

  private priorityColorCss(priority: PatientCase["priority"]): string {
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
      fontFamily: "Inter, Segoe UI, Arial, sans-serif",
      fontWeight: `${fontWeight}`,
    } as Phaser.Types.GameObjects.Text.TextStyle;
  }
}
