import type {
  ClientLobbyMessage,
  LobbyRoomState,
  MultiplayerPacket,
  MultiplayerTransport,
  ServerLobbyMessage,
} from "@animal-care/shared";

type PacketListener = (packet: MultiplayerPacket, fromId: string) => void;
type RoomListener = (state: LobbyRoomState) => void;
type TransportListener = (transport: MultiplayerTransport) => void;
type ErrorListener = (message: string) => void;

type SignalData =
  | { kind: "offer"; description: RTCSessionDescriptionInit }
  | { kind: "answer"; description: RTCSessionDescriptionInit }
  | { kind: "ice"; candidate: RTCIceCandidateInit };

type PeerRuntime = {
  pc: RTCPeerConnection;
  channel?: RTCDataChannel;
  offerStarted: boolean;
};

type EntryMode = "create" | "join" | "resume";

function defaultSignalUrl(): string {
  const explicit = import.meta.env.VITE_SIGNAL_URL as string | undefined;
  if (explicit) return explicit;
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  const host = window.location.hostname || "127.0.0.1";
  return `${protocol}//${host}:2567/ws`;
}

function getClientToken(): string {
  const key = "animal-care-p2p-token";
  const existing = sessionStorage.getItem(key);
  if (existing) return existing;
  const generated = crypto.randomUUID();
  sessionStorage.setItem(key, generated);
  return generated;
}

function iceServers(): RTCIceServer[] {
  const servers: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
  const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
  if (turnUrl) {
    servers.push({
      urls: turnUrl,
      username: (import.meta.env.VITE_TURN_USERNAME as string | undefined) ?? "",
      credential: (import.meta.env.VITE_TURN_CREDENTIAL as string | undefined) ?? "",
    });
  }
  return servers;
}

export class P2PSession {
  private readonly signalUrl: string;
  private readonly clientToken = getClientToken();
  private socket?: WebSocket;
  private room?: LobbyRoomState;
  private peers = new Map<string, PeerRuntime>();
  private packetListeners = new Set<PacketListener>();
  private roomListeners = new Set<RoomListener>();
  private transportListeners = new Set<TransportListener>();
  private errorListeners = new Set<ErrorListener>();
  private pendingResolve?: (state: LobbyRoomState) => void;
  private pendingReject?: (error: Error) => void;
  private entryMode: EntryMode = "join";
  private desiredRoomCode = "";
  private playerName = "Stażyści";
  private closedByUser = false;
  private reconnectAttempt = 0;
  private reconnectTimer?: number;

  constructor(signalUrl = defaultSignalUrl()) {
    this.signalUrl = signalUrl;
  }

  get state(): LobbyRoomState | undefined {
    return this.room;
  }

  get selfId(): string | undefined {
    return this.room?.selfId;
  }

  get hostId(): string | undefined {
    return this.room?.hostId;
  }

  get isHost(): boolean {
    return Boolean(this.room && this.room.selfId === this.room.hostId);
  }

  get roomCode(): string | undefined {
    return this.room?.roomCode;
  }

  get name(): string {
    return this.playerName;
  }

  async createRoom(name: string): Promise<LobbyRoomState> {
    this.playerName = name;
    this.entryMode = "create";
    this.desiredRoomCode = "";
    return this.enterRoom();
  }

  async joinRoom(roomCode: string, name: string): Promise<LobbyRoomState> {
    this.playerName = name;
    this.entryMode = "join";
    this.desiredRoomCode = roomCode.trim().toUpperCase();
    return this.enterRoom();
  }

  onPacket(listener: PacketListener): () => void {
    this.packetListeners.add(listener);
    return () => this.packetListeners.delete(listener);
  }

  onRoomState(listener: RoomListener): () => void {
    this.roomListeners.add(listener);
    if (this.room) listener(this.room);
    return () => this.roomListeners.delete(listener);
  }

  onTransport(listener: TransportListener): () => void {
    this.transportListeners.add(listener);
    listener(this.currentTransport());
    return () => this.transportListeners.delete(listener);
  }

  onError(listener: ErrorListener): () => void {
    this.errorListeners.add(listener);
    return () => this.errorListeners.delete(listener);
  }

  sendToHost(packet: MultiplayerPacket): void {
    const hostId = this.room?.hostId;
    if (!hostId) return;
    if (hostId === this.room?.selfId) {
      this.emitPacket(packet, hostId);
      return;
    }
    this.sendTo(hostId, packet);
  }

