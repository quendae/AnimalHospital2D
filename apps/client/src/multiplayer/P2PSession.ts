import { Client, type Room } from "@colyseus/sdk";

export type HeroId = "lena" | "maks" | "iga" | "bruno";
export type SessionMode = "local" | "host" | "guest";

export type LobbyPlayer = {
  sessionId: string;
  name: string;
  hero: HeroId;
  connected: boolean;
  ready: boolean;
};

export type LobbySnapshot = {
  roomId: string;
  phase: "lobby" | "active" | "results";
  seed: number;
  hostSessionId: string;
  players: LobbyPlayer[];
};

export type GamePacket =
  | { type: "input"; seq: number; x: number; y: number; interact?: boolean; interactHeld?: boolean; ping?: boolean; numberChoice?: number }
  | { type: "snapshot"; tick: number; state: unknown }
  | { type: "event"; name: string; payload?: unknown }
  | { type: "hello"; name: string; hero: HeroId };

type SignalPayload = {
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
};

type PeerLink = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  makingOffer: boolean;
  connected: boolean;
  pendingCandidates: RTCIceCandidateInit[];
};

const HEROES = new Set<HeroId>(["lena", "maks", "iga", "bruno"]);

function emit<T>(target: EventTarget, type: string, detail: T): void {
  target.dispatchEvent(new CustomEvent(type, { detail }));
}

function safeHero(value: unknown): HeroId {
  return typeof value === "string" && HEROES.has(value as HeroId) ? value as HeroId : "lena";
}

export function defaultMultiplayerServerUrl(): string {
  const configured = String(import.meta.env.VITE_MULTIPLAYER_URL ?? "").trim();
  if (configured) return configured;
  const protocol = window.location.protocol === "https:" ? "https" : "http";
  return `${protocol}://${window.location.hostname || "127.0.0.1"}:2567`;
}

export class P2PSession extends EventTarget {
  readonly client: Client;
  readonly serverUrl: string;
  mode: SessionMode = "local";
  name: string;
  hero: HeroId;
  room?: Room;
  lobby?: LobbySnapshot;

  private peers = new Map<string, PeerLink>();
  private intentionalLeave = false;

  constructor(options: { serverUrl?: string; name: string; hero: HeroId }) {
    super();
    this.serverUrl = options.serverUrl || defaultMultiplayerServerUrl();
    this.name = options.name.trim().slice(0, 18) || "Intern";
    this.hero = safeHero(options.hero);
    this.client = new Client(this.serverUrl);
    this.updateDebugState();
  }

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  get roomId(): string {
    return this.room?.roomId ?? "";
  }

  get hostSessionId(): string {
    return this.lobby?.hostSessionId ?? "";
  }

  get isHost(): boolean {
    return Boolean(this.sessionId && this.sessionId === this.hostSessionId);
  }

  get connectedPeerCount(): number {
    let count = 0;
    for (const peer of this.peers.values()) if (peer.channel?.readyState === "open") count += 1;
    return count;
  }

  async host(): Promise<LobbySnapshot> {
    this.mode = "host";
    const room = await this.client.create("clinic", { name: this.name, hero: this.hero });
    this.attachRoom(room);
    room.send("profile", { name: this.name, hero: this.hero });
    return this.waitForRoster();
  }

  async join(roomId: string): Promise<LobbySnapshot> {
    const normalized = roomId.trim();
    if (!normalized) throw new Error("Podaj kod pokoju.");
    this.mode = "guest";
    const room = await this.client.joinById(normalized, { name: this.name, hero: this.hero });
    this.attachRoom(room);
    room.send("profile", { name: this.name, hero: this.hero });
    return this.waitForRoster();
  }

  setProfile(name: string, hero: HeroId): void {
    this.name = name.trim().slice(0, 18) || this.name;
    this.hero = safeHero(hero);
    this.room?.send("profile", { name: this.name, hero: this.hero });
  }

  setReady(ready: boolean): void {
    this.room?.send("ready", { ready });
  }

  startShift(): void {
    if (!this.isHost) return;
    this.room?.send("startShift");
  }

  sendPacket(packet: GamePacket): void {
    if (this.mode === "local") return;
    const encoded = JSON.stringify(packet);
    if (this.isHost) {
      for (const peer of this.peers.values()) {
        if (peer.channel?.readyState === "open") peer.channel.send(encoded);
      }
      return;
    }

    const host = this.peers.get(this.hostSessionId);
    if (host?.channel?.readyState === "open") host.channel.send(encoded);
  }

  sendPacketTo(peerId: string, packet: GamePacket): void {
    const channel = this.peers.get(peerId)?.channel;
    if (channel?.readyState === "open") channel.send(JSON.stringify(packet));
  }

