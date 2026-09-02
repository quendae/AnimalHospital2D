import Phaser from "phaser";
import { ClinicSceneV2 } from "./ClinicSceneV2";
import { HEROES, type HeroDefinition } from "../multiplayer/LobbyOverlay";
import type { HeroId } from "../multiplayer/P2PSession";

const HERO_TEXTURE_COLORS: Record<HeroId, { fill: number; stroke: number; motif: string }> = {
  lena: { fill: 0x2f8588, stroke: 0x235d62, motif: "+" },
  maks: { fill: 0xd28c46, stroke: 0x8f5b2f, motif: "●" },
  iga: { fill: 0x7466a8, stroke: 0x514376, motif: "◇" },
  bruno: { fill: 0xb85f5b, stroke: 0x814a42, motif: "×" },
};

function portraitKey(hero: HeroId): string {
  return `portrait-${hero}`;
}

function createHeroTextures(scene: any): void {
  for (const hero of HEROES) {
    const key = `intern-${hero.id}`;
    if (scene.textures.exists(key)) continue;
    const palette = HERO_TEXTURE_COLORS[hero.id];
    const graphics = scene.make.graphics({ x: 0, y: 0 }, false);
    graphics.fillStyle(0x173236, .15);
    graphics.fillEllipse(25, 42, 38, 9);
    graphics.fillStyle(palette.fill, 1);
    graphics.fillCircle(24, 24, 21);
    graphics.lineStyle(4, palette.stroke, 1);
    graphics.strokeCircle(24, 24, 20);
    graphics.fillStyle(0xfffdf7, 1);
    graphics.fillRoundedRect(17, 8, 14, 32, 4);
    graphics.fillRoundedRect(8, 17, 32, 14, 4);
    graphics.fillStyle(palette.stroke, 1);
    if (hero.id === "maks") {
      graphics.fillCircle(24, 24, 4);
      graphics.fillCircle(18, 19, 2.6);
      graphics.fillCircle(24, 17, 2.6);
      graphics.fillCircle(30, 19, 2.6);
    } else if (hero.id === "iga") {
      graphics.lineStyle(3, palette.stroke, 1);
      graphics.strokeCircle(24, 24, 6);
      graphics.lineBetween(28, 28, 33, 33);
    } else if (hero.id === "bruno") {
      graphics.fillRoundedRect(15, 21, 18, 7, 4);
      graphics.fillStyle(0xffe3b8, 1);
      graphics.fillRoundedRect(21, 17, 7, 15, 3);
    }
    graphics.generateTexture(key, 48, 48);
    graphics.destroy();
  }
}

function heroDefinition(hero: HeroId): HeroDefinition {
  return HEROES.find((candidate) => candidate.id === hero) ?? HEROES[0];
}

function createHeroHud(scene: any, heroId: HeroId, playerName: string): void {
  const hero = heroDefinition(heroId);
  const x = 1178;
  const y = 31;
  const portrait = scene.add.image(x, y, portraitKey(heroId)).setDisplaySize(46, 46).setDepth(220);
  const frame = scene.add.rectangle(x, y, 50, 50, 0xffffff, 0).setStrokeStyle(3, HERO_TEXTURE_COLORS[heroId].fill, 1).setDepth(221);
  const name = scene.add.text(x - 31, y - 14, playerName, scene.textStyle(10, "#ffffff", 900)).setOrigin(1, .5).setDepth(221);
  const role = scene.add.text(x - 31, y + 6, hero.name.toUpperCase(), scene.textStyle(7, "#bcd6cf", 900)).setOrigin(1, .5).setDepth(221);
  const motif = scene.add.text(x + 29, y + 16, HERO_TEXTURE_COLORS[heroId].motif, scene.textStyle(10, "#ffffff", 900))
    .setOrigin(.5)
    .setBackgroundColor(hero.accent)
    .setPadding(3, 1, 3, 1)
    .setDepth(222);
  scene.__heroHud = scene.add.container(0, 0, [portrait, frame, name, role, motif]).setDepth(220);
}

function pulseActor(scene: any): void {
  const actor = scene.player as Phaser.GameObjects.Sprite | undefined;
  if (!actor || scene.activeMinigame) return;
  scene.tweens.killTweensOf(actor);
  actor.setScale(1.08, .92);
  scene.tweens.add({
    targets: actor,
    scaleX: 1,
    scaleY: 1,
    duration: 125,
    ease: "Back.Out",
  });
}

/**
 * Character/interaction polish layer. Portrait assets stay separate from game
 * rules so final painted art can replace them without touching networking.
 */
export function installClinicSceneV2IterationE(profile: { hero: HeroId; name: string }): void {
  const prototype = ClinicSceneV2.prototype as any;
  if (prototype.__iterationEInstalled) return;

  const originalPreload = prototype.preload;
  prototype.preload = function iterationEPreload(this: any, ...args: any[]) {
    if (originalPreload) originalPreload.apply(this, args);
    for (const hero of HEROES) {
      if (!this.textures.exists(portraitKey(hero.id))) this.load.image(portraitKey(hero.id), hero.portrait);
    }
  };

  const originalCreatePlayerTexture = prototype.createPlayerTexture;
  prototype.createPlayerTexture = function iterationECreatePlayerTexture(this: any) {
    originalCreatePlayerTexture.call(this);
    createHeroTextures(this);
  };

  const originalCreate = prototype.create;
  prototype.create = function iterationECreate(this: any, ...args: any[]) {
    const result = originalCreate.apply(this, args);
    this.player.setTexture(`intern-${profile.hero}`);
    createHeroHud(this, profile.hero, profile.name);
    this.player.setScale(.9);
    this.tweens.add({ targets: this.player, scaleX: 1, scaleY: 1, duration: 240, ease: "Back.Out" });
    return result;
  };

  const originalHandleInteraction = prototype.handleInteraction;
  prototype.handleInteraction = function iterationEInteraction(this: any) {
    pulseActor(this);
    return originalHandleInteraction.call(this);
  };

  const originalCreatePatientView = prototype.createPatientView;
  prototype.createPatientView = function iterationEPatientView(this: any, patient: any) {
    const view = originalCreatePatientView.call(this, patient);
    view.container.setScale(.82).setAlpha(.2);
    this.tweens.add({
      targets: view.container,
      alpha: 1,
      scaleX: 1,
      scaleY: 1,
      duration: 220,
      ease: "Back.Out",
    });
    const priorityColor = patient.priority === "critical" ? 0xc6504c : patient.priority === "urgent" ? 0xd58a42 : 0x6ea189;
    const priorityDot = this.add.circle(-21, -21, 5, priorityColor, 1).setStrokeStyle(2, 0xfffdf7, 1);
    view.container.add(priorityDot);
    return view;
  };

  prototype.__iterationEInstalled = true;
}
