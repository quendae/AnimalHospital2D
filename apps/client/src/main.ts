import Phaser from "phaser";
import "./styles.css";
import { mountLobby } from "./multiplayer/LobbyController";
import type { P2PSession } from "./multiplayer/P2PSession";
import { CardGalleryScene } from "./scenes/CardGalleryScene";
import { ClinicSceneV2 } from "./scenes/ClinicSceneV2";
import { installClinicSceneV2Guards } from "./scenes/ClinicSceneV2Guard";
import { installClinicSceneV2IterationB } from "./scenes/ClinicSceneV2IterationB";
import { installClinicSceneV2IterationC } from "./scenes/ClinicSceneV2IterationC";
import { installClinicSceneV2IterationD } from "./scenes/ClinicSceneV2IterationD";
import { installClinicSceneV2IterationE } from "./scenes/ClinicSceneV2IterationE";

installClinicSceneV2Guards();
installClinicSceneV2IterationB();
installClinicSceneV2IterationC();
installClinicSceneV2IterationD();
installClinicSceneV2IterationE();

type RuntimeWindow = Window & typeof globalThis & {
  __ANIMAL_CARE_NETWORK__?: P2PSession;
};

const params = new URLSearchParams(window.location.search);
const cardGalleryMode = params.get("cards") === "1";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#f2eadb",
  pixelArt: false,
  antialias: true,
  roundPixels: true,
  render: {
    antialias: true,
    antialiasGL: true,
    roundPixels: true,
    powerPreference: "high-performance",
  },
  physics: {
    default: "arcade",
    arcade: {
      gravity: { x: 0, y: 0 },
      debug: false,
    },
  },
  scale: {
    mode: Phaser.Scale.RESIZE,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [cardGalleryMode ? CardGalleryScene : ClinicSceneV2],
};

let game: Phaser.Game | undefined;
let disposeLobby: (() => void) | undefined;
let networkHud: HTMLElement | undefined;

function installNetworkHud(session: P2PSession): void {
  networkHud?.remove();
  const shell = document.querySelector<HTMLElement>("#game-shell");
  if (!shell) return;
  const hud = document.createElement("div");
  hud.className = "network-status";
  hud.dataset.testid = "network-status";
  hud.textContent = "Łączenie P2P…";
  shell.appendChild(hud);
  networkHud = hud;

  const refresh = (transport?: string) => {
    const role = session.isHost ? "HOST" : "GOŚĆ";
    const mode = transport === "p2p" ? "P2P" : transport === "relay" ? "RELAY" : "ŁĄCZENIE";
    hud.textContent = `${role} · ${session.roomCode ?? "-----"} · ${mode}`;
    hud.dataset.transport = transport ?? "connecting";
    hud.dataset.role = session.isHost ? "host" : "guest";
  };
  session.onTransport((transport) => refresh(transport));
  session.onRoomState(() => refresh(hud.dataset.transport));
}

function launchGame(session: P2PSession | undefined, seed: number): void {
  if (game) return;
  disposeLobby?.();
  disposeLobby = undefined;

  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(seed));
  history.replaceState({}, "", url);

  (window as RuntimeWindow).__ANIMAL_CARE_NETWORK__ = session;
  if (session) installNetworkHud(session);
  game = new Phaser.Game(config);
}

if (cardGalleryMode) {
  game = new Phaser.Game(config);
} else if (params.get("autostart") === "1") {
  const seed = Number(params.get("seed"));
  launchGame(undefined, Number.isFinite(seed) && seed > 0 ? seed : 12345);
} else {
  disposeLobby = mountLobby(launchGame);
}