  sendTo(peerId: string, packet: MultiplayerPacket): void {
    const peer = this.peers.get(peerId);
    const payload = JSON.stringify(packet);
    if (peer?.channel?.readyState === "open") {
      peer.channel.send(payload);
      return;
    }
    this.sendSignal({ type: "relay", targetId: peerId, data: packet });
    this.emitTransport();
  }

  broadcast(packet: MultiplayerPacket): void {
    const selfId = this.room?.selfId;
    for (const member of this.room?.members ?? []) {
      if (!member.connected || member.id === selfId) continue;
      this.sendTo(member.id, packet);
    }
  }

  close(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) window.clearTimeout(this.reconnectTimer);
    this.sendSignal({ type: "leave-room" });
    this.socket?.close(1000, "Leaving room");
    this.socket = undefined;
    for (const peer of this.peers.values()) peer.pc.close();
    this.peers.clear();
    this.room = undefined;
    this.emitTransport();
  }

  private enterRoom(): Promise<LobbyRoomState> {
    this.closedByUser = false;
    this.pendingReject?.(new Error("Superseded room request"));
    return new Promise<LobbyRoomState>((resolve, reject) => {
      this.pendingResolve = resolve;
      this.pendingReject = reject;
      this.openSocket();
    });
  }

  private openSocket(): void {
    if (this.socket?.readyState === WebSocket.OPEN || this.socket?.readyState === WebSocket.CONNECTING) return;
    this.emitTransport("connecting");
    const socket = new WebSocket(this.signalUrl);
    this.socket = socket;

    socket.addEventListener("open", () => {
      this.reconnectAttempt = 0;
      if (this.room?.roomCode) {
        this.entryMode = "resume";
        this.desiredRoomCode = this.room.roomCode;
      }
      this.sendEntryMessage();
    });

    socket.addEventListener("message", (event) => this.handleServerMessage(event.data));
    socket.addEventListener("close", () => this.handleSocketClose());
    socket.addEventListener("error", () => {
      if (!this.room) this.emitError("Nie udało się połączyć z serwerem lobby.");
    });
  }

  private sendEntryMessage(): void {
    if (this.entryMode === "create") {
      this.sendSignal({ type: "create-room", name: this.playerName, clientToken: this.clientToken });
      return;
    }
    if (this.entryMode === "resume") {
      this.sendSignal({
        type: "resume-room",
        roomCode: this.desiredRoomCode,
        name: this.playerName,
        clientToken: this.clientToken,
      });
      return;
    }
    this.sendSignal({
      type: "join-room",
      roomCode: this.desiredRoomCode,
      name: this.playerName,
      clientToken: this.clientToken,
    });
  }

  private sendSignal(message: ClientLobbyMessage): void {
    if (this.socket?.readyState !== WebSocket.OPEN) return;
    this.socket.send(JSON.stringify(message));
  }

  private handleServerMessage(raw: unknown): void {
    let message: ServerLobbyMessage;
    try {
      message = JSON.parse(String(raw)) as ServerLobbyMessage;
    } catch {
      return;
    }

    if (message.type === "room-state") {
      this.handleRoomState(message);
      return;
    }
    if (message.type === "signal") {
      void this.handleSignal(message.fromId, message.data as SignalData);
      return;
    }
    if (message.type === "relay") {
      this.emitPacket(message.data as MultiplayerPacket, message.fromId);
      this.emitTransport();
      return;
    }
    if (message.type === "error") {
      const error = new Error(message.message);
      this.pendingReject?.(error);
      this.pendingReject = undefined;
      this.pendingResolve = undefined;
      this.emitError(message.message);
    }
  }

  private handleRoomState(state: LobbyRoomState): void {
    const previousSelfId = this.room?.selfId;
    this.room = state;
    this.desiredRoomCode = state.roomCode;
    this.entryMode = "resume";

    if (previousSelfId && previousSelfId !== state.selfId) {
      for (const peer of this.peers.values()) peer.pc.close();
      this.peers.clear();
    }

    const liveIds = new Set(state.members.filter((member) => member.connected).map((member) => member.id));
    for (const [peerId, peer] of this.peers) {
      if (liveIds.has(peerId)) continue;
      peer.pc.close();
      this.peers.delete(peerId);
    }

    for (const member of state.members) {
      if (member.id === state.selfId || !member.connected) continue;
      void this.ensurePeer(member.id);
    }

    for (const listener of this.roomListeners) listener(state);
    this.pendingResolve?.(state);
    this.pendingResolve = undefined;
    this.pendingReject = undefined;
    this.emitTransport();
  }

  private async ensurePeer(peerId: string): Promise<PeerRuntime> {
    const existing = this.peers.get(peerId);
    if (existing) return existing;

    const pc = new RTCPeerConnection({ iceServers: iceServers() });
    const runtime: PeerRuntime = { pc, offerStarted: false };
    this.peers.set(peerId, runtime);

    pc.onicecandidate = (event) => {
      if (!event.candidate) return;
      this.sendSignal({
        type: "signal",
        targetId: peerId,
        data: { kind: "ice", candidate: event.candidate.toJSON() } satisfies SignalData,
      });
    };

    pc.ondatachannel = (event) => this.attachChannel(peerId, runtime, event.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        pc.close();
        this.peers.delete(peerId);
        window.setTimeout(() => {
          if (this.room?.members.some((member) => member.id === peerId && member.connected)) void this.ensurePeer(peerId);
        }, 800);
      }
      this.emitTransport();
    };

    if ((this.room?.selfId ?? "").localeCompare(peerId) < 0) {
      runtime.offerStarted = true;
      this.attachChannel(peerId, runtime, pc.createDataChannel("animal-care", { ordered: true }));
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendSignal({
        type: "signal",
        targetId: peerId,
        data: { kind: "offer", description: offer } satisfies SignalData,
      });
    }

    return runtime;
  }

  private attachChannel(peerId: string, runtime: PeerRuntime, channel: RTCDataChannel): void {
    runtime.channel = channel;
    channel.onopen = () => this.emitTransport();
    channel.onclose = () => this.emitTransport();
    channel.onerror = () => this.emitTransport();
    channel.onmessage = (event) => {
      try {
        this.emitPacket(JSON.parse(String(event.data)) as MultiplayerPacket, peerId);
      } catch {
        // Ignore malformed peer packets. The host still validates gameplay intent.
      }
    };
  }

  private async handleSignal(fromId: string, signal: SignalData): Promise<void> {
    const peer = await this.ensurePeer(fromId);
    if (signal.kind === "offer") {
      await peer.pc.setRemoteDescription(signal.description);
      const answer = await peer.pc.createAnswer();
      await peer.pc.setLocalDescription(answer);
      this.sendSignal({
        type: "signal",
        targetId: fromId,
        data: { kind: "answer", description: answer } satisfies SignalData,
      });
      return;
    }
    if (signal.kind === "answer") {
      if (!peer.pc.currentRemoteDescription) await peer.pc.setRemoteDescription(signal.description);
      return;
    }
    if (signal.kind === "ice") {
      try {
        await peer.pc.addIceCandidate(signal.candidate);
      } catch {
        // Candidates can race the SDP exchange; a later room-state retry heals it.
      }
    }
  }

  private handleSocketClose(): void {
    this.socket = undefined;
    if (this.closedByUser) return;
    if (!this.room) {
      this.pendingReject?.(new Error("Połączenie z lobby zostało przerwane."));
      this.pendingReject = undefined;
      this.pendingResolve = undefined;
      this.emitTransport("offline");
      return;
    }

    this.reconnectAttempt += 1;
    this.emitTransport("connecting");
    const delay = Math.min(3000, 350 * 2 ** Math.min(3, this.reconnectAttempt - 1));
    this.reconnectTimer = window.setTimeout(() => this.openSocket(), delay);
  }

  private emitPacket(packet: MultiplayerPacket, fromId: string): void {
    for (const listener of this.packetListeners) listener(packet, fromId);
  }

  private currentTransport(): MultiplayerTransport {
    if (this.closedByUser) return "offline";
    if (this.room) {
      const others = this.room.members.filter((member) => member.connected && member.id !== this.room?.selfId);
      if (others.length === 0) return this.socket?.readyState === WebSocket.OPEN ? "p2p" : "connecting";
      const allDirect = others.every((member) => this.peers.get(member.id)?.channel?.readyState === "open");
      if (allDirect) return "p2p";
      return this.socket?.readyState === WebSocket.OPEN ? "relay" : "connecting";
    }
    return this.socket?.readyState === WebSocket.OPEN ? "connecting" : "offline";
  }

  private emitTransport(force?: MultiplayerTransport): void {
    const value = force ?? this.currentTransport();
    for (const listener of this.transportListeners) listener(value);
  }

  private emitError(message: string): void {
    for (const listener of this.errorListeners) listener(message);
  }
}