  async leave(): Promise<void> {
    this.intentionalLeave = true;
    this.closePeerLinks();
    if (this.room) await this.room.leave();
    this.room = undefined;
    this.lobby = undefined;
    this.mode = "local";
    this.updateDebugState();
  }

  private attachRoom(room: Room): void {
    this.room = room;
    this.intentionalLeave = false;
    room.reconnection.minUptime = 1_000;
    room.reconnection.maxRetries = 20;
    room.reconnection.maxDelay = 2_000;

    room.onMessage("roster", (message: LobbySnapshot) => {
      this.handleRoster(message);
    });

    room.onMessage("signal", (message: { from?: string; payload?: SignalPayload }) => {
      if (!message?.from || !message.payload) return;
      void this.handleSignal(message.from, message.payload);
    });

    room.onMessage("startShift", (message: { seed?: number; hostSessionId?: string }) => {
      if (this.lobby && Number.isFinite(Number(message?.seed))) this.lobby.seed = Number(message.seed);
      emit(this, "start", { seed: Number(message?.seed) || this.lobby?.seed || 1 });
    });

    room.onMessage("hostChanged", (message: { hostSessionId?: string }) => {
      const nextHost = typeof message?.hostSessionId === "string" ? message.hostSessionId : "";
      if (this.lobby) this.lobby.hostSessionId = nextHost;
      this.rebuildPeerTopology();
      emit(this, "host-changed", { hostSessionId: nextHost });
    });

    room.onDrop((code, reason) => {
      emit(this, "connection", { state: "reconnecting", code, reason });
      this.updateDebugState("reconnecting");
    });

    room.onReconnect(() => {
      emit(this, "connection", { state: "connected" });
      room.send("profile", { name: this.name, hero: this.hero });
      this.rebuildPeerTopology();
      this.updateDebugState("connected");
    });

    room.onError((code, message) => {
      emit(this, "error", { code, message });
      this.updateDebugState("error");
    });

    room.onLeave((code) => {
      this.closePeerLinks();
      if (!this.intentionalLeave) emit(this, "connection", { state: "left", code });
      this.updateDebugState("left");
    });

    this.updateDebugState("signaling");
  }

