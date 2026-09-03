import Phaser from "phaser";
import { buildAnimalHospitalUnoDeck, createAnimalHospitalUnoCard, type HospitalUnoCardView } from "../cards/AnimalHospitalUnoDeck";

export class CardGalleryScene extends Phaser.Scene {
  private page = 0;
  private readonly pageSize = 12;
  private cardViews: HospitalUnoCardView[] = [];
  private pageLabel?: Phaser.GameObjects.Text;

  constructor() {
    super("CardGalleryScene");
  }

  create(): void {
    this.cameras.main.setBackgroundColor("#172427");

    this.add.text(40, 28, "ANIMAL HOSPITAL • NIGHT SHIFT CARDS", {
      fontFamily: "Arial Black, Arial, sans-serif",
      fontSize: "25px",
      color: "#fff6dd",
    });
    this.add.text(40, 61, "UNO-style deck concept • original Animal Hospital motifs • 108 cards", {
      fontFamily: "Arial, sans-serif",
      fontSize: "13px",
      color: "#9db8b6",
    });

    const legend = [
      ["ENEMIES", "#c94f4b"],
      ["ANOMALIES", "#e2ad3f"],
      ["CLASSES", "#5d9875"],
      ["CHARACTERS", "#4f7fa7"],
    ];
    legend.forEach(([label, color], index) => {
      const x = 770 + index * 118;
      this.add.rectangle(x, 42, 9, 9, Phaser.Display.Color.HexStringToColor(color).color, 1);
      this.add.text(x + 10, 35, label, { fontFamily: "Arial, sans-serif", fontSize: "9px", color: "#d7e3df" });
    });

    const back = this.add.text(46, 673, "‹ PREV", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: "#fff6dd",
      backgroundColor: "#294044",
      padding: { x: 12, y: 7 },
    }).setInteractive({ useHandCursor: true });

    const next = this.add.text(1190, 673, "NEXT ›", {
      fontFamily: "Arial, sans-serif",
      fontSize: "15px",
      fontStyle: "bold",
      color: "#fff6dd",
      backgroundColor: "#294044",
      padding: { x: 12, y: 7 },
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });

    this.pageLabel = this.add.text(640, 679, "", {
      fontFamily: "Arial, sans-serif",
      fontSize: "12px",
      color: "#9db8b6",
    }).setOrigin(0.5, 0);

    back.on("pointerdown", () => this.changePage(-1));
    next.on("pointerdown", () => this.changePage(1));
    this.input.keyboard?.on("keydown-LEFT", () => this.changePage(-1));
    this.input.keyboard?.on("keydown-RIGHT", () => this.changePage(1));

    this.renderPage();
  }

  private changePage(delta: number): void {
    const deck = buildAnimalHospitalUnoDeck();
    const pages = Math.ceil(deck.length / this.pageSize);
    this.page = Phaser.Math.Wrap(this.page + delta, 0, pages);
    this.renderPage();
  }

  private renderPage(): void {
    this.cardViews.forEach((view) => view.container.destroy(true));
    this.cardViews = [];

    const deck = buildAnimalHospitalUnoDeck();
    const pages = Math.ceil(deck.length / this.pageSize);
    const cards = deck.slice(this.page * this.pageSize, (this.page + 1) * this.pageSize);

    cards.forEach((card, index) => {
      const column = index % 6;
      const row = Math.floor(index / 6);
      const view = createAnimalHospitalUnoCard(this, card, 120 + column * 205, 202 + row * 300, 1.12);
      view.container.setDepth(5);
      view.container.setInteractive(new Phaser.Geom.Rectangle(-52, -77, 104, 154), Phaser.Geom.Rectangle.Contains);
      view.container.on("pointerover", () => this.tweens.add({ targets: view.container, scaleX: 1.2, scaleY: 1.2, y: view.container.y - 10, duration: 110 }));
      view.container.on("pointerout", () => this.tweens.add({ targets: view.container, scaleX: 1.12, scaleY: 1.12, y: 202 + row * 300, duration: 110 }));
      this.cardViews.push(view);
    });

    this.pageLabel?.setText(`PAGE ${this.page + 1} / ${pages}   •   ${deck.length} CARDS`);
  }
}
