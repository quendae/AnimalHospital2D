import Phaser from "phaser";
import "./styles.css";
import { ClinicSceneV2 } from "./scenes/ClinicSceneV2";
import { installClinicSceneV2Guards } from "./scenes/ClinicSceneV2Guard";
import { installClinicSceneV2IterationB } from "./scenes/ClinicSceneV2IterationB";
import { installClinicSceneV2IterationC } from "./scenes/ClinicSceneV2IterationC";
import { installClinicSceneV2IterationD } from "./scenes/ClinicSceneV2IterationD";
import { installClinicSceneV2IterationE } from "./scenes/ClinicSceneV2IterationE";
import { showLobbyOverlay } from "./multiplayer/LobbyOverlay";
import { installClinicSceneV2Multiplayer } from "./multiplayer/ClinicP2PBridge";

installClinicSceneV2Guards();
installClinicSceneV2IterationB();
installClinicSceneV2IterationC();
installClinicSceneV2IterationD();

async function bootstrap(): Promise<void> {
  const launch = await showLobbyOverlay();
  const url = new URL(window.location.href);
  url.searchParams.set("seed", String(launch.seed));
  if (launch.mode === "local") url.searchParams.delete("room");
  history.replaceState(null, "", url);

  installClinicSceneV2IterationE({ hero: launch.hero, name: launch.name });
  if (launch.session) installClinicSceneV2Multiplayer(launch.session, { hero: launch.hero, name: launch.name });

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
    scene: [ClinicSceneV2],
  };

  const game = new Phaser.Game(config);
  (window as any).__animalCareGame = game;
  (window as any).__animalCareSession = launch.session;
  (window as any).__animalCareLaunch = {
    mode: launch.mode,
    hero: launch.hero,
    name: launch.name,
    seed: launch.seed,
    roomId: launch.session?.roomId ?? "",
  };
}

void bootstrap();