  private waitForRoster(timeoutMs = 5_000): Promise<LobbySnapshot> {
    if (this.lobby) return Promise.resolve(this.lobby);
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        this.removeEventListener("roster", onRoster);
        reject(new Error("Serwer lobby nie odpowiedział na czas."));
      }, timeoutMs);
      const onRoster = (event: Event) => {
        window.clearTimeout(timeout);
        this.removeEventListener("roster", onRoster);
        resolve((event as CustomEvent<LobbySnapshot>).detail);
      };
      this.addEventListener("roster", onRoster);
    });
  }

  private handleRoster(message: LobbySnapshot): void {
    const players = Array.isArray(message?.players)
      ? message.players.map((player) => ({ ...player, hero: safeHero(player.hero) }))
      : [];
    this.lobby = {
      roomId: String(message?.roomId || this.roomId),
      phase: message?.phase === "active" || message?.phase === "results" ? message.phase : "lobby",
      seed: Number(message?.seed) || 1,
      hostSessionId: String(message?.hostSessionId || ""),
      players,
    };

    this.rebuildPeerTopology();
    emit(this, "roster", this.lobby);
    this.updateDebugState("connected");
  }

  private rebuildPeerTopology(): void {
    if (!this.room || !this.lobby?.hostSessionId) return;

    const allowedPeers = new Set<string>();
    if (this.isHost) {
      for (const player of this.lobby.players) {
        if (player.sessionId !== this.sessionId && player.connected) allowedPeers.add(player.sessionId);
      }
    } else if (this.hostSessionId !== this.sessionId) {
      allowedPeers.add(this.hostSessionId);
    }

    for (const [peerId, link] of this.peers) {
      if (allowedPeers.has(peerId)) continue;
      link.channel?.close();
      link.pc.close();
      this.peers.delete(peerId);
    }

    if (this.isHost) {
      for (const peerId of allowedPeers) void this.ensureHostOffer(peerId);
    }
    this.updateDebugState();
  }

  private createPeer(peerId: string): PeerLink {
    const existing = this.peers.get(peerId);
    if (existing && existing.pc.connectionState !== "closed") return existing;

    const iceServers: RTCIceServer[] = [
      { urls: "stun:stun.l.google.com:19302" },
      { urls: "stun:stun1.l.google.com:19302" },
    ];
    const turnUrl = String(import.meta.env.VITE_TURN_URL ?? "").trim();
    if (turnUrl) {
      iceServers.push({
        urls: turnUrl,
        username: String(import.meta.env.VITE_TURN_USERNAME ?? ""),
        credential: String(import.meta.env.VITE_TURN_CREDENTIAL ?? ""),
      });
    }

    const link: PeerLink = {
      pc: new RTCPeerConnection({ iceServers }),
      makingOffer: false,
      connected: false,
      pendingCandidates: [],
    };
    this.peers.set(peerId, link);

    link.pc.onicecandidate = (event) => {
      if (!event.candidate || !this.room) return;
      this.room.send("signal", { target: peerId, payload: { candidate: event.candidate.toJSON() } });
    };

    link.pc.ondatachannel = (event) => this.attachChannel(peerId, link, event.channel);
    link.pc.onconnectionstatechange = () => {
      const state = link.pc.connectionState;
      link.connected = state === "connected";
      emit(this, "peer-state", { peerId, state });
      this.updateDebugState();
      if ((state === "failed" || state === "closed") && this.isHost && this.lobby?.players.some((p) => p.sessionId === peerId && p.connected)) {
        window.setTimeout(() => void this.ensureHostOffer(peerId, true), 250);
      }
    };

    return link;
  }

  private attachChannel(peerId: string, link: PeerLink, channel: RTCDataChannel): void {
    link.channel = channel;
    channel.binaryType = "arraybuffer";
    channel.onopen = () => {
      link.connected = true;
      emit(this, "peer-state", { peerId, state: "connected" });
      this.sendPacketTo(peerId, { type: "hello", name: this.name, hero: this.hero });
      this.updateDebugState();
    };
    channel.onclose = () => {
      link.connected = false;
      emit(this, "peer-state", { peerId, state: "closed" });
      this.updateDebugState();
    };
    channel.onerror = () => {
      emit(this, "peer-state", { peerId, state: "error" });
      this.updateDebugState("error");
    };
    channel.onmessage = (event) => {
      try {
        const packet = JSON.parse(String(event.data)) as GamePacket;
        emit(this, "packet", { from: peerId, packet });
      } catch {
        // Ignore malformed peer packets. The signaling room stays intact.
      }
    };
  }

  private async ensureHostOffer(peerId: string, force = false): Promise<void> {
    if (!this.isHost || !this.room) return;
    if (force) {
      const stale = this.peers.get(peerId);
      stale?.channel?.close();
      stale?.pc.close();
      this.peers.delete(peerId);
    }

    const link = this.createPeer(peerId);
    if (link.channel?.readyState === "open" || link.makingOffer) return;
    if (!link.channel) this.attachChannel(peerId, link, link.pc.createDataChannel("animal-care-game", { ordered: true }));

    try {
      link.makingOffer = true;
      const offer = await link.pc.createOffer();
      await link.pc.setLocalDescription(offer);
      this.room.send("signal", { target: peerId, payload: { description: link.pc.localDescription } });
    } finally {
      link.makingOffer = false;
    }
  }

  private async flushPendingCandidates(link: PeerLink): Promise<void> {
    if (!link.pc.remoteDescription || link.pendingCandidates.length === 0) return;
    const candidates = link.pendingCandidates.splice(0);
    for (const candidate of candidates) {
      try {
        await link.pc.addIceCandidate(candidate);
      } catch (error) {
        console.debug("Ignoring ICE candidate from a replaced negotiation", error);
      }
    }
  }

  private async handleSignal(from: string, payload: SignalPayload): Promise<void> {
    if (!this.room) return;
    const link = this.createPeer(from);

    if (payload.description) {
      const description = payload.description;
      await link.pc.setRemoteDescription(description);
      await this.flushPendingCandidates(link);
      if (description.type === "offer") {
        const answer = await link.pc.createAnswer();
        await link.pc.setLocalDescription(answer);
        this.room.send("signal", { target: from, payload: { description: link.pc.localDescription } });
      }
    }

    if (payload.candidate) {
      if (!link.pc.remoteDescription) {
        link.pendingCandidates.push(payload.candidate);
        return;
      }
      try {
        await link.pc.addIceCandidate(payload.candidate);
      } catch (error) {
        console.debug("Ignoring ICE candidate from a replaced negotiation", error);
      }
    }
  }

  private closePeerLinks(): void {
    for (const link of this.peers.values()) {
      link.channel?.close();
      link.pc.close();
    }
    this.peers.clear();
  }

  private updateDebugState(connectionState?: string): void {
    (window as any).__animalCareNetwork = {
      mode: this.mode,
      roomId: this.roomId,
      sessionId: this.sessionId,
      hostSessionId: this.hostSessionId,
      isHost: this.isHost,
      connectedPeers: this.connectedPeerCount,
      players: this.lobby?.players?.length ?? 0,
      connectionState: connectionState ?? (this.room ? "connected" : "local"),
    };
  }
}
