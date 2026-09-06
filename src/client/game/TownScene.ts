import Phaser from "phaser";
import { AgentState, WorldEntity, WorldSnapshot } from "../../shared/protocol";

const TILE_WIDTH = 58;
const TILE_HEIGHT = 29;
const ORIGIN_X = 360;
const ORIGIN_Y = 54;

function isoToScreen(x: number, y: number): { x: number; y: number } {
  return {
    x: ORIGIN_X + (x - y) * (TILE_WIDTH / 2),
    y: ORIGIN_Y + (x + y) * (TILE_HEIGHT / 2),
  };
}

function drawDiamond(graphics: Phaser.GameObjects.Graphics, x: number, y: number, color: number): void {
  graphics.fillStyle(color, 1);
  graphics.beginPath();
  graphics.moveTo(x, y - TILE_HEIGHT / 2);
  graphics.lineTo(x + TILE_WIDTH / 2, y);
  graphics.lineTo(x, y + TILE_HEIGHT / 2);
  graphics.lineTo(x - TILE_WIDTH / 2, y);
  graphics.closePath();
  graphics.fillPath();
  graphics.lineStyle(1, 0x263442, 0.8);
  graphics.strokePath();
}

export class TownScene extends Phaser.Scene {
  private snapshot?: WorldSnapshot;
  private worldLayer?: Phaser.GameObjects.Graphics;
  private labels: Phaser.GameObjects.Text[] = [];

  constructor() {
    super("TownScene");
  }

  create(): void {
    this.renderTown();
  }

  setSnapshot(snapshot: WorldSnapshot): void {
    this.snapshot = snapshot;
    if (this.worldLayer) this.renderTown();
  }

  private renderTown(): void {
    this.worldLayer?.destroy();
    this.labels.forEach((label) => label.destroy());
    this.labels = [];
    const graphics = this.add.graphics();
    this.worldLayer = graphics;

    for (let y = 0; y < (this.snapshot?.height ?? 10); y += 1) {
      for (let x = 0; x < (this.snapshot?.width ?? 14); x += 1) {
        const point = isoToScreen(x, y);
        const isPath = (x + y) % 7 === 0 || (x === 6 && y > 2 && y < 8);
        const isWater = x < 2 && y > 6;
        drawDiamond(graphics, point.x, point.y, isWater ? 0x245269 : isPath ? 0x9b774e : (x + y) % 2 ? 0x3c7656 : 0x427f5d);
      }
    }

    for (const entity of this.snapshot?.entities ?? []) this.drawEntity(graphics, entity);
    for (const agent of this.snapshot?.agents ?? []) this.drawAgent(graphics, agent);
  }

  private drawEntity(graphics: Phaser.GameObjects.Graphics, entity: WorldEntity): void {
    const point = isoToScreen(entity.position.x, entity.position.y);
    const colors: Record<WorldEntity["kind"], number> = {
      landmark: 0xf1c66d,
      quest: 0xf07878,
      resource: 0x8fd694,
    };
    graphics.fillStyle(0x17212b, 1);
    graphics.fillRect(point.x - 10, point.y - 24, 20, 20);
    graphics.fillStyle(colors[entity.kind], 1);
    graphics.fillRect(point.x - 7, point.y - 21, 14, 14);
    graphics.fillStyle(0xffffff, 1);
    graphics.fillRect(point.x - 3, point.y - 18, 3, 3);
    graphics.fillRect(point.x + 2, point.y - 18, 3, 3);
    const label = this.add.text(point.x, point.y + 8, entity.name, {
      color: "#f5ead3",
      fontFamily: "monospace",
      fontSize: "10px",
      stroke: "#101820",
      strokeThickness: 3,
    });
    label.setOrigin(0.5, 0);
    this.labels.push(label);
  }

  private drawAgent(graphics: Phaser.GameObjects.Graphics, agent: AgentState): void {
    const point = isoToScreen(agent.position.x, agent.position.y);
    graphics.fillStyle(0x151a24, 1);
    graphics.fillRect(point.x - 10, point.y - 37, 20, 20);
    graphics.fillStyle(0x75d7ff, 1);
    graphics.fillRect(point.x - 7, point.y - 34, 14, 14);
    graphics.fillStyle(0x10212a, 1);
    graphics.fillRect(point.x - 4, point.y - 31, 3, 3);
    graphics.fillRect(point.x + 2, point.y - 31, 3, 3);
    const label = this.add.text(point.x, point.y - 50, agent.name, {
      color: "#75d7ff",
      fontFamily: "monospace",
      fontSize: "10px",
      stroke: "#101820",
      strokeThickness: 3,
    });
    label.setOrigin(0.5, 0);
    this.labels.push(label);
  }
}

export class TownGame {
  private readonly game: Phaser.Game;

  constructor(parent: HTMLElement) {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      width: 720,
      height: 470,
      backgroundColor: "#101820",
      parent,
      scene: [TownScene],
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
    });
  }

  setSnapshot(snapshot: WorldSnapshot): void {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    scene?.setSnapshot(snapshot);
  }

  destroy(): void {
    this.game.destroy(true);
  }
}
