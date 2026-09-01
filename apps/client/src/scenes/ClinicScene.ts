import Phaser from "phaser";
import {
  ITEM_LABELS,
  MVP_STATIONS,
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
  registerMistake,
  scoreTotal,
  starRating,
  tickShift,
  type ItemType,
  type PatientCase,
  type ProcedureType,
  type ShiftState,
  type StationState,
  type TreatmentQuality,
} from "@animal-care/shared";

type TimingMinigame = {
  kind: "timing";
  patientId: string;
  procedure: ProcedureType;
  container: Phaser.GameObjects.Container;
  marker: Phaser.GameObjects.Rectangle;
  progressText: Phaser.GameObjects.Text;
  attempts: number;
  accuracySum: number;
  startedAt: number;
};

type SampleMinigame = {
  kind: "sample";
  patientId: string;
  procedure: ProcedureType;
  container: Phaser.GameObjects.Container;
  promptText: Phaser.GameObjects.Text;
  progressText: Phaser.GameObjects.Text;
  sequence: number[];
  index: number;
  attempts: number;
  correct: number;
  startedAt: number;
};

type ActiveMinigame = TimingMinigame | SampleMinigame;

const WIDTH = 1280;
const HEIGHT = 720;
const HUD_H = 62;
const LEFT_PANEL_W = 244;
const MOVE_SPEED = 245;
const INTERACT_DISTANCE = 100;

export class ClinicScene extends Phaser.Scene {
  private state: ShiftState = createShiftState(MVP_STATIONS);
  private player!: Phaser.Physics.Arcade.Sprite;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: Record<"up" | "down" | "left" | "right", Phaser.Input.Keyboard.Key>;
  private interactKey!: Phaser.Input.Keyboard.Key;
  private pingKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private numberKeys!: Phaser.Input.Keyboard.Key[];

  private hudText!: Phaser.GameObjects.Text;
  private hintText!: Phaser.GameObjects.Text;
  private toastText!: Phaser.GameObjects.Text;
  private queueLayer!: Phaser.GameObjects.Container;
  private stationStatusLayer!: Phaser.GameObjects.Container;
  private escortBadge!: Phaser.GameObjects.Container;
  private escortBadgeText!: Phaser.GameObjects.Text;

  private escortedPatientId?: string;
  private carriedItem?: ItemType;
  private activeMinigame?: ActiveMinigame;
  private briefingLayer?: Phaser.GameObjects.Container;
  private resultsLayer?: Phaser.GameObjects.Container;
  private nextSpawnAtMs = 18_000;
  private lastUiRefresh = 0;
  private lastToastAt = 0;
  private resultsShown = false;

  constructor() {
    super("ClinicScene");
  }

  create(): void {
    this.createInput();
    this.createPlayerTexture();
    this.drawClinic();
    this.createPlayer();
    this.createHud();
    this.showBriefing();
    this.refreshUi(true);
  }

  update(time: number, delta: number): void {
    if (this.activeMinigame) {
      this.updateMinigame(time);
      return;
    }

    if (this.state.phase === "briefing") {
      this.stopPlayer();
      if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
        this.startShift();
      }
      return;
    }

    if (this.state.phase === "results") {
      this.stopPlayer();
      if (!this.resultsShown) this.showResults();
      if (Phaser.Input.Keyboard.JustDown(this.restartKey)) this.scene.restart();
      return;
    }

    this.movePlayer();
    this.updateEscortBadge();

    this.state = tickShift(this.state, delta);
    if (this.state.phase === "results") {
      this.refreshUi(true);
      return;
    }

    if (this.state.elapsedMs >= this.nextSpawnAtMs && this.state.queue.length < 3) {
      this.spawnPatient();
      this.nextSpawnAtMs += 18_000;
    }

    if (Phaser.Input.Keyboard.JustDown(this.interactKey)) this.handleInteraction();
    if (Phaser.Input.Keyboard.JustDown(this.pingKey)) this.pingPriorityTask();

