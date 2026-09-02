import { Client, Room } from "colyseus";
import { ClinicRoomState, NetworkPlayer } from "./ClinicState";

type MoveIntent = {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  seq?: number;
};

type LobbyOptions = {
  name?: string;
  hero?: string;
  seed?: number;
};

type SignalMessage = {
  target?: string;
  payload?: unknown;
};

const CLINIC_BOUNDS = {
  left: 270,
  right: 1248,
  top: 82,
  bottom: 688,
};

const ALLOWED_HEROES = new Set(["lena", "maks", "iga", "bruno"]);

function cleanName(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim()
    ? value.trim().slice(0, 18)
    : fallback;
}

function cleanHero(value: unknown): string {
  return typeof value === "string" && ALLOWED_HEROES.has(value) ? value : "lena";
}

export class ClinicRoom extends Room {
  state = new ClinicRoomState();
  maxClients = 4;

  onCreate(options: LobbyOptions = {}): void {
    const requestedSeed = Number(options.seed);
    this.state.seed = Number.isFinite(requestedSeed) && requestedSeed > 0
      ? Math.floor(requestedSeed)
      : Math.floor(Math.random() * 9_999_999) + 1;

    this.setPatchRate(50);
    this.setSimulationInterval((deltaMs) => this.simulate(deltaMs), 50);

    // Kept as a low-bandwidth fallback/debug path. Actual co-op input/state is
    // transported over WebRTC data channels once peers finish signaling.
    this.onMessage("move", (client, intent: MoveIntent) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;

      const proposedX = Number(intent.x);
      const proposedY = Number(intent.y);
      if (!Number.isFinite(proposedX) || !Number.isFinite(proposedY)) return;

      const dx = proposedX - player.x;
      const dy = proposedY - player.y;
      const maxStep = 42;
      const distance = Math.hypot(dx, dy);
      if (distance > maxStep) return;

      player.x = Math.max(CLINIC_BOUNDS.left, Math.min(CLINIC_BOUNDS.right, proposedX));
      player.y = Math.max(CLINIC_BOUNDS.top, Math.min(CLINIC_BOUNDS.bottom, proposedY));
    });

    this.onMessage("profile", (client, message: { name?: string; hero?: string }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.name = cleanName(message?.name, player.name);
      player.hero = cleanHero(message?.hero);
      this.broadcastRoster();
    });

    this.onMessage("ready", (client, message: { ready?: boolean }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      player.ready = Boolean(message?.ready);
      this.broadcastRoster();
    });

    // Colyseus is deliberately only the rendezvous/signaling path. SDP and ICE
    // payloads are opaque to the server and forwarded to the target peer.
    this.onMessage("signal", (client, message: SignalMessage) => {
      if (!message || typeof message.target !== "string" || message.target === client.sessionId) return;
      const target = this.clients.find((candidate) => candidate.sessionId === message.target);
      if (!target) return;
      target.send("signal", { from: client.sessionId, payload: message.payload ?? null });
    });

    this.onMessage("startShift", (client) => {
      if (this.state.phase !== "lobby") return;
      if (this.state.hostSessionId !== client.sessionId) return;
      this.state.phase = "active";
      this.state.remainingMs = 240_000;
      this.broadcast("startShift", { seed: this.state.seed, hostSessionId: this.state.hostSessionId });
      this.broadcastRoster();
    });

    this.onMessage("ping", (client, message: { text?: string }) => {
      const text = typeof message?.text === "string" ? message.text.slice(0, 80) : "Potrzebna pomoc!";
      this.broadcast("ping", { from: client.sessionId, text });
    });
  }

  onJoin(client: Client, options: LobbyOptions): void {
    const player = new NetworkPlayer();
    player.name = cleanName(options?.name, `Intern ${this.clients.length}`);
    player.hero = cleanHero(options?.hero);
    player.x = 430 + ((this.clients.length - 1) % 2) * 54;
    player.y = 545 + Math.floor((this.clients.length - 1) / 2) * 54;
    this.state.players.set(client.sessionId, player);

    if (!this.state.hostSessionId) this.state.hostSessionId = client.sessionId;
    this.broadcastRoster();
  }

  async onDrop(client: Client): Promise<void> {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = false;
    this.broadcastRoster();

    try {
      await this.allowReconnection(client, 20);
    } catch {
      // Colyseus invokes onLeave after the reconnect window expires.
    }
  }

  onReconnect(client: Client): void {
    const player = this.state.players.get(client.sessionId);
    if (player) player.connected = true;
    this.broadcastRoster();
  }

  onLeave(client: Client, _code?: number): void {
    this.state.players.delete(client.sessionId);

    if (this.state.hostSessionId === client.sessionId) {
      const nextHost = this.clients.find((candidate) => this.state.players.get(candidate.sessionId)?.connected);
      this.state.hostSessionId = nextHost?.sessionId ?? "";
      this.broadcast("hostChanged", { hostSessionId: this.state.hostSessionId });
    }

    this.broadcastRoster();
  }

  private broadcastRoster(): void {
    const players = [...this.state.players.entries()].map(([sessionId, player]) => ({
      sessionId,
      name: player.name,
      hero: player.hero,
      connected: player.connected,
      ready: player.ready,
    }));

    this.broadcast("roster", {
      roomId: this.roomId,
      phase: this.state.phase,
      seed: this.state.seed,
      hostSessionId: this.state.hostSessionId,
      players,
    });
  }

  private simulate(deltaMs: number): void {
    if (this.state.phase !== "active") return;
    this.state.remainingMs = Math.max(0, this.state.remainingMs - deltaMs);
    if (this.state.remainingMs === 0) {
      this.state.phase = "results";
      this.broadcastRoster();
    }
  }
}
