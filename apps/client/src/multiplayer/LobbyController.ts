import type { LobbyRoomState, MultiplayerTransport } from "@animal-care/shared";
import { P2PSession } from "./P2PSession";

type StartHandler = (session: P2PSession | undefined, seed: number) => void;

function safeName(): string {
  return (localStorage.getItem("animal-care-player-name") ?? "Stażyści").slice(0, 18);
}

function randomSeed(): number {
  return Math.floor((Date.now() + Math.random() * 1_000_000) % 9_999_999) + 1;
}

export function mountLobby(onStart: StartHandler): () => void {
  const shell = document.querySelector<HTMLElement>("#game-shell");
  if (!shell) throw new Error("Missing #game-shell");

  const overlay = document.createElement("section");
  overlay.id = "multiplayer-lobby";
  overlay.dataset.testid = "multiplayer-lobby";
  overlay.innerHTML = `
    <div class="lobby-card">
      <div class="lobby-brand">
        <span class="lobby-paw">✚</span>
        <div>
          <p class="eyebrow">ANIMAL CARE CO-OP</p>
          <h1>Dyżur zaczyna się w lobby</h1>
          <p>Graj solo albo otwórz prywatny pokój P2P dla maksymalnie czterech osób.</p>
        </div>
      </div>
      <div class="lobby-form" data-testid="lobby-entry">
        <label>Twoje imię
          <input data-testid="player-name" maxlength="18" autocomplete="nickname" value="${safeName().replaceAll("&", "&amp;").replaceAll('"', "&quot;")}" />
        </label>
        <div class="lobby-actions">
          <button class="primary" data-testid="create-room">Utwórz pokój</button>
          <button data-testid="solo-game">Graj solo</button>
        </div>
        <div class="join-row">
          <input data-testid="room-code-input" maxlength="5" placeholder="KOD POKOJU" autocapitalize="characters" />
          <button data-testid="join-room">Dołącz</button>
        </div>
      </div>
      <div class="lobby-room" data-testid="room-panel" hidden></div>
      <p class="lobby-status" data-testid="lobby-status">Gotowe.</p>
    </div>
  `;
  shell.appendChild(overlay);

  const entry = overlay.querySelector<HTMLElement>("[data-testid='lobby-entry']")!;
  const roomPanel = overlay.querySelector<HTMLElement>("[data-testid='room-panel']")!;
  const status = overlay.querySelector<HTMLElement>("[data-testid='lobby-status']")!;
  const nameInput = overlay.querySelector<HTMLInputElement>("[data-testid='player-name']")!;
  const codeInput = overlay.querySelector<HTMLInputElement>("[data-testid='room-code-input']")!;
  const createButton = overlay.querySelector<HTMLButtonElement>("[data-testid='create-room']")!;
  const joinButton = overlay.querySelector<HTMLButtonElement>("[data-testid='join-room']")!;
  const soloButton = overlay.querySelector<HTMLButtonElement>("[data-testid='solo-game']")!;

  let session: P2PSession | undefined;
  let transport: MultiplayerTransport = "offline";
  let disposed = false;

  const playerName = () => {
    const value = (nameInput.value.trim() || "Stażyści").slice(0, 18);
    localStorage.setItem("animal-care-player-name", value);
    return value;
  };

  const setBusy = (busy: boolean, text?: string) => {
    createButton.disabled = busy;
    joinButton.disabled = busy;
    soloButton.disabled = busy;
    if (text) status.textContent = text;
  };

  const renderRoom = (state: LobbyRoomState) => {
    if (disposed) return;
    entry.hidden = true;
    roomPanel.hidden = false;
    const members = state.members
      .map((member) => `
        <li class="${member.connected ? "" : "disconnected"}">
          <span class="member-dot"></span>
          <strong>${member.name.replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</strong>
          ${member.id === state.hostId ? "<em>HOST</em>" : ""}
          ${member.id === state.selfId ? "<small>TY</small>" : ""}
        </li>`)
      .join("");
    const isHost = state.selfId === state.hostId;
    roomPanel.innerHTML = `
      <div class="room-code-block">
        <span>Kod pokoju</span>
        <strong data-testid="room-code">${state.roomCode}</strong>
        <button class="compact" data-testid="copy-room-code">Kopiuj</button>
      </div>
      <ul class="member-list" data-testid="member-list">${members}</ul>
      <div class="room-footer">
        <span class="transport-pill" data-testid="transport-state">${transport === "p2p" ? "P2P" : transport === "relay" ? "RELAY" : "ŁĄCZENIE"}</span>
        ${isHost ? '<button class="primary" data-testid="start-multiplayer">Rozpocznij dyżur</button>' : '<span class="waiting-host">Host rozpocznie dyżur…</span>'}
      </div>
    `;

    roomPanel.querySelector<HTMLButtonElement>("[data-testid='copy-room-code']")?.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(state.roomCode);
        status.textContent = "Kod skopiowany.";
      } catch {
        status.textContent = `Kod: ${state.roomCode}`;
      }
    });

    roomPanel.querySelector<HTMLButtonElement>("[data-testid='start-multiplayer']")?.addEventListener("click", () => {
      if (!session?.isHost) return;
      const seed = randomSeed();
      session.broadcast({ kind: "game-start", seed });
      onStart(session, seed);
    });
  };

  const bindSession = (next: P2PSession) => {
    session = next;
    next.onRoomState((state) => renderRoom(state));
    next.onTransport((value) => {
      transport = value;
      const pill = roomPanel.querySelector<HTMLElement>("[data-testid='transport-state']");
      if (pill) pill.textContent = value === "p2p" ? "P2P" : value === "relay" ? "RELAY" : value === "offline" ? "OFFLINE" : "ŁĄCZENIE";
      status.textContent = value === "relay"
        ? "Połączenie działa przez bezpieczny fallback relay; WebRTC próbuje zestawić kanał bezpośredni."
        : value === "p2p"
          ? "Kanał P2P gotowy."
          : "Łączenie graczy…";
    });
    next.onError((message) => {
      status.textContent = message;
      setBusy(false);
    });
    next.onPacket((packet) => {
      if (packet.kind !== "game-start" || next.isHost) return;
      onStart(next, packet.seed);
    });
  };

  createButton.addEventListener("click", async () => {
    setBusy(true, "Tworzę pokój…");
    const next = new P2PSession();
    bindSession(next);
    try {
      await next.createRoom(playerName());
      setBusy(false);
    } catch (error) {
      setBusy(false, error instanceof Error ? error.message : "Nie udało się utworzyć pokoju.");
    }
  });

  joinButton.addEventListener("click", async () => {
    const code = codeInput.value.trim().toUpperCase();
    if (code.length < 4) {
      status.textContent = "Wpisz kod pokoju.";
      return;
    }
    setBusy(true, "Dołączam do pokoju…");
    const next = new P2PSession();
    bindSession(next);
    try {
      await next.joinRoom(code, playerName());
      setBusy(false);
    } catch (error) {
      setBusy(false, error instanceof Error ? error.message : "Nie udało się dołączyć.");
    }
  });

  codeInput.addEventListener("input", () => {
    codeInput.value = codeInput.value.toUpperCase().replace(/[^A-Z2-9]/g, "").slice(0, 5);
  });

  soloButton.addEventListener("click", () => onStart(undefined, randomSeed()));

  return () => {
    disposed = true;
    overlay.remove();
  };
}
