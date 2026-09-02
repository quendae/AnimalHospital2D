import { randomBytes } from "node:crypto";
import { createServer } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import type {
  ClientLobbyMessage,
  LobbyMember,
  ServerLobbyMessage,
} from "@animal-care/shared";

const port = Number(process.env.PORT ?? 2567);
const RECONNECT_GRACE_MS = 12_000;
const MAX_CLIENTS = 4;

type MemberRuntime = LobbyMember & {
  token: string;
  socket?: WebSocket;
  removalTimer?: ReturnType<typeof setTimeout>;
};

type RoomRuntime = {
  roomCode: string;
  hostId: string;
  members: Map<string, MemberRuntime>;
};

type SocketContext = {
  roomCode?: string;
  peerId?: string;
};

const rooms = new Map<string, RoomRuntime>();
const socketContexts = new WeakMap<WebSocket, SocketContext>();

function randomId(bytes = 5): string {
  return randomBytes(bytes).toString("hex");
}

function createRoomCode(): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const bytes = randomBytes(5);
    const code = [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
    if (!rooms.has(code)) return code;
  }
  return randomId(4).slice(0, 5).toUpperCase();
}

function normalizeName(value: unknown): string {
  if (typeof value !== "string") return "Stażyści";
  const name = value.trim().replace(/\s+/g, " ").slice(0, 18);
  return name || "Stażyści";
}

function send(socket: WebSocket | undefined, message: ServerLobbyMessage): void {
  if (!socket || socket.readyState !== WebSocket.OPEN) return;
  socket.send(JSON.stringify(message));
}

function memberView(member: MemberRuntime): LobbyMember {
  return {
    id: member.id,
    name: member.name,
    connected: member.connected,
    joinedAt: member.joinedAt,
  };
}

function broadcastRoomState(room: RoomRuntime): void {
  const members = [...room.members.values()].map(memberView);
  for (const member of room.members.values()) {
    if (!member.connected) continue;
    send(member.socket, {
      type: "room-state",
      roomCode: room.roomCode,
      selfId: member.id,
      hostId: room.hostId,
      members,
    });
  }
}

function roomForSocket(socket: WebSocket): RoomRuntime | undefined {
  const context = socketContexts.get(socket);
  return context?.roomCode ? rooms.get(context.roomCode) : undefined;
}

function memberForSocket(socket: WebSocket): MemberRuntime | undefined {
  const context = socketContexts.get(socket);
  const room = context?.roomCode ? rooms.get(context.roomCode) : undefined;
  return context?.peerId ? room?.members.get(context.peerId) : undefined;
}

function attachMember(socket: WebSocket, room: RoomRuntime, member: MemberRuntime): void {
  if (member.removalTimer) clearTimeout(member.removalTimer);
  if (member.socket && member.socket !== socket && member.socket.readyState === WebSocket.OPEN) {
    member.socket.close(4001, "Session resumed elsewhere");
  }
  member.socket = socket;
  member.connected = true;
  member.removalTimer = undefined;
  socketContexts.set(socket, { roomCode: room.roomCode, peerId: member.id });
  broadcastRoomState(room);
}

function findByToken(room: RoomRuntime, token: string): MemberRuntime | undefined {
  return [...room.members.values()].find((member) => member.token === token);
}

function createMember(name: string, token: string): MemberRuntime {
  return {
    id: randomId(5),
    name,
    token,
    connected: true,
    joinedAt: Date.now(),
  };
}

function joinRoom(socket: WebSocket, room: RoomRuntime, name: string, token: string): void {
  const existing = findByToken(room, token);
  if (existing) {
    existing.name = name;
    attachMember(socket, room, existing);
    return;
  }

  if (room.members.size >= MAX_CLIENTS) {
    send(socket, { type: "error", code: "ROOM_FULL", message: "Pokój jest pełny (maks. 4 graczy)." });
    return;
  }

  const member = createMember(name, token);
  room.members.set(member.id, member);
  attachMember(socket, room, member);
}

function finalizeMemberRemoval(room: RoomRuntime, peerId: string): void {
  const member = room.members.get(peerId);
  if (!member || member.connected) return;

  room.members.delete(peerId);
  if (room.members.size === 0) {
    rooms.delete(room.roomCode);
    return;
  }

  if (room.hostId === peerId) {
    const nextHost = [...room.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)[0];
    room.hostId = nextHost.id;
  }
  broadcastRoomState(room);
}

function leaveRoom(socket: WebSocket, immediate = false): void {
  const context = socketContexts.get(socket);
  if (!context?.roomCode || !context.peerId) return;
  const room = rooms.get(context.roomCode);
  const member = room?.members.get(context.peerId);
  socketContexts.set(socket, {});
  if (!room || !member) return;

  member.socket = undefined;
  member.connected = false;

  if (immediate) {
    finalizeMemberRemoval(room, member.id);
    return;
  }

  broadcastRoomState(room);
  member.removalTimer = setTimeout(() => finalizeMemberRemoval(room, member.id), RECONNECT_GRACE_MS);
}

function forward(socket: WebSocket, targetId: string, data: unknown, type: "signal" | "relay"): void {
  const room = roomForSocket(socket);
  const sender = memberForSocket(socket);
  const target = room?.members.get(targetId);
  if (!room || !sender || !target || !target.connected) return;
  send(target.socket, type === "signal"
    ? { type: "signal", fromId: sender.id, data }
    : { type: "relay", fromId: sender.id, data });
}

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: true, rooms: rooms.size }));
    return;
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Animal Care Co-op P2P rendezvous\n");
});

const wss = new WebSocketServer({ server: httpServer, path: "/ws" });

wss.on("connection", (socket) => {
  socketContexts.set(socket, {});
  send(socket, { type: "hello" });

  socket.on("message", (raw) => {
    if (raw.byteLength > 128_000) return;
    let message: ClientLobbyMessage;
    try {
      message = JSON.parse(raw.toString()) as ClientLobbyMessage;
    } catch {
      send(socket, { type: "error", code: "BAD_JSON", message: "Nieprawidłowa wiadomość." });
      return;
    }

    if (message.type === "ping") {
      send(socket, { type: "pong" });
      return;
    }

    if (message.type === "create-room") {
      leaveRoom(socket, true);
      const roomCode = createRoomCode();
      const member = createMember(normalizeName(message.name), message.clientToken);
      const room: RoomRuntime = {
        roomCode,
        hostId: member.id,
        members: new Map([[member.id, member]]),
      };
      rooms.set(roomCode, room);
      attachMember(socket, room, member);
      return;
    }

    if (message.type === "join-room" || message.type === "resume-room") {
      const roomCode = String(message.roomCode ?? "").trim().toUpperCase();
      const room = rooms.get(roomCode);
      if (!room) {
        send(socket, { type: "error", code: "ROOM_NOT_FOUND", message: "Nie znaleziono takiego pokoju." });
        return;
      }
      leaveRoom(socket, true);
      joinRoom(socket, room, normalizeName(message.name), message.clientToken);
      return;
    }

    if (message.type === "leave-room") {
      leaveRoom(socket, true);
      return;
    }

    if (message.type === "signal") {
      forward(socket, message.targetId, message.data, "signal");
      return;
    }

    if (message.type === "relay") {
      forward(socket, message.targetId, message.data, "relay");
    }
  });

  socket.on("close", () => leaveRoom(socket));
  socket.on("error", () => leaveRoom(socket));
});

httpServer.listen(port, "0.0.0.0", () => {
  console.log(`Animal Care Co-op rendezvous listening on http://0.0.0.0:${port}`);
});
