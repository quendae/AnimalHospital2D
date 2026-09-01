import Phaser from "phaser";
import "./styles.css";
import { ClinicScene } from "./scenes/ClinicScene";

const config: Phaser.Types.Core.GameConfig = {
  type: Phaser.AUTO,
  parent: "game",
  width: 1280,
  height: 720,
  backgroundColor: "#f2eadb",
  pixelArt: false,
  antialias: true,
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
  scene: [ClinicScene],
};

new Phaser.Game(config);
