export type LobbyMember = {
  id: string;
  name: string;
  connected: boolean;
  joinedAt: number;
};

export type LobbyRoomState = {
  roomCode: string;
  selfId: string;
  hostId: string;
  members: LobbyMember[];
};

export type ClientLobbyMessage =
  | { type: "create-room"; name: string; clientToken: string }
  | { type: "join-room"; roomCode: string; name: string; clientToken: string }
  | { type: "resume-room"; roomCode: string; name: string; clientToken: string }
  | { type: "leave-room" }
  | { type: "signal"; targetId: string; data: unknown }
  | { type: "relay"; targetId: string; data: unknown }
  | { type: "ping" };

export type ServerLobbyMessage =
  | { type: "hello" }
  | ({ type: "room-state" } & LobbyRoomState)
  | { type: "signal"; fromId: string; data: unknown }
  | { type: "relay"; fromId: string; data: unknown }
  | { type: "error"; code: string; message: string }
  | { type: "pong" };

export type MultiplayerTransport = "connecting" | "p2p" | "relay" | "offline";

export type PlayerPresencePacket = {
  kind: "player-state";
  peerId: string;
  name: string;
  x: number;
  y: number;
  facingX: number;
  facingY: number;
  carriedItem?: string;
};

export type GameStartPacket = {
  kind: "game-start";
  seed: number;
};

export type MultiplayerPacket =
  | PlayerPresencePacket
  | GameStartPacket
  | { kind: "world-snapshot"; snapshot: unknown }
  | { kind: "interact"; x: number; y: number; facingX: number; facingY: number }
  | { kind: "procedure-request"; stationId: string }
  | { kind: "procedure-approved"; patientId: string; procedure: string }
  | { kind: "procedure-result"; patientId: string; procedure: string; accuracy: number }
  | { kind: "clean-spill"; spillId: string };
