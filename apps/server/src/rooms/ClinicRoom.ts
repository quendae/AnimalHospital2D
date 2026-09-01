import { Client, Room } from "colyseus";
import { ClinicRoomState, NetworkPlayer } from "./ClinicState";

type MoveIntent = {
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  seq?: number;
};

const CLINIC_BOUNDS = {
  left: 270,
  right: 1248,
  top: 82,
  bottom: 688,
};

export class ClinicRoom extends Room<ClinicRoomState> {
  maxClients = 4;

  onCreate(): void {
    this.setState(new ClinicRoomState());
    this.setPatchRate(50);
    this.setSimulationInterval((deltaMs) => this.simulate(deltaMs), 50);

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

    this.onMessage("startShift", (client) => {
      if (this.state.phase !== "lobby") return;
      if (this.clients[0]?.sessionId !== client.sessionId) return;
      this.state.phase = "active";
      this.state.remainingMs = 240_000;
    });

    this.onMessage("ping", (client, message: { text?: string }) => {
      const text = typeof message?.text === "string" ? message.text.slice(0, 80) : "Potrzebna pomoc!";
      this.broadcast("ping", { from: client.sessionId, text });
    });
  }

  onJoin(client: Client, options: { name?: string }): void {
    const player = new NetworkPlayer();
    player.name = typeof options?.name === "string" ? options.name.slice(0, 18) : `Intern ${this.clients.length}`;
    player.x = 430 + (this.clients.length % 2) * 54;
    player.y = 545 + Math.floor(this.clients.length / 2) * 54;
    this.state.players.set(client.sessionId, player);
  }

  onLeave(client: Client, consented: boolean): void {
    const player = this.state.players.get(client.sessionId);
    if (!player) return;

    if (consented) {
      this.state.players.delete(client.sessionId);
      return;
    }

    player.connected = false;
    this.allowReconnection(client, 15).then(() => {
      const reconnected = this.state.players.get(client.sessionId);
      if (reconnected) reconnected.connected = true;
    }).catch(() => {
      this.state.players.delete(client.sessionId);
    });
  }

  private simulate(deltaMs: number): void {
    if (this.state.phase !== "active") return;
    this.state.remainingMs = Math.max(0, this.state.remainingMs - deltaMs);
    if (this.state.remainingMs === 0) this.state.phase = "results";
  }
}