    if (time - this.lastUiRefresh > 120) {
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
    keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.SPACE).on("down", () => {
      if (!this.activeMinigame && this.state.phase === "active") this.handleInteraction();
    });
    this.pingKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.Q);
    this.restartKey = keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.R);
    this.numberKeys = [
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.ONE),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.TWO),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.THREE),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FOUR),
      keyboard.addKey(Phaser.Input.Keyboard.KeyCodes.FIVE),
    ];
  }

  private createPlayerTexture(): void {
    if (this.textures.exists("intern")) return;
    const graphics = this.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x3c8f91, 1);
    graphics.fillCircle(24, 24, 22);
    graphics.lineStyle(4, 0x235d62, 1);
    graphics.strokeCircle(24, 24, 20);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRoundedRect(17, 8, 14, 32, 4);
    graphics.fillRoundedRect(8, 17, 32, 14, 4);
    graphics.generateTexture("intern", 48, 48);
    graphics.destroy();
  }

  private drawClinic(): void {
    const g = this.add.graphics();
    g.fillStyle(0xf4eee2, 1);
    g.fillRect(0, 0, WIDTH, HEIGHT);

    g.fillStyle(0x284b50, 1);
    g.fillRect(0, 0, WIDTH, HUD_H);

    g.fillStyle(0xe8dfce, 1);
    g.fillRoundedRect(14, 76, LEFT_PANEL_W - 28, 624, 18);
    g.lineStyle(3, 0xcbbfae, 1);
    g.strokeRoundedRect(14, 76, LEFT_PANEL_W - 28, 624, 18);

    g.fillStyle(0xf9f4e9, 1);
    g.fillRoundedRect(258, 76, 1008, 624, 20);
    g.lineStyle(4, 0xc8bca9, 1);
    g.strokeRoundedRect(258, 76, 1008, 624, 20);

    this.drawRoom(g, 278, 94, 256, 176, 0xdcefdc, "POCZEKALNIA", "kolejka i uspokajanie");
    this.drawRoom(g, 548, 94, 250, 176, 0xe2ecf3, "DIAGNOSTYKA", "analizator + magazyn");
    this.drawRoom(g, 812, 94, 430, 242, 0xf4dfdc, "LECZENIE A", "procedury i narzędzia");
    this.drawRoom(g, 812, 350, 430, 326, 0xf1e4d4, "LECZENIE B", "procedury + czyszczenie");
    this.drawRoom(g, 278, 284, 506, 392, 0xe5eee8, "HUB KLINIKI", "recepcja i główny przepływ");

    g.fillStyle(0xb7d6ca, 1);
    g.fillRoundedRect(336, 438, 300, 88, 18);
    g.lineStyle(3, 0x6f9f91, 1);
    g.strokeRoundedRect(336, 438, 300, 88, 18);

    for (let i = 0; i < 10; i++) {
      const x = 330 + (i % 5) * 82;
      const y = 572 + Math.floor(i / 5) * 44;
      g.fillStyle(0xcfe0d9, 0.7);
      g.fillCircle(x, y, 5);
      g.fillCircle(x + 9, y - 6, 3);
      g.fillCircle(x - 9, y - 6, 3);
    }

    this.add.text(30, 92, "PACJENCI", this.textStyle(18, "#284b50", 900));
    this.add.text(30, 119, "kolejka przyjęć", this.textStyle(13, "#6d7b77", 700));
    this.add.text(278, 653, "E / Space — interakcja     Q — ping zadania", this.textStyle(13, "#667a74", 800));

    const obstacleGroup = this.physics.add.staticGroup();
    for (const station of this.state.stations) {
      const color = this.stationBaseColor(station.kind);
      const stationRect = this.add.rectangle(station.x, station.y, station.width, station.height, color, 1)
        .setStrokeStyle(3, 0x6d776f, 0.45)
        .setDepth(3);
      this.add.text(station.x, station.y - 8, station.label, this.textStyle(14, "#2e4548", 900))
        .setOrigin(0.5)
        .setDepth(4);
      this.add.text(station.x, station.y + 15, this.stationSubtitle(station), this.textStyle(11, "#61716f", 700))
        .setOrigin(0.5)
        .setDepth(4);

      if (station.kind !== "exit") {
        this.physics.add.existing(stationRect, true);
        obstacleGroup.add(stationRect);
      }
    }

    this.stationStatusLayer = this.add.container(0, 0).setDepth(7);
  }

  private drawRoom(
    g: Phaser.GameObjects.Graphics,
    x: number,
    y: number,
    w: number,
    h: number,
    color: number,
    title: string,
    subtitle: string,
  ): void {
    g.fillStyle(color, 0.72);
    g.fillRoundedRect(x, y, w, h, 18);
    g.lineStyle(2, 0xffffff, 0.8);
    g.strokeRoundedRect(x, y, w, h, 18);
    this.add.text(x + 18, y + 14, title, this.textStyle(13, "#415b5d", 900));
    this.add.text(x + 18, y + 34, subtitle, this.textStyle(11, "#6b7c79", 700));
  }

  private createPlayer(): void {
    this.player = this.physics.add.sprite(470, 560, "intern").setDepth(20);
    this.player.setCircle(21, 3, 3);
    this.player.setCollideWorldBounds(true);
    this.player.body.setBoundsRectangle(new Phaser.Geom.Rectangle(260, HUD_H + 20, 1000, 630));

    const playerLabel = this.add.text(0, 0, "STAŻYSTA", this.textStyle(11, "#ffffff", 900))
      .setBackgroundColor("#284b50")
      .setPadding(7, 3, 7, 3)
      .setOrigin(0.5);
    playerLabel.setPosition(this.player.x, this.player.y + 39).setDepth(21);

    this.events.on("update", () => {
      playerLabel.setPosition(this.player.x, this.player.y + 39);
    });

    const badgeBg = this.add.circle(0, 0, 20, 0xffffff, 0.95).setStrokeStyle(3, 0x284b50);
    this.escortBadgeText = this.add.text(0, 0, "", this.textStyle(17, "#284b50", 900)).setOrigin(0.5);
    this.escortBadge = this.add.container(-100, -100, [badgeBg, this.escortBadgeText]).setDepth(25).setVisible(false);
  }

  private createHud(): void {
    this.hudText = this.add.text(20, 17, "", this.textStyle(18, "#ffffff", 900)).setDepth(50);
    this.hintText = this.add.text(WIDTH / 2, HEIGHT - 24, "", this.textStyle(14, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#284b50")
      .setPadding(14, 7, 14, 7)
      .setDepth(60);
    this.toastText = this.add.text(WIDTH / 2, 84, "", this.textStyle(15, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(14, 8, 14, 8)
      .setAlpha(0)
      .setDepth(80);
    this.queueLayer = this.add.container(0, 0).setDepth(40);
  }

  private showBriefing(): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.72);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 670, 390, 0xfffbf3, 1)
      .setStrokeStyle(5, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 222, "PIERWSZA ZMIANA", this.textStyle(34, "#284b50", 900)).setOrigin(0.5);
    const subtitle = this.add.text(WIDTH / 2, 265, "Mała klinika • spokojny poranek", this.textStyle(17, "#66817a", 800)).setOrigin(0.5);
    const body = this.add.text(
      WIDTH / 2,
      365,
      "1. Przyjmij pacjenta przy recepcji\n2. Zaprowadź go do właściwej stacji\n3. Pobierz narzędzie z magazynu\n4. Wykonaj krótką procedurę\n5. Wyczyść stanowisko przed następnym pacjentem",
      { ...this.textStyle(18, "#334f50", 800), align: "left", lineSpacing: 11 },
    ).setOrigin(0.5);
    const start = this.add.text(WIDTH / 2, 530, "NACIŚNIJ  E  ABY OTWORZYĆ KLINIKĘ", this.textStyle(16, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(20, 11, 20, 11);
    this.briefingLayer = this.add.container(0, 0, [shade, panel, title, subtitle, body, start]).setDepth(200);
  }

  private startShift(): void {
    this.state = beginShift(this.state);
    this.briefingLayer?.destroy(true);
    this.briefingLayer = undefined;
    this.spawnPatient();
    this.spawnPatient();
    this.spawnPatient();
    this.toast("Klinika otwarta — zacznij od recepcji!");
    this.refreshUi(true);
  }

  private spawnPatient(): void {
    if (this.state.queue.length >= 3) return;
    const sequence = this.state.patientSequence + 1;
    const definition = PATIENT_DEFINITIONS[(sequence - 1) % PATIENT_DEFINITIONS.length];
    this.state = enqueuePatient(this.state, createPatient(definition, sequence));
    this.refreshUi(true);
  }

  private movePlayer(): void {
    const body = this.player.body;
    const left = this.cursors.left.isDown || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const up = this.cursors.up.isDown || this.wasd.up.isDown;
    const down = this.cursors.down.isDown || this.wasd.down.isDown;

    let vx = Number(right) - Number(left);
    let vy = Number(down) - Number(up);
    if (vx !== 0 && vy !== 0) {
      vx *= Math.SQRT1_2;
      vy *= Math.SQRT1_2;
    }
    body.setVelocity(vx * MOVE_SPEED, vy * MOVE_SPEED);
  }

  private stopPlayer(): void {
    if (this.player?.body) this.player.body.setVelocity(0, 0);
  }

  private handleInteraction(): void {
    const station = this.nearestStation();
    if (!station) {
      this.toast("Podejdź bliżej stanowiska.", 0x6d7775);
      return;
    }

    if (station.kind === "reception") {
      this.interactReception();
      return;
    }

    if (station.kind === "storage") {
      this.interactStorage();
      return;
    }

    if (station.kind === "treatment" || station.kind === "analyzer") {
      this.interactTreatmentStation(station);
      return;
    }
  }

  private interactReception(): void {
    if (this.escortedPatientId) {
      this.toast("Najpierw zaprowadź obecnego pacjenta do stanowiska.", 0x8b6c4e);
      return;
    }
    const patient = this.state.queue[0];
    if (!patient) {
      this.toast("Poczekalnia jest chwilowo pusta.", 0x6d7775);
      return;
    }

    this.state = admitPatient(this.state, patient.id);
    this.escortedPatientId = patient.id;
    this.toast(`${patient.displayName}: ${patient.symptoms[0]}. Zaprowadź do ${patient.treatmentStation === "analyzer" ? "analizatora" : "gabinetu"}.`);
    this.refreshUi(true);
  }

  private interactStorage(): void {
    if (this.carriedItem) {
      this.toast(`Odłożono: ${ITEM_LABELS[this.carriedItem]}.`, 0x6d7775);
      this.carriedItem = undefined;
      this.refreshUi(true);
      return;
    }

    const waitingPatient = this.state.activePatients.find((patient) =>
      this.state.stations.some((station) => station.patientId === patient.id && station.status === "waitingItem"),
    );
    const dirtyExists = this.state.stations.some((station) => station.status === "dirty");
    this.carriedItem = waitingPatient?.requiredItem ?? (dirtyExists ? "disinfectant" : "bandage");
    this.toast(`Pobrano: ${ITEM_LABELS[this.carriedItem]}.`);
    this.refreshUi(true);
  }

  private interactTreatmentStation(station: StationState): void {
    if (this.escortedPatientId) {
      const before = this.state;
      this.state = assignPatientToStation(this.state, this.escortedPatientId, station.id);
      if (this.state === before) {
        const patient = this.findPatient(this.escortedPatientId);
        this.toast(`${patient?.displayName ?? "Pacjent"} potrzebuje innego stanowiska.`, 0x9b6558);
        return;
      }
      const patient = this.findPatient(this.escortedPatientId);
      this.escortedPatientId = undefined;
      this.toast(`${patient?.displayName ?? "Pacjent"} czeka na: ${patient ? ITEM_LABELS[patient.requiredItem] : "narzędzie"}.`);
      this.refreshUi(true);
      return;
    }

    const current = this.state.stations.find((candidate) => candidate.id === station.id)!;
    if (current.status === "dirty") {
      if (this.carriedItem !== "disinfectant") {
        this.toast("Stanowisko trzeba odkazić. Pobierz środek z magazynu.", 0x9b6558);
        return;
      }
      this.state = cleanStation(this.state, station.id);
      this.carriedItem = undefined;
      this.toast("Stanowisko czyste — gotowe dla kolejnego pacjenta.");
      this.refreshUi(true);
      return;
    }

    if (!current.patientId) {
      this.toast("Stanowisko jest wolne.", 0x6d7775);
      return;
    }

    const patient = this.findPatient(current.patientId);
    if (!patient) return;

    if (current.status === "waitingItem") {
      if (this.carriedItem !== patient.requiredItem) {
        this.state = registerMistake(this.state, 2);
        this.toast(`Potrzebujesz: ${ITEM_LABELS[patient.requiredItem]}.`, 0x9b6558);
        return;
      }
      this.state = deliverRequiredItem(this.state, patient.id, this.carriedItem);
      this.carriedItem = undefined;
      this.toast("Narzędzie przygotowane. Zaczynamy procedurę!");
      this.refreshUi(true);
    }

    const readyStation = this.state.stations.find((candidate) => candidate.id === station.id)!;
    if (readyStation.status === "procedure") this.startMinigame(patient);
  }

  private startMinigame(patient: PatientCase): void {
    this.stopPlayer();
    if (patient.procedure === "sampleAnalysis") {
      this.startSampleMinigame(patient);
    } else {
      this.startTimingMinigame(patient);
    }
  }

  private startTimingMinigame(patient: PatientCase): void {
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.78);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 720, 390, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 224, PROCEDURE_LABELS[patient.procedure], this.textStyle(30, "#284b50", 900)).setOrigin(0.5);
    const subtitle = this.add.text(WIDTH / 2, 265, `${patient.displayName} • trafiaj w zielone pole`, this.textStyle(16, "#6b7c79", 800)).setOrigin(0.5);

    const bar = this.add.rectangle(WIDTH / 2, 364, 480, 36, 0xd8d3c7, 1).setStrokeStyle(3, 0xa9a295, 1);
    const target = this.add.rectangle(WIDTH / 2 + 84, 364, 108, 36, 0x7cc39d, 1);
    const marker = this.add.rectangle(WIDTH / 2 - 230, 364, 14, 58, 0x284b50, 1);
    const instruction = this.add.text(WIDTH / 2, 423, "Naciśnij E, gdy wskaźnik jest w zielonym polu", this.textStyle(16, "#37585a", 900)).setOrigin(0.5);
    const progressText = this.add.text(WIDTH / 2, 470, "Próba 1 / 3", this.textStyle(16, "#8b6c4e", 900)).setOrigin(0.5);
    const cancel = this.add.text(WIDTH / 2, 526, "Pomyłka nie kończy zabiegu — obniża tylko jakość", this.textStyle(13, "#7a8079", 700)).setOrigin(0.5);

    const container = this.add.container(0, 0, [shade, panel, title, subtitle, bar, target, marker, instruction, progressText, cancel]).setDepth(300);
    this.activeMinigame = {
      kind: "timing",
      patientId: patient.id,
      procedure: patient.procedure,
      container,
      marker,
      progressText,
      attempts: 0,
      accuracySum: 0,
      startedAt: this.time.now,
    };
  }

  private startSampleMinigame(patient: PatientCase): void {
    const sequence = Array.from({ length: 4 }, () => Phaser.Math.Between(1, 3));
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.78);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 720, 410, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 213, "ANALIZA PRÓBKI", this.textStyle(30, "#284b50", 900)).setOrigin(0.5);
    const subtitle = this.add.text(WIDTH / 2, 254, `${patient.displayName} • wybieraj wskazaną probówkę`, this.textStyle(16, "#6b7c79", 800)).setOrigin(0.5);
    const promptText = this.add.text(WIDTH / 2, 322, `PRÓBÓWKA ${sequence[0]}`, this.textStyle(28, "#284b50", 900)).setOrigin(0.5);

    const buttons: Phaser.GameObjects.GameObject[] = [];
    [1, 2, 3].forEach((number, index) => {
      const x = WIDTH / 2 - 150 + index * 150;
      const rect = this.add.rectangle(x, 405, 112, 78, [0x91c8c5, 0xe5b27f, 0xc9a7c8][index], 1).setStrokeStyle(3, 0xffffff, 1);
      const label = this.add.text(x, 405, String(number), this.textStyle(26, "#ffffff", 900)).setOrigin(0.5);
      buttons.push(rect, label);
    });

    const progressText = this.add.text(WIDTH / 2, 482, "0 / 4 poprawnych", this.textStyle(16, "#8b6c4e", 900)).setOrigin(0.5);
    const instruction = this.add.text(WIDTH / 2, 532, "Klawisze 1–3 • błędna próbka kosztuje czas, ale możesz poprawić", this.textStyle(13, "#6d7775", 700)).setOrigin(0.5);
    const container = this.add.container(0, 0, [shade, panel, title, subtitle, promptText, ...buttons, progressText, instruction]).setDepth(300);

    this.activeMinigame = {
      kind: "sample",
      patientId: patient.id,
      procedure: patient.procedure,
      container,
      promptText,
      progressText,
      sequence,
      index: 0,
      attempts: 0,
      correct: 0,
      startedAt: this.time.now,
    };
  }

  private updateMinigame(time: number): void {
    const game = this.activeMinigame;
    if (!game) return;

    if (game.kind === "timing") {
      const normalized = (Math.sin((time - game.startedAt) / 380) + 1) / 2;
      const x = WIDTH / 2 - 230 + normalized * 460;
      game.marker.x = x;

      if (Phaser.Input.Keyboard.JustDown(this.interactKey)) {
        const targetCenter = WIDTH / 2 + 84;
        const distance = Math.abs(x - targetCenter);
        const accuracy = Phaser.Math.Clamp(1 - distance / 235, 0.15, 1);
        game.accuracySum += accuracy;
        game.attempts += 1;
        game.progressText.setText(game.attempts >= 3 ? "Gotowe" : `Próba ${game.attempts + 1} / 3`);
        if (game.attempts >= 3) this.finishMinigame(game.patientId, game.accuracySum / game.attempts, time - game.startedAt);
      }
      return;
    }

    for (let i = 0; i < 3; i++) {
      if (!Phaser.Input.Keyboard.JustDown(this.numberKeys[i])) continue;
      const chosen = i + 1;
      game.attempts += 1;
      if (chosen === game.sequence[game.index]) {
        game.correct += 1;
        game.index += 1;
        game.progressText.setText(`${game.correct} / 4 poprawnych`);
        if (game.index >= game.sequence.length) {
          const accuracy = Phaser.Math.Clamp(game.correct / Math.max(game.attempts, 1), 0.25, 1);
          this.finishMinigame(game.patientId, accuracy, time - game.startedAt);
        } else {
          game.promptText.setText(`PRÓBÓWKA ${game.sequence[game.index]}`);
        }
      } else {
        game.progressText.setText(`${game.correct} / 4 • zła próbka, spróbuj ponownie`);
        if (game.attempts >= 8) this.finishMinigame(game.patientId, 0.4, time - game.startedAt);
      }
    }
  }

  private finishMinigame(patientId: string, accuracy: number, durationMs: number): void {
    const quality: TreatmentQuality = accuracy >= 0.86 ? "perfect" : accuracy >= 0.62 ? "correct" : "quick";
    this.activeMinigame?.container.destroy(true);
    this.activeMinigame = undefined;
    this.state = completeTreatment(this.state, patientId, { quality, accuracy, durationMs });
    this.toast(`Pacjent wyleczony • jakość: ${this.qualityLabel(quality)} • +monety`);
    this.refreshUi(true);
  }

  private refreshUi(force = false): void {
    if (!force && this.activeMinigame) return;

    const seconds = Math.ceil(this.state.remainingMs / 1000);
    const minutes = Math.floor(seconds / 60);
    const rest = String(seconds % 60).padStart(2, "0");
    const stress = Math.round(this.state.clinicStress);
    const carried = this.carriedItem ? ITEM_LABELS[this.carriedItem] : "puste ręce";
    this.hudText.setText(
      `ANIMAL CARE CO-OP    ${minutes}:${rest}    ♥ stres kliniki ${stress}%    ★ ${scoreTotal(this.state.score)}    ◉ ${this.state.score.coins}    ✚ ${carried}`,
    );

    this.queueLayer.removeAll(true);
    if (this.state.queue.length === 0) {
      this.queueLayer.add(this.add.text(34, 165, "Brak pacjentów\nw kolejce", this.textStyle(15, "#78837e", 800)));
    } else {
      this.state.queue.forEach((patient, index) => {
        const y = 164 + index * 146;
        const card = this.add.rectangle(122, y + 54, 190, 126, 0xfffbf3, 1).setStrokeStyle(3, this.priorityColor(patient.priority), 1);
        const species = this.add.text(42, y + 14, this.speciesEmoji(patient), this.textStyle(28, "#284b50", 900));
        const name = this.add.text(80, y + 16, patient.displayName, this.textStyle(14, "#284b50", 900));
        const symptom = this.add.text(42, y + 51, patient.symptoms[0], this.textStyle(12, "#65746f", 700));
        const patience = Math.round((patient.remainingPatienceMs / patient.patienceMs) * 100);
        const barBg = this.add.rectangle(122, y + 91, 154, 9, 0xd8d3c7, 1);
        const bar = this.add.rectangle(45 + (154 * patience) / 200, y + 91, 1.54 * patience, 9, this.priorityColor(patient.priority), 1).setOrigin(0, 0.5);
        const priority = this.add.text(42, y + 103, `${patient.priority.toUpperCase()} • ${patience}% cierpliwości`, this.textStyle(10, "#756f68", 800));
        this.queueLayer.add([card, species, name, symptom, barBg, bar, priority]);
      });
    }

    this.stationStatusLayer.removeAll(true);
    for (const station of this.state.stations) {
      if (station.kind === "reception" || station.kind === "storage" || station.kind === "exit") continue;
      const current = this.state.stations.find((candidate) => candidate.id === station.id)!;
      const patient = current.patientId ? this.findPatient(current.patientId) : undefined;
      const text = this.stationStatusText(current, patient);
      const badge = this.add.text(station.x, station.y + station.height / 2 + 18, text, this.textStyle(11, "#ffffff", 900))
        .setOrigin(0.5)
        .setBackgroundColor(this.stationStatusColor(current.status))
        .setPadding(8, 4, 8, 4);
      this.stationStatusLayer.add(badge);
    }

    this.hintText.setText(this.currentHint());
    this.updateEscortBadge();
  }

  private currentHint(): string {
    const station = this.nearestStation();
    if (!station) return "Podejdź do stanowiska • WASD / strzałki — ruch";

    if (station.kind === "reception") {
      if (this.escortedPatientId) return "Najpierw zaprowadź pacjenta do wskazanej stacji";
      return this.state.queue.length ? "E — przyjmij pierwszego pacjenta" : "Recepcja • poczekalnia pusta";
    }
    if (station.kind === "storage") {
      return this.carriedItem ? `E — odłóż ${ITEM_LABELS[this.carriedItem]}` : "E — pobierz potrzebny przedmiot";
    }
    if (station.kind === "treatment" || station.kind === "analyzer") {
      if (this.escortedPatientId) return `E — umieść pacjenta w ${station.label.toLowerCase()}`;
      const current = this.state.stations.find((candidate) => candidate.id === station.id)!;
      if (current.status === "dirty") return "E — odkaź stanowisko (potrzebny środek)";
      if (current.status === "waitingItem") return "E — dostarcz wymagany przedmiot";
      if (current.status === "procedure") return "E — rozpocznij procedurę";
      return `${station.label} • wolne stanowisko`;
    }
    return "E — interakcja";
  }

  private nearestStation(maxDistance = INTERACT_DISTANCE): StationState | undefined {
    let best: StationState | undefined;
    let bestDistance = maxDistance;
    for (const station of this.state.stations) {
      if (station.kind === "exit") continue;
      const dx = Math.max(Math.abs(this.player.x - station.x) - station.width / 2, 0);
      const dy = Math.max(Math.abs(this.player.y - station.y) - station.height / 2, 0);
      const distance = Math.hypot(dx, dy);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = station;
      }
    }
    return best;
  }

  private pingPriorityTask(): void {
    const patient = this.state.activePatients.find((candidate) => candidate.priority === "critical")
      ?? this.state.activePatients[0]
      ?? this.state.queue[0];
    if (!patient) {
      this.toast("Ping: wszystko pod kontrolą.", 0x6d7775);
      return;
    }
    const station = this.state.stations.find((candidate) => candidate.patientId === patient.id);
    if (station?.status === "waitingItem") {
      this.toast(`PING → ${patient.displayName}: ${ITEM_LABELS[patient.requiredItem]} do ${station.label}.`, 0xd6815e);
    } else if (patient.state === "queue") {
      this.toast(`PING → ${patient.displayName} czeka w recepcji.`, 0xd6815e);
    } else {
      this.toast(`PING → ${patient.displayName}: kontynuuj leczenie.`, 0xd6815e);
    }
  }

  private showResults(): void {
    this.resultsShown = true;
    const stars = starRating(this.state.score);
    const shade = this.add.rectangle(WIDTH / 2, HEIGHT / 2, WIDTH, HEIGHT, 0x173236, 0.8);
    const panel = this.add.rectangle(WIDTH / 2, HEIGHT / 2, 700, 470, 0xfffbf3, 1).setStrokeStyle(5, 0x8cb5a5, 1);
    const title = this.add.text(WIDTH / 2, 170, "KONIEC ZMIANY", this.textStyle(34, "#284b50", 900)).setOrigin(0.5);
    const starText = this.add.text(WIDTH / 2, 229, `${"★".repeat(stars)}${"☆".repeat(3 - stars)}`, this.textStyle(44, "#d3a24c", 900)).setOrigin(0.5);
    const stats = this.add.text(
      WIDTH / 2,
      360,
      `Wyleczeni pacjenci      ${this.state.score.treated}\nOpieka                   ${this.state.score.care}\nTempo                    ${this.state.score.tempo}\nBezpieczeństwo           ${this.state.score.safety}\nMonety                    ${this.state.score.coins}\nŁączny wynik              ${scoreTotal(this.state.score)}`,
      { ...this.textStyle(18, "#355255", 800), lineSpacing: 10 },
    ).setOrigin(0.5);
    const note = this.add.text(WIDTH / 2, 545, "R — zagraj zmianę ponownie", this.textStyle(16, "#ffffff", 900))
      .setOrigin(0.5)
      .setBackgroundColor("#3c8f91")
      .setPadding(18, 10, 18, 10);
    this.resultsLayer = this.add.container(0, 0, [shade, panel, title, starText, stats, note]).setDepth(400);
  }

  private updateEscortBadge(): void {
    const patient = this.escortedPatientId ? this.findPatient(this.escortedPatientId) : undefined;
    if (!patient) {
      this.escortBadge.setVisible(false);
      return;
    }
    this.escortBadge.setVisible(true).setPosition(this.player.x + 28, this.player.y - 34);
    this.escortBadgeText.setText(this.speciesEmoji(patient));
  }

  private findPatient(patientId: string): PatientCase | undefined {
    return [...this.state.queue, ...this.state.activePatients, ...this.state.completedPatients].find((patient) => patient.id === patientId);
  }

  private stationStatusText(station: StationState, patient?: PatientCase): string {
    if (station.status === "available") return "WOLNE";
    if (station.status === "dirty") return "DO ODKAŻENIA";
    if (station.status === "waitingItem") return patient ? `CZEKA: ${ITEM_LABELS[patient.requiredItem]}` : "CZEKA NA NARZĘDZIE";
    if (station.status === "procedure") return patient ? `GOTOWE: ${PROCEDURE_LABELS[patient.procedure]}` : "GOTOWE DO ZABIEGU";
    return station.status.toUpperCase();
  }

  private stationStatusColor(status: StationState["status"]): string {
    if (status === "available") return "#62937d";
    if (status === "dirty") return "#a66758";
    if (status === "waitingItem") return "#b18445";
    if (status === "procedure") return "#3c8f91";
    return "#6d7775";
  }

  private stationBaseColor(kind: StationState["kind"]): number {
    if (kind === "reception") return 0xb7d6ca;
    if (kind === "storage") return 0xd9e6ef;
    if (kind === "analyzer") return 0xbad6e6;
    if (kind === "treatment") return 0xf0c9bf;
    return 0xd9dfcf;
  }

  private stationSubtitle(station: StationState): string {
    if (station.kind === "reception") return "przyjmij pacjenta";
    if (station.kind === "storage") return "narzędzia i środki";
    if (station.kind === "analyzer") return "próbki i diagnostyka";
    if (station.kind === "treatment") return "procedura leczenia";
    return "pacjent opuszcza klinikę";
  }

  private speciesEmoji(patient: PatientCase): string {
    if (patient.species === "dog") return "🐶";
    if (patient.species === "cat") return "🐱";
    return "🐰";
  }

  private priorityColor(priority: PatientCase["priority"]): number {
    if (priority === "critical") return 0xc95f54;
    if (priority === "urgent") return 0xd59a50;
    return 0x78a58e;
  }

  private qualityLabel(quality: TreatmentQuality): string {
    if (quality === "perfect") return "PERFEKCYJNA";
    if (quality === "correct") return "POPRAWNA";
    return "SZYBKA";
  }

  private toast(message: string, color = 0x3c8f91): void {
    this.lastToastAt = this.time.now;
    this.toastText.setText(message).setBackgroundColor(`#${color.toString(16).padStart(6, "0")}`).setAlpha(1);
    this.tweens.killTweensOf(this.toastText);
    this.tweens.add({
      targets: this.toastText,
      alpha: 0,
      delay: 2200,
      duration: 450,
    });
  }

  private textStyle(size: number, color: string, weight: number): Phaser.Types.GameObjects.Text.TextStyle {
    return {
      fontFamily: "Nunito, Arial, sans-serif",
      fontSize: `${size}px`,
      fontStyle: weight >= 900 ? "bold" : "normal",
      color,
    };
  }
}
