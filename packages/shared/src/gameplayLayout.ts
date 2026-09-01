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

  if (room.kind === "reception") {
    // Chairs are added from layout.patientSpawns so each visible chair maps 1:1
    // to a real queue seat. Keep only a little non-blocking ambience here.
    add("plant", random() < 0.5 ? left : right, farY, 30, 30, true);
    return items;
  }

  if (room.kind === "waiting") {
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

  if (room.kind === "storage") {
    add("cabinet", left, farY, 62, 42, true);
    add("cabinet", right, farY, 62, 42, true);
    return items;
  }

  return items;
}

/**
 * Adds gameplay furniture to the procedural shell while keeping the direct line
 * between each door and the room centre clear. Reception chairs are no longer
 * decorative noise: they are generated from the exact patient queue positions.
 */
export function generateGameplayLayoutExtras(layout: ClinicLayout): GameplayLayoutExtras {
  const random = mulberry32((layout.seed || 1) ^ 0x51f15e);
  const counters: CounterSurface[] = [];
  const decorations: ClinicDecoration[] = [];

  for (const room of layout.rooms) {
    if (room.kind === "storage" || room.kind === "analyzer" || room.kind === "treatment") {
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

  return { counters, decorations };
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

/**
 * Produces a short deterministic route through the shared corridor. It is not a
 * general navmesh: the procedural generator deliberately guarantees that every
 * gameplay room opens directly onto this corridor, so two door waypoints are
 * sufficient and considerably more predictable for family-friendly movement.
 */
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
