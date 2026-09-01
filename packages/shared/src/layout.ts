import type { ItemType, StationState } from "./domain";

export type ClinicRoomKind = "waiting" | "reception" | "storage" | "analyzer" | "treatment";
export type DoorSide = "top" | "bottom";

export interface ClinicRoomLayout {
  id: string;
  kind: ClinicRoomKind;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
  doorX: number;
  doorY: number;
  doorSide: DoorSide;
}

export interface WallSegment {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ItemSpawnPoint {
  id: string;
  item: ItemType;
  x: number;
  y: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface ClinicLayout {
  seed: number;
  rooms: ClinicRoomLayout[];
  walls: WallSegment[];
  stations: StationState[];
  itemSpawns: ItemSpawnPoint[];
  patientSpawns: Point[];
  playerSpawn: Point;
  exit: Point;
  corridor: { x: number; y: number; width: number; height: number };
}

const ROOM_LABELS: Record<ClinicRoomKind, string> = {
  waiting: "POCZEKALNIA",
  reception: "RECEPCJA",
  storage: "MAGAZYN",
  analyzer: "DIAGNOSTYKA",
  treatment: "GABINET",
};

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle<T>(values: T[], random: () => number): T[] {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function splitColumns(random: () => number, left: number, right: number): number[] {
  const total = right - left;
  const base = total / 3;
  const jitterA = (random() - 0.5) * 110;
  const jitterB = (random() - 0.5) * 110;
  const first = clamp(left + base + jitterA, left + 280, right - 560);
  const second = clamp(left + base * 2 + jitterB, first + 280, right - 280);
  return [left, Math.round(first), Math.round(second), right];
}

function roomStation(room: ClinicRoomLayout, treatmentIndex: number): StationState | undefined {
  const cx = Math.round(room.x + room.width / 2);
  const awayFromDoor = room.doorSide === "bottom" ? room.y + room.height * 0.42 : room.y + room.height * 0.58;
  const cy = Math.round(awayFromDoor);

  if (room.kind === "waiting") return undefined;
  if (room.kind === "reception") {
    return { id: "reception", kind: "reception", label: "RECEPCJA", x: cx, y: cy, width: 150, height: 58, status: "available" };
  }
  if (room.kind === "storage") {
    return {
      id: "storage",
      kind: "storage",
      label: "STÓŁ ZAOPATRZENIA",
      x: cx,
      y: cy,
      width: 180,
      height: 62,
      status: "available",
      accepts: ["bandage", "sampleKit", "eyeDrops", "treat", "disinfectant"],
    };
  }
  if (room.kind === "analyzer") {
    return {
      id: "analyzer",
      kind: "analyzer",
      label: "ANALIZATOR",
      x: cx,
      y: cy,
      width: 150,
      height: 70,
      status: "available",
      accepts: ["sampleKit"],
    };
  }
  return {
    id: `treatment-${treatmentIndex}`,
    kind: "treatment",
    label: `STÓŁ ZABIEGOWY ${treatmentIndex}`,
    x: cx,
    y: cy,
    width: 170,
    height: 76,
    status: "available",
    accepts: ["bandage", "eyeDrops", "treat"],
  };
}

function buildRoomWalls(room: ClinicRoomLayout, wall = 12, doorWidth = 78): WallSegment[] {
  const walls: WallSegment[] = [
    { x: room.x + room.width / 2, y: room.y + wall / 2, width: room.width, height: wall },
    { x: room.x + wall / 2, y: room.y + room.height / 2, width: wall, height: room.height },
    { x: room.x + room.width - wall / 2, y: room.y + room.height / 2, width: wall, height: room.height },
  ];

  const gapLeft = room.doorX - doorWidth / 2;
  const gapRight = room.doorX + doorWidth / 2;
  const leftWidth = Math.max(0, gapLeft - room.x);
  const rightWidth = Math.max(0, room.x + room.width - gapRight);
  const doorWallY = room.doorSide === "bottom" ? room.y + room.height - wall / 2 : room.y + wall / 2;

  if (room.doorSide === "bottom") {
    walls.push(
      { x: room.x + leftWidth / 2, y: doorWallY, width: leftWidth, height: wall },
      { x: gapRight + rightWidth / 2, y: doorWallY, width: rightWidth, height: wall },
    );
  } else {
    walls[0] = { x: room.x + leftWidth / 2, y: doorWallY, width: leftWidth, height: wall };
    walls.push({ x: gapRight + rightWidth / 2, y: doorWallY, width: rightWidth, height: wall });
    walls.push({ x: room.x + room.width / 2, y: room.y + room.height - wall / 2, width: room.width, height: wall });
  }

  return walls.filter((segment) => segment.width > 2 && segment.height > 2);
}

/**
 * Builds a deterministic six-room clinic around one central corridor.
 * Room order, widths, door positions and treatment-room numbering vary by seed,
 * while all critical gameplay stations remain reachable in every layout.
 */
export function generateClinicLayout(seed: number, width = 1280, height = 720): ClinicLayout {
  const random = mulberry32(seed || 1);
  const margin = 22;
  const hudBottom = 76;
  const bottom = height - 20;
  const corridorHeight = 94;
  const corridorY = Math.round((hudBottom + bottom) / 2 - corridorHeight / 2 + (random() - 0.5) * 24);
  const corridor = { x: margin, y: corridorY, width: width - margin * 2, height: corridorHeight };
  const columns = splitColumns(random, margin, width - margin);

  const kinds = shuffle<ClinicRoomKind>(
    ["waiting", "reception", "storage", "analyzer", "treatment", "treatment"],
    random,
  );

  const rooms: ClinicRoomLayout[] = [];
  for (let row = 0; row < 2; row += 1) {
    for (let column = 0; column < 3; column += 1) {
      const kind = kinds[row * 3 + column];
      const x = columns[column];
      const right = columns[column + 1];
      const top = row === 0 ? hudBottom : corridorY + corridorHeight;
      const roomBottom = row === 0 ? corridorY : bottom;
      const roomWidth = right - x;
      const roomHeight = roomBottom - top;
      const doorPadding = Math.min(110, roomWidth * 0.27);
      const doorX = Math.round(x + doorPadding + random() * Math.max(1, roomWidth - doorPadding * 2));
      const doorSide: DoorSide = row === 0 ? "bottom" : "top";
      rooms.push({
        id: `${kind}-${row}-${column}`,
        kind,
        label: kind === "treatment" ? "GABINET ZABIEGOWY" : ROOM_LABELS[kind],
        x,
        y: top,
        width: roomWidth,
        height: roomHeight,
        doorX,
        doorY: doorSide === "bottom" ? roomBottom : top,
        doorSide,
      });
    }
  }

  let treatmentIndex = 0;
  const stations: StationState[] = [];
  for (const room of rooms) {
    if (room.kind === "treatment") treatmentIndex += 1;
    const station = roomStation(room, treatmentIndex);
    if (station) stations.push(station);
  }

  const storageRoom = rooms.find((room) => room.kind === "storage")!;
  const waitingRoom = rooms.find((room) => room.kind === "waiting")!;
  const receptionRoom = rooms.find((room) => room.kind === "reception")!;
  const itemTypes: ItemType[] = ["bandage", "sampleKit", "eyeDrops", "treat", "disinfectant"];
  const itemSpawns = itemTypes.map((item, index) => ({
    id: `${item}-${index}`,
    item,
    x: Math.round(storageRoom.x + 56 + (index % 3) * Math.min(82, (storageRoom.width - 112) / 2)),
    y: Math.round(storageRoom.y + 62 + Math.floor(index / 3) * 68),
  }));

  const patientSpawns: Point[] = [0, 1, 2].map((index) => ({
    x: Math.round(waitingRoom.x + waitingRoom.width * (0.32 + index * 0.18)),
    y: Math.round(waitingRoom.y + waitingRoom.height * 0.5),
  }));

  const walls = rooms.flatMap((room) => buildRoomWalls(room));
  const exit = { x: margin + 18, y: Math.round(corridorY + corridorHeight / 2) };
  const playerSpawn = {
    x: Math.round(receptionRoom.doorX),
    y: Math.round(corridorY + corridorHeight / 2),
  };

  return {
    seed,
    rooms,
    walls,
    stations,
    itemSpawns,
    patientSpawns,
    playerSpawn,
    exit,
    corridor,
  };
}
