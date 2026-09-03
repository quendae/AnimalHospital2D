import Phaser from "phaser";

export type HospitalUnoColor = "red" | "yellow" | "green" | "blue" | "wild";
export type HospitalUnoAction = "number" | "skip" | "reverse" | "draw2" | "wild" | "wild4";

export type HospitalUnoCard = {
  id: string;
  color: HospitalUnoColor;
  action: HospitalUnoAction;
  value?: number;
  title: string;
  subtitle: string;
  motif: string;
  glyph: string;
};

const COLOR_STYLE: Record<HospitalUnoColor, { fill: number; dark: number; light: number; label: string }> = {
  red: { fill: 0xc94f4b, dark: 0x7e2f32, light: 0xf6c1b7, label: "ENEMIES" },
  yellow: { fill: 0xe2ad3f, dark: 0x755425, light: 0xffe3a0, label: "ANOMALIES" },
  green: { fill: 0x5d9875, dark: 0x315b49, light: 0xb9dec7, label: "CLASSES" },
  blue: { fill: 0x4f7fa7, dark: 0x294b68, light: 0xb7d7ee, label: "CHARACTERS" },
  wild: { fill: 0x302d35, dark: 0x15141a, light: 0xf4efe4, label: "NIGHT SHIFT" },
};

const ENEMIES = [
  "Bed Monster",
  "Stalker",
  "Mass of Eyes",
  "Hiders",
  "Skinwalker",
  "Head Banger",
  "Tendril",
  "Camera Figure",
  "Ghost",
  "Surgery Monster",
];

const ANOMALIES = [
  "Sharp Teeth",
  "Three Eyes",
  "Hollow Face",
  "Unnatural Face",
  "Twitching",
  "Hunched Posture",
  "Static Photo",
  "Black Eyes",
  "Camera Stare",
  "Void Patient",
];

const CLASSES = [
  "Intern",
  "Nurse",
  "Secretary",
  "Paramedic",
  "Psychologist",
  "Doctor",
  "Security",
  "Head Nurse",
  "Surgeon",
  "Secret Agent",
];

const CHARACTERS = [
  "Dr. Harlow",
  "Barney",
  "Ratthew",
  "Ron from Accounting",
  "Officer Duckman",
  "Patient",
  "Dr. Harlow",
  "Barney",
  "Ratthew",
  "Ron from Accounting",
];

const NUMBER_MOTIFS: Record<Exclude<HospitalUnoColor, "wild">, string[]> = {
  red: ENEMIES,
  yellow: ANOMALIES,
  green: CLASSES,
  blue: CHARACTERS,
};

const ACTION_THEME: Record<Exclude<HospitalUnoColor, "wild">, Record<Exclude<HospitalUnoAction, "number" | "wild" | "wild4">, { motif: string; title: string; subtitle: string; glyph: string }>> = {
  red: {
    skip: { motif: "Camera Figure", title: "LOCKDOWN", subtitle: "Skip next turn", glyph: "⊘" },
    reverse: { motif: "Skinwalker", title: "SHAPESHIFT", subtitle: "Reverse direction", glyph: "↻" },
    draw2: { motif: "Mass of Eyes", title: "DON'T LOOK UP", subtitle: "Draw two", glyph: "+2" },
  },
  yellow: {
    skip: { motif: "Static Photo", title: "BAD PHOTO", subtitle: "Skip next turn", glyph: "⊘" },
    reverse: { motif: "Camera Stare", title: "CHECK CCTV", subtitle: "Reverse direction", glyph: "↻" },
    draw2: { motif: "Three Eyes", title: "DOUBLE CHECK", subtitle: "Draw two", glyph: "+2" },
  },
  green: {
    skip: { motif: "Security", title: "SECURITY HOLD", subtitle: "Skip next turn", glyph: "⊘" },
    reverse: { motif: "Paramedic", title: "REROUTE", subtitle: "Reverse direction", glyph: "↻" },
    draw2: { motif: "Head Nurse", title: "EXTRA DUTY", subtitle: "Draw two", glyph: "+2" },
  },
  blue: {
    skip: { motif: "Officer Duckman", title: "DO NOT ENTER", subtitle: "Skip next turn", glyph: "⊘" },
    reverse: { motif: "Ron from Accounting", title: "PAPERWORK", subtitle: "Reverse direction", glyph: "↻" },
    draw2: { motif: "Barney", title: "COFFEE RUN", subtitle: "Draw two", glyph: "+2" },
  },
};

function numberCard(color: Exclude<HospitalUnoColor, "wild">, value: number, copy: number): HospitalUnoCard {
  const motif = NUMBER_MOTIFS[color][value];
  return {
    id: `${color}-${value}-${copy}`,
    color,
    action: "number",
    value,
    title: motif,
    subtitle: COLOR_STYLE[color].label,
    motif,
    glyph: String(value),
  };
}

function actionCard(color: Exclude<HospitalUnoColor, "wild">, action: "skip" | "reverse" | "draw2", copy: number): HospitalUnoCard {
  const theme = ACTION_THEME[color][action];
  return {
    id: `${color}-${action}-${copy}`,
    color,
    action,
    title: theme.title,
    subtitle: theme.subtitle,
    motif: theme.motif,
    glyph: theme.glyph,
  };
}

