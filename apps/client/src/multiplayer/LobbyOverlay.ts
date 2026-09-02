import { P2PSession, type HeroId, type LobbySnapshot } from "./P2PSession";

export type HeroDefinition = {
  id: HeroId;
  name: string;
  role: string;
  motif: string;
  portrait: string;
  accent: string;
};

export const HEROES: HeroDefinition[] = [
  {
    id: "lena",
    name: "Lena",
    role: "Weterynarka stażystka",
    motif: "Spokój pod presją • stetoskop",
    portrait: "/portraits/lena.svg",
    accent: "#2f8588",
  },
  {
    id: "maks",
    name: "Maks",
    role: "Opiekun zwierząt",
    motif: "Energia • przypinka z łapą",
    portrait: "/portraits/maks.svg",
    accent: "#d28c46",
  },
  {
    id: "iga",
    name: "Iga",
    role: "Diagnostyka",
    motif: "Precyzja • motyw mikroskopu",
    portrait: "/portraits/iga.svg",
    accent: "#7466a8",
  },
  {
    id: "bruno",
    name: "Bruno",
    role: "Pomoc zabiegowa",
    motif: "Szybka reakcja • plaster",
    portrait: "/portraits/bruno.svg",
    accent: "#b85f5b",
  },
];

export type LaunchConfig = {
  mode: "local" | "host" | "guest";
  name: string;
  hero: HeroId;
  seed: number;
  session?: P2PSession;
};

function requestedSeed(): number {
  const value = Number(new URLSearchParams(window.location.search).get("seed"));
  return Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : Math.floor((Date.now() + Math.random() * 1_000_000) % 9_999_999) + 1;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character] ?? character);
}

function playerCard(player: LobbySnapshot["players"][number], hostSessionId: string): string {
  const hero = HEROES.find((candidate) => candidate.id === player.hero) ?? HEROES[0];
  const host = player.sessionId === hostSessionId ? `<span class="lobby-player__host">HOST</span>` : "";
  return `
    <li class="lobby-player" data-session-id="${escapeHtml(player.sessionId)}">
      <img src="${hero.portrait}" alt="" />
      <span class="lobby-player__body">
        <strong>${escapeHtml(player.name)}</strong>
        <small>${hero.name} • ${player.connected ? "online" : "łączenie…"}</small>
      </span>
      ${host}
      <span class="lobby-player__ready ${player.ready ? "is-ready" : ""}">${player.ready ? "GOTOWY" : "CZEKA"}</span>
    </li>`;
}

