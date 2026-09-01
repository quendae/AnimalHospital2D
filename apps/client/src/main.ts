import Phaser from "phaser";
import "./styles.css";
import { ClinicSceneV2 } from "./scenes/ClinicSceneV2";
import { installClinicSceneV2Guards } from "./scenes/ClinicSceneV2Guard";
import { installClinicSceneV2IterationB } from "./scenes/ClinicSceneV2IterationB";
import { installClinicSceneV2IterationC } from "./scenes/ClinicSceneV2IterationC";
import { installClinicSceneV2IterationD } from "./scenes/ClinicSceneV2IterationD";

installClinicSceneV2Guards();
installClinicSceneV2IterationB();
installClinicSceneV2IterationC();
installClinicSceneV2IterationD();

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

new Phaser.Game(config);