export function buildAnimalHospitalUnoDeck(): HospitalUnoCard[] {
  const deck: HospitalUnoCard[] = [];
  const colors: Array<Exclude<HospitalUnoColor, "wild">> = ["red", "yellow", "green", "blue"];

  for (const color of colors) {
    deck.push(numberCard(color, 0, 0));
    for (let value = 1; value <= 9; value += 1) {
      deck.push(numberCard(color, value, 0), numberCard(color, value, 1));
    }
    for (const action of ["skip", "reverse", "draw2"] as const) {
      deck.push(actionCard(color, action, 0), actionCard(color, action, 1));
    }
  }

  for (let copy = 0; copy < 4; copy += 1) {
    deck.push({
      id: `wild-${copy}`,
      color: "wild",
      action: "wild",
      title: "DR. HARLOW'S CALL",
      subtitle: "Choose the next ward",
      motif: "Dr. Harlow",
      glyph: "✦",
    });
    deck.push({
      id: `wild4-${copy}`,
      color: "wild",
      action: "wild4",
      title: "NIGHT SHIFT",
      subtitle: "Choose color • draw four",
      motif: "Hospital Emergency",
      glyph: "+4",
    });
  }

  return deck;
}

export type HospitalUnoCardView = {
  container: Phaser.GameObjects.Container;
  card: HospitalUnoCard;
};

function addCornerPips(scene: Phaser.Scene, color: HospitalUnoColor, glyph: string): Phaser.GameObjects.GameObject[] {
  const style = COLOR_STYLE[color];
  const top = scene.add.text(-43, -65, glyph, {
    fontFamily: "Arial, sans-serif",
    fontSize: glyph.length > 1 ? "20px" : "24px",
    fontStyle: "bold",
    color: "#fffdf7",
    stroke: Phaser.Display.Color.IntegerToColor(style.dark).rgba,
    strokeThickness: 4,
  }).setOrigin(0.5);
  const bottom = scene.add.text(43, 65, glyph, {
    fontFamily: "Arial, sans-serif",
    fontSize: glyph.length > 1 ? "20px" : "24px",
    fontStyle: "bold",
    color: "#fffdf7",
    stroke: Phaser.Display.Color.IntegerToColor(style.dark).rgba,
    strokeThickness: 4,
  }).setOrigin(0.5).setAngle(180);
  return [top, bottom];
}

export function createAnimalHospitalUnoCard(
  scene: Phaser.Scene,
  card: HospitalUnoCard,
  x: number,
  y: number,
  scale = 1,
): HospitalUnoCardView {
  const style = COLOR_STYLE[card.color];
  const shadow = scene.add.rectangle(4, 5, 104, 154, 0x101820, 0.28).setOrigin(0.5);
  const border = scene.add.rectangle(0, 0, 104, 154, 0xfff8e9, 1).setStrokeStyle(2, 0x1d2b2f, 0.75).setOrigin(0.5);
  const face = scene.add.rectangle(0, 0, 94, 144, style.fill, 1).setOrigin(0.5);
  const panel = scene.add.ellipse(0, 0, 72, 106, 0xfff7e8, 0.93).setStrokeStyle(2, style.dark, 0.38);
  panel.setAngle(-12);

  const section = scene.add.text(0, -51, style.label, {
    fontFamily: "Arial, sans-serif",
    fontSize: "8px",
    fontStyle: "bold",
    color: Phaser.Display.Color.IntegerToColor(style.dark).rgba,
    align: "center",
  }).setOrigin(0.5);

  const motif = scene.add.text(0, -31, card.motif.toUpperCase(), {
    fontFamily: "Arial, sans-serif",
    fontSize: card.motif.length > 16 ? "7px" : "8px",
    fontStyle: "bold",
    color: "#24383d",
    align: "center",
    wordWrap: { width: 64 },
  }).setOrigin(0.5);

  const glyph = scene.add.text(0, 4, card.glyph, {
    fontFamily: "Arial Black, Arial, sans-serif",
    fontSize: card.glyph.length > 1 ? "31px" : "42px",
    fontStyle: "bold",
    color: Phaser.Display.Color.IntegerToColor(style.dark).rgba,
    stroke: "#fffaf0",
    strokeThickness: 3,
  }).setOrigin(0.5);

  const title = scene.add.text(0, 38, card.title, {
    fontFamily: "Arial, sans-serif",
    fontSize: card.title.length > 16 ? "7px" : "8px",
    fontStyle: "bold",
    color: "#24383d",
    align: "center",
    wordWrap: { width: 66 },
  }).setOrigin(0.5);

  const subtitle = scene.add.text(0, 55, card.subtitle, {
    fontFamily: "Arial, sans-serif",
    fontSize: "6px",
    color: "#5b6f70",
    align: "center",
    wordWrap: { width: 70 },
  }).setOrigin(0.5);

  const objects: Phaser.GameObjects.GameObject[] = [shadow, border, face];

  if (card.color === "wild") {
    const wildBars = [0xc94f4b, 0xe2ad3f, 0x5d9875, 0x4f7fa7].map((fill, index) =>
      scene.add.rectangle(-27 + index * 18, -58, 15, 5, fill, 1).setOrigin(0.5),
    );
    objects.push(...wildBars);
  }

  objects.push(panel, section, motif, glyph, title, subtitle, ...addCornerPips(scene, card.color, card.glyph));
  const container = scene.add.container(x, y, objects).setScale(scale);
  container.setSize(104, 154);
  return { container, card };
}

export function hospitalUnoThemeForPriority(priority: "normal" | "urgent" | "critical") {
  if (priority === "critical") return COLOR_STYLE.red;
  if (priority === "urgent") return COLOR_STYLE.yellow;
  return COLOR_STYLE.blue;
}