export function showLobbyOverlay(): Promise<LaunchConfig> {
  const shell = document.querySelector<HTMLElement>("#game-shell");
  if (!shell) throw new Error("Brak #game-shell.");

  const overlay = document.createElement("section");
  overlay.className = "lobby-overlay";
  overlay.dataset.testid = "lobby-overlay";
  overlay.innerHTML = `
    <div class="lobby-panel">
      <header class="lobby-header">
        <div>
          <p class="lobby-kicker">ANIMAL CARE CO-OP</p>
          <h1>Wybierz bohatera i dyżur</h1>
          <p>Karty mają teraz własne portrety i motywy. W multiplayerze serwer zestawia lobby, a rozgrywka przechodzi na P2P.</p>
        </div>
        <span class="lobby-network-pill" data-testid="network-pill">LOCAL</span>
      </header>

      <div class="hero-grid" data-testid="hero-grid">
        ${HEROES.map((hero, index) => `
          <button class="hero-card ${index === 0 ? "is-selected" : ""}" type="button" data-hero="${hero.id}" style="--hero-accent:${hero.accent}" data-testid="hero-${hero.id}">
            <span class="hero-card__portrait-wrap"><img src="${hero.portrait}" alt="Portret: ${hero.name}" /></span>
            <span class="hero-card__copy">
              <strong>${hero.name}</strong>
              <small>${hero.role}</small>
              <em>${hero.motif}</em>
            </span>
            <span class="hero-card__check">✓</span>
          </button>`).join("")}
      </div>

      <div class="lobby-form-grid">
        <label class="lobby-field">
          <span>Twoje imię</span>
          <input data-testid="player-name" maxlength="18" value="Intern" autocomplete="nickname" />
        </label>
        <label class="lobby-field">
          <span>Kod pokoju</span>
          <input data-testid="room-input" maxlength="32" placeholder="np. q7F3..." autocomplete="off" />
        </label>
      </div>

      <div class="lobby-actions lobby-actions--primary">
        <button type="button" class="lobby-button lobby-button--accent" data-testid="host-room">Utwórz pokój</button>
        <button type="button" class="lobby-button" data-testid="join-room">Dołącz po kodzie</button>
        <button type="button" class="lobby-button lobby-button--quiet" data-testid="local-game">Graj lokalnie</button>
      </div>

      <div class="lobby-room" data-testid="room-panel" hidden>
        <div class="lobby-room__summary">
          <div>
            <span>Kod pokoju</span>
            <strong data-testid="room-code">—</strong>
          </div>
          <button type="button" class="lobby-button lobby-button--quiet" data-testid="copy-room">Kopiuj zaproszenie</button>
        </div>
        <ul class="lobby-players" data-testid="player-list"></ul>
        <div class="lobby-actions">
          <button type="button" class="lobby-button" data-testid="ready-toggle">Jestem gotowy</button>
          <button type="button" class="lobby-button lobby-button--accent" data-testid="start-shift" hidden>Start dyżuru</button>
        </div>
      </div>

      <p class="lobby-status" data-testid="lobby-status" aria-live="polite">Wybierz tryb gry.</p>
    </div>`;

  shell.appendChild(overlay);

  const nameInput = overlay.querySelector<HTMLInputElement>("[data-testid=player-name]")!;
  const roomInput = overlay.querySelector<HTMLInputElement>("[data-testid=room-input]")!;
  const status = overlay.querySelector<HTMLElement>("[data-testid=lobby-status]")!;
  const roomPanel = overlay.querySelector<HTMLElement>("[data-testid=room-panel]")!;
  const roomCode = overlay.querySelector<HTMLElement>("[data-testid=room-code]")!;
  const playerList = overlay.querySelector<HTMLElement>("[data-testid=player-list]")!;
  const networkPill = overlay.querySelector<HTMLElement>("[data-testid=network-pill]")!;
  const readyButton = overlay.querySelector<HTMLButtonElement>("[data-testid=ready-toggle]")!;
  const startButton = overlay.querySelector<HTMLButtonElement>("[data-testid=start-shift]")!;
  const hostButton = overlay.querySelector<HTMLButtonElement>("[data-testid=host-room]")!;
  const joinButton = overlay.querySelector<HTMLButtonElement>("[data-testid=join-room]")!;
  const localButton = overlay.querySelector<HTMLButtonElement>("[data-testid=local-game]")!;
  const copyButton = overlay.querySelector<HTMLButtonElement>("[data-testid=copy-room]")!;

  const roomFromUrl = new URLSearchParams(window.location.search).get("room");
  if (roomFromUrl) roomInput.value = roomFromUrl;

  let selectedHero: HeroId = "lena";
  let session: P2PSession | undefined;
  let ready = false;
  let settled = false;

  const setBusy = (busy: boolean) => {
    hostButton.disabled = busy;
    joinButton.disabled = busy;
    localButton.disabled = busy;
    nameInput.disabled = busy;
    roomInput.disabled = busy && !session;
  };

  const updateHeroSelection = (hero: HeroId) => {
    selectedHero = hero;
    for (const card of overlay.querySelectorAll<HTMLElement>("[data-hero]")) {
      card.classList.toggle("is-selected", card.dataset.hero === hero);
    }
    session?.setProfile(nameInput.value, selectedHero);
  };

  for (const card of overlay.querySelectorAll<HTMLButtonElement>("[data-hero]")) {
    card.addEventListener("click", () => updateHeroSelection(card.dataset.hero as HeroId));
  }

  return new Promise<LaunchConfig>((resolve) => {
    const finish = (config: LaunchConfig) => {
      if (settled) return;
      settled = true;
      overlay.classList.add("is-leaving");
      window.setTimeout(() => overlay.remove(), 180);
      resolve(config);
    };

    const renderRoster = (snapshot: LobbySnapshot) => {
      roomPanel.hidden = false;
      roomCode.textContent = snapshot.roomId;
      playerList.innerHTML = snapshot.players.map((player) => playerCard(player, snapshot.hostSessionId)).join("");
      const self = snapshot.players.find((player) => player.sessionId === session?.sessionId);
      ready = Boolean(self?.ready);
      readyButton.textContent = ready ? "Gotowy ✓" : "Jestem gotowy";
      readyButton.classList.toggle("is-active", ready);
      startButton.hidden = !session?.isHost;
      const peerTarget = Math.max(0, snapshot.players.filter((player) => player.connected).length - 1);
      const p2pReady = (session?.connectedPeerCount ?? 0) >= peerTarget;
      networkPill.textContent = p2pReady ? "P2P READY" : "SIGNALING";
      networkPill.classList.toggle("is-ready", p2pReady);
      status.textContent = session?.isHost
        ? `Pokój gotowy. ${snapshot.players.length}/4 graczy • ${p2pReady ? "kanały P2P zestawione" : "zestawianie P2P…"}`
        : `${p2pReady ? "Połączono P2P z hostem." : "Łączenie P2P z hostem…"}`;
    };

    const attachSession = (nextSession: P2PSession) => {
      session = nextSession;
      session.addEventListener("roster", (event) => renderRoster((event as CustomEvent<LobbySnapshot>).detail));
      session.addEventListener("peer-state", () => {
        if (session?.lobby) renderRoster(session.lobby);
      });
      session.addEventListener("connection", (event) => {
        const state = (event as CustomEvent<{ state: string }>).detail.state;
        if (state === "reconnecting") status.textContent = "Utracono signaling — automatyczne ponowne łączenie…";
        if (state === "connected" && session?.lobby) renderRoster(session.lobby);
      });
      session.addEventListener("error", (event) => {
        const detail = (event as CustomEvent<{ message?: string }>).detail;
        status.textContent = `Błąd lobby: ${detail?.message ?? "nieznany błąd"}`;
      });
      session.addEventListener("start", (event) => {
        const seed = Number((event as CustomEvent<{ seed: number }>).detail.seed) || requestedSeed();
        finish({ mode: session?.isHost ? "host" : "guest", name: nameInput.value.trim() || "Intern", hero: selectedHero, seed, session });
      });
    };

    hostButton.addEventListener("click", async () => {
      setBusy(true);
      status.textContent = "Tworzenie pokoju…";
      try {
        const next = new P2PSession({ name: nameInput.value, hero: selectedHero });
        attachSession(next);
        const snapshot = await next.host();
        next.setReady(true);
        renderRoster(snapshot);
        const url = new URL(window.location.href);
        url.searchParams.set("room", snapshot.roomId);
        history.replaceState(null, "", url);
      } catch (error) {
        status.textContent = `Nie udało się utworzyć pokoju: ${error instanceof Error ? error.message : String(error)}`;
        session = undefined;
        setBusy(false);
      }
    });

    joinButton.addEventListener("click", async () => {
      setBusy(true);
      status.textContent = "Dołączanie do pokoju…";
      try {
        const next = new P2PSession({ name: nameInput.value, hero: selectedHero });
        attachSession(next);
        const snapshot = await next.join(roomInput.value);
        next.setReady(true);
        renderRoster(snapshot);
        const url = new URL(window.location.href);
        url.searchParams.set("room", snapshot.roomId);
        history.replaceState(null, "", url);
      } catch (error) {
        status.textContent = `Nie udało się dołączyć: ${error instanceof Error ? error.message : String(error)}`;
        session = undefined;
        setBusy(false);
      }
    });

    localButton.addEventListener("click", () => {
      finish({ mode: "local", name: nameInput.value.trim() || "Intern", hero: selectedHero, seed: requestedSeed() });
    });

    readyButton.addEventListener("click", () => {
      ready = !ready;
      session?.setReady(ready);
    });

    startButton.addEventListener("click", () => {
      if (!session?.isHost || !session.lobby) return;
      const guests = session.lobby.players.filter((player) => player.sessionId !== session?.sessionId && player.connected);
      const everyoneReady = guests.every((player) => player.ready);
      if (!everyoneReady) {
        status.textContent = "Nie wszyscy gracze są gotowi.";
        return;
      }
      status.textContent = "Uruchamianie wspólnego dyżuru…";
      session.startShift();
    });

    copyButton.addEventListener("click", async () => {
      if (!session?.roomId) return;
      const url = new URL(window.location.href);
      url.searchParams.set("room", session.roomId);
      try {
        await navigator.clipboard.writeText(url.toString());
        status.textContent = "Link z kodem pokoju skopiowany.";
      } catch {
        status.textContent = `Kod pokoju: ${session.roomId}`;
      }
    });
  });
}
