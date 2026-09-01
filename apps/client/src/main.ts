import Phaser from "phaser";
import "./styles.css";
import { ClinicSceneV2 } from "./scenes/ClinicSceneV2";
import { installClinicSceneV2Guards } from "./scenes/ClinicSceneV2Guard";

installClinicSceneV2Guards();

const renderResolution = Math.min(Math.max(window.devicePixelRatio || 1, 1), 2);

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  resolution: renderResolution,
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
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  scene: [ClinicSceneV2],
};

new Phaser.Game(config);
