import type { ItemType } from "./domain";
import type { ClinicLayout, ClinicRoomLayout, Point } from "./layout";

export type DecorationKind = "chair" | "plant" | "cabinet" | "sink" | "bin";

export interface CounterSurface {
  id: string;
  roomId: string;
  x: number;
  y: number;
  width: number;
  height: number;
  capacity: number;
}

export interface SupplyCabinet {
  id: string;
  roomId: string;
  item: ItemType;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ClinicDecoration {
  id: string;
  roomId: string;
  kind: DecorationKind;
  x: number;
  y: number;
  width: number;
  height: number;
  blocksMovement: boolean;
}

export interface GameplayLayoutExtras {
  counters: CounterSurface[];
  supplyCabinets: SupplyCabinet[];
  decorations: ClinicDecoration[];
}

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

function roomCenter(room: ClinicRoomLayout): Point {
  return { x: room.x + room.width / 2, y: room.y + room.height / 2 };
}

function farWallY(room: ClinicRoomLayout): number {
  return room.doorSide === "bottom" ? room.y + 54 : room.y + room.height - 54;
}

function safeSideX(room: ClinicRoomLayout, random: () => number): number {
  const left = room.x + 54;
  const right = room.x + room.width - 54;
  const center = roomCenter(room).x;
  return random() < 0.5 ? Math.min(left + 35, center - 60) : Math.max(right - 35, center + 60);
}

function makeCounter(room: ClinicRoomLayout, index: number, random: () => number): CounterSurface {
  const width = Math.max(104, Math.min(154, room.width * 0.4));
  const x = safeSideX(room, random);
  const y = farWallY(room);
  return {
    id: `counter-${room.id}-${index}`,
    roomId: room.id,
    x,
    y,
    width,
    height: 42,
    capacity: width >= 140 ? 3 : 2,
  };
}

function generateSupplyCabinets(layout: ClinicLayout): SupplyCabinet[] {
  const room = layout.rooms.find((candidate) => candidate.kind === "storage");
  if (!room) return [];

  const types: ItemType[] = ["bandage", "sampleKit", "eyeDrops", "treat", "disinfectant"];
  const padding = 42;
  const usable = Math.max(1, room.width - padding * 2);
  const y = room.doorSide === "bottom" ? room.y + 42 : room.y + room.height - 42;

  return types.map((item, index) => ({
    id: `cabinet-${item}`,
    roomId: room.id,
    item,
    x: Math.round(room.x + padding + (usable * index) / (types.length - 1)),
    y: Math.round(y),
    width: 44,
    height: 48,
  }));
}

function decorateRoom(room: ClinicRoomLayout, random: () => number): ClinicDecoration[] {
  const items: ClinicDecoration[] = [];
  const add = (kind: DecorationKind, x: number, y: number, width: number, height: number, blocksMovement = true) => {
    items.push({
      id: `${kind}-${room.id}-${items.length}`,
      roomId: room.id,
      kind,
      x,
      y,
      width,
      height,
      blocksMovement,
    });
  };

  const left = room.x + 40;
  const right = room.x + room.width - 40;
  const farY = farWallY(room);

  if (room.kind === "reception" || room.kind === "waiting" || room.kind === "storage") {
    return items;
  }

  if (room.kind === "treatment") {
    add("sink", random() < 0.5 ? left : right, farY, 54, 42, true);
    add("bin", random() < 0.5 ? right : left, roomCenter(room).y, 30, 30, true);
    return items;
  }

  if (room.kind === "analyzer") {
    add("cabinet", random() < 0.5 ? left : right, farY, 62, 40, true);
    add("bin", random() < 0.5 ? right : left, roomCenter(room).y, 28, 28, true);
    return items;
  }

  return items;
}

export function generateGameplayLayoutExtras(layout: ClinicLayout): GameplayLayoutExtras {
  const random = mulberry32((layout.seed || 1) ^ 0x51f15e);
  const counters: CounterSurface[] = [];
  const decorations: ClinicDecoration[] = [];

  for (const room of layout.rooms) {
    if (room.kind === "analyzer" || room.kind === "treatment") {
      counters.push(makeCounter(room, counters.length, random));
    }
    decorations.push(...decorateRoom(room, random));
  }

  const reception = layout.rooms.find((room) => room.kind === "reception");
  if (reception) {
    layout.patientSpawns.forEach((seat, index) => {
      decorations.push({
        id: `chair-${reception.id}-seat-${index}`,
        roomId: reception.id,
        kind: "chair",
        x: seat.x,
        y: seat.y,
        width: 46,
        height: 40,
        blocksMovement: true,
      });
    });
  }

  return { counters, supplyCabinets: generateSupplyCabinets(layout), decorations };
}

function pointInsideRoom(point: Point, room: ClinicRoomLayout, margin = 2): boolean {
  return (
    point.x > room.x + margin &&
    point.x < room.x + room.width - margin &&
    point.y > room.y + margin &&
    point.y < room.y + room.height - margin
  );
}

function corridorPointForDoor(layout: ClinicLayout, room: ClinicRoomLayout): Point {
  return {
    x: room.doorX,
    y: layout.corridor.y + layout.corridor.height / 2,
  };
}

function insideDoorPoint(room: ClinicRoomLayout): Point {
  const inset = 30;
  return {
    x: room.doorX,
    y: room.doorSide === "bottom" ? room.doorY - inset : room.doorY + inset,
  };
}

export function routeThroughClinic(layout: ClinicLayout, from: Point, target: Point): Point[] {
  const sourceRoom = layout.rooms.find((room) => pointInsideRoom(from, room));
  const targetRoom = layout.rooms.find((room) => pointInsideRoom(target, room));
  const route: Point[] = [];

  if (sourceRoom && (!targetRoom || sourceRoom.id !== targetRoom.id)) {
    route.push(insideDoorPoint(sourceRoom));
    route.push(corridorPointForDoor(layout, sourceRoom));
  }

  if (targetRoom && (!sourceRoom || sourceRoom.id !== targetRoom.id)) {
    route.push(corridorPointForDoor(layout, targetRoom));
    route.push(insideDoorPoint(targetRoom));
  }

  route.push({ x: target.x, y: target.y });
  return route;
}
