import Phaser from "phaser";
import { TILE_HEIGHT, TILE_WIDTH, WORLD_CHUNKS, WORLD_SIZE, type SimSnapshot, type SpeechLine, type WorldBroadcast } from "../../shared/protocol";

const CHUNK_SIZE = 64;
const CHUNK_COUNT = WORLD_CHUNKS;
const MIN_ZOOM = 0.12;
const MAX_ZOOM = 2.5;

/** 客户端为一个实体维护的渲染记录：精灵、逻辑坐标与插值目标坐标、占格尺寸；移动只是视觉插值，权威坐标在服务端。 */
type RenderedEntity = {
  sprite: Phaser.GameObjects.Sprite | Phaser.GameObjects.Rectangle;
  dialogue?: DialogueBubble;
  x: number;
  y: number;
  targetX: number;
  targetY: number;
  width: number;
  height: number;
  id: string;
  layer: "ground" | "actor";
};

const ACTOR_DEPTH = 100_000;
const DIALOGUE_DEPTH = 1_000_000;

function spriteDepth(footY: number, layer: "ground" | "actor"): number {
  return layer === "ground" ? footY : footY + ACTOR_DEPTH;
}
/** 一个对话气泡：Phaser 容器、尺寸与过期时刻；挂在实体头顶，实体消失后转为漂浮。 */
type DialogueBubble = { container: Phaser.GameObjects.Container; expiresAt: number; width: number; height: number };
/** 说话实体尚未出现在画面时暂存的一条对话，实体渲染出来后再补显示。 */
type PendingDialogue = { text: string; kind: "speech" | "shout" };
/** 与实体脱钩的漂浮气泡：实体消失后对话留在原地直至过期。 */
type FloatingDialogue = DialogueBubble & { x: number; y: number; tilesW: number; tilesH: number };

/** 等距视角的世界画面：世界逻辑全部在服务端（服务端权威），本场景只渲染快照并做视觉插值。 */
export default class TownScene extends Phaser.Scene {
  private floor!: Phaser.GameObjects.Graphics;
  private hoverTile!: Phaser.GameObjects.Graphics;
  private hoverEntity!: Phaser.GameObjects.Graphics;
  private entities = new Map<string, RenderedEntity>();
  private pendingSpeech = new Map<string, PendingDialogue>();
  private floaters: FloatingDialogue[] = [];
  private snapshot: SimSnapshot | null = null;
  private dirty = true;
  private dragging = false;
  private dragStart = { x: 0, y: 0, scrollX: 0, scrollY: 0 };
  private lastHover = "";
  private lastCamera = "";
  private centered = false;
  private ready = false;
  private lastPlayer?: { x: number; y: number };

  constructor() {
    super("town");
  }

  preload() {
    this.load.image("agent", "/assets/agent.png");
    this.load.image("player", "/assets/player.png");
    this.load.image("tree", "/assets/tree.png");
    this.load.image("mall", "/assets/mall.png");
    this.load.image("guard_bot", "/assets/guard-bot.png");
    this.load.image("gacha", "/assets/gacha.png");
    this.load.image("road", "/assets/road.png");
    this.load.image("portal", "/assets/portal.png");
  }

  create() {
    this.cameras.main.setBackgroundColor("#ffffff");
    this.cameras.main.setBounds(-WORLD_SIZE * TILE_WIDTH / 2, -TILE_HEIGHT * 2, WORLD_SIZE * TILE_WIDTH, WORLD_SIZE * TILE_HEIGHT + TILE_HEIGHT * 2);
    this.cameras.main.centerOn(0, (WORLD_SIZE * TILE_HEIGHT) / 4);

    this.floor = this.add.graphics();
    this.hoverTile = this.add.graphics().setDepth(10_000);
    this.hoverEntity = this.add.graphics().setDepth(10_001);
    this.input.on("pointerdown", this.onPointerDown, this);
    this.input.on("pointerup", this.onPointerUp, this);
    this.input.on("pointerupoutside", this.onPointerUp, this);
    this.input.on("pointermove", this.onPointerMove, this);
    this.input.on("wheel", this.onWheel, this);
    this.events.on("postupdate", this.redrawIfNeeded, this);
    this.ready = true;
    this.redrawGrid();
    if (this.snapshot) this.setSnapshot(this.snapshot);
  }

  update(_time: number, delta: number) {
    if (!this.ready) return;
    // Keep movement visual-only: the server remains authoritative for logical coordinates.
    const step = Math.min(1, delta / 180);
    for (const rendered of this.entities.values()) {
      const dx = rendered.targetX - rendered.x;
      const dy = rendered.targetY - rendered.y;
      if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) {
        if (Math.abs(dx) + Math.abs(dy) > 8) {
          rendered.x = rendered.targetX;
          rendered.y = rendered.targetY;
        } else {
          rendered.x += dx * step;
          rendered.y += dy * step;
          if (Math.abs(rendered.targetX - rendered.x) < 0.001) rendered.x = rendered.targetX;
          if (Math.abs(rendered.targetY - rendered.y) < 0.001) rendered.y = rendered.targetY;
        }
        const center = this.iso(rendered.x + rendered.width / 2, rendered.y + rendered.height / 2);
        const foot = { x: center.x, y: center.y + rendered.height * TILE_HEIGHT / 2 };
        rendered.sprite.setPosition(foot.x, foot.y).setDepth(spriteDepth(foot.y, rendered.layer));
      }
      if (rendered.dialogue) {
        if (this.time.now >= rendered.dialogue.expiresAt) {
          rendered.dialogue.container.destroy(true);
          rendered.dialogue = undefined;
        } else {
          this.positionDialogue(rendered.x, rendered.y, rendered.width, rendered.height, rendered.sprite.displayHeight, rendered.dialogue);
        }
      }
    }
    this.floaters = this.floaters.filter((floater) => {
      if (this.time.now >= floater.expiresAt) {
        floater.container.destroy(true);
        return false;
      }
      this.positionDialogue(floater.x, floater.y, floater.tilesW, floater.tilesH, TILE_HEIGHT, floater);
      return true;
    });
  }

  showSpeech(line: SpeechLine) {
    this.showDialogue(line.fromId, line.text, "speech");
  }

  showBroadcast(broadcast: WorldBroadcast) {
    if ((broadcast.type !== "entity_shouted" && broadcast.type !== "entity_emitted") || !broadcast.sourceId) return;
    const text = typeof broadcast.payload?.text === "string" ? broadcast.payload.text : broadcast.message;
    if (this.entities.has(broadcast.sourceId)) {
      this.showDialogue(broadcast.sourceId, text, "shout");
      return;
    }
    this.showWorldDialogue(broadcast.origin.x, broadcast.origin.y, text, "shout");
  }

  private showDialogue(sourceId: string, rawText: string, kind: "speech" | "shout") {
    const line = rawText.trim();
    if (!line) return;
    const rendered = this.entities.get(sourceId);
    if (!rendered) {
      this.pendingSpeech.set(sourceId, { text: line, kind });
      return;
    }
    rendered.dialogue?.container.destroy(true);
    rendered.dialogue = this.makeBubble(line, kind);
    this.positionDialogue(rendered.x, rendered.y, rendered.width, rendered.height, rendered.sprite.displayHeight, rendered.dialogue);
  }

  private showWorldDialogue(x: number, y: number, rawText: string, kind: "speech" | "shout") {
    const line = rawText.trim();
    if (!line) return;
    const bubble = this.makeBubble(line, kind);
    this.floaters.push({ ...bubble, x, y, tilesW: 1, tilesH: 1 });
    this.positionDialogue(x, y, 1, 1, TILE_HEIGHT, bubble);
  }

  private makeBubble(line: string, kind: "speech" | "shout"): DialogueBubble {
    const maxWidth = 300;
    const text = this.add.text(0, 0, line, {
      color: "#172033",
      fontFamily: "monospace",
      fontSize: "16px",
      resolution: 1,
      wordWrap: { width: maxWidth - 24, useAdvancedWrap: true },
    }).setOrigin(0, 0);
    const bounds = text.getBounds();
    const width = Math.min(maxWidth, Math.max(104, Math.ceil(bounds.width + 24)));
    const height = Math.ceil(bounds.height + 18);
    const background = this.add.graphics();
    background.fillStyle(kind === "shout" ? 0xdaf1ff : 0xfff8df, 1);
    background.lineStyle(3, kind === "shout" ? 0x1462a4 : 0x273044, 1);
    background.beginPath();
    background.moveTo(6, 0);
    background.lineTo(width - 6, 0);
    background.lineTo(width, 6);
    background.lineTo(width, height - 8);
    background.lineTo(width - 6, height - 2);
    background.lineTo(width / 2 + 6, height - 2);
    background.lineTo(width / 2, height + 7);
    background.lineTo(width / 2 - 6, height - 2);
    background.lineTo(6, height - 2);
    background.lineTo(0, height - 8);
    background.lineTo(0, 6);
    background.closePath();
    background.fillPath();
    background.strokePath();
    text.setPosition(12, 9);
    return {
      container: this.add.container(0, 0, [background, text]).setDepth(DIALOGUE_DEPTH),
      expiresAt: this.time.now + 5_000,
      width,
      height: height + 7,
    };
  }

  /** Called by React/WebSocket integration whenever a fresh server snapshot arrives. */
  setSnapshot(snapshot: SimSnapshot) {
    this.snapshot = snapshot;
    if (!this.ready) return;
    this.syncEntities();
    const focus = snapshot.entities.find((entity) => entity.type === "player") ?? snapshot.entities.find((entity) => entity.type === "agent");
    if (focus && this.floor) {
      const jumped = this.lastPlayer
        ? Math.abs(focus.position.x - this.lastPlayer.x) + Math.abs(focus.position.y - this.lastPlayer.y) > 8
        : false;
      if (!this.centered || jumped) {
        const size = this.footprint(focus);
        const point = this.iso(focus.position.x + size.width / 2, focus.position.y + size.height / 2);
        this.cameras.main.centerOn(point.x, point.y);
        this.centered = true;
      }
      this.lastPlayer = { x: focus.position.x, y: focus.position.y };
    }
  }

  private iso(x: number, y: number) {
    return { x: (x - y) * TILE_WIDTH / 2, y: (x + y) * TILE_HEIGHT / 2 };
  }

  private tileAt(worldX: number, worldY: number) {
    const x = (worldX / (TILE_WIDTH / 2) + worldY / (TILE_HEIGHT / 2)) / 2;
    const y = (worldY / (TILE_HEIGHT / 2) - worldX / (TILE_WIDTH / 2)) / 2;
    return { x: Math.floor(x), y: Math.floor(y) };
  }

  private diamond(graphics: Phaser.GameObjects.Graphics, x: number, y: number, width = 1, height = 1) {
    const a = this.iso(x, y);
    const b = this.iso(x + width, y);
    const c = this.iso(x + width, y + height);
    const d = this.iso(x, y + height);
    graphics.beginPath();
    graphics.moveTo(a.x, a.y);
    graphics.lineTo(b.x, b.y);
    graphics.lineTo(c.x, c.y);
    graphics.lineTo(d.x, d.y);
    graphics.closePath();
  }

  private redrawIfNeeded() {
    const camera = this.cameras.main;
    const cameraKey = `${camera.scrollX.toFixed(1)}:${camera.scrollY.toFixed(1)}:${camera.zoom.toFixed(2)}`;
    if (cameraKey !== this.lastCamera) {
      this.lastCamera = cameraKey;
      this.dirty = true;
    }
    if (this.dirty) this.redrawGrid();
  }

  private redrawGrid() {
    if (!this.floor) return;
    this.dirty = false;
    const view = this.cameras.main.worldView;
    const corners = [
      this.tileAt(view.x, view.y),
      this.tileAt(view.right, view.y),
      this.tileAt(view.x, view.bottom),
      this.tileAt(view.right, view.bottom),
    ];
    const minX = Math.max(0, Math.min(...corners.map((p) => p.x)) - 2);
    const maxX = Math.min(WORLD_SIZE - 1, Math.max(...corners.map((p) => p.x)) + 2);
    const minY = Math.max(0, Math.min(...corners.map((p) => p.y)) - 2);
    const maxY = Math.min(WORLD_SIZE - 1, Math.max(...corners.map((p) => p.y)) + 2);

    this.floor.clear();
    const lineScale = 1 / this.cameras.main.zoom;
    this.floor.lineStyle(lineScale, 0xd7dce4, 0.9);
    this.floor.fillStyle(0xffffff, 1);
    for (let y = minY; y <= maxY; y += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        this.diamond(this.floor, x, y);
        this.floor.fillPath();
        this.floor.strokePath();
      }
    }
    this.floor.lineStyle(2 * lineScale, 0xb8c0cc, 0.9);
    for (let x = 0; x <= WORLD_SIZE; x += CHUNK_SIZE) {
      const a = this.iso(x, 0);
      const b = this.iso(x, WORLD_SIZE);
      this.floor.lineBetween(a.x, a.y, b.x, b.y);
    }
    for (let y = 0; y <= WORLD_SIZE; y += CHUNK_SIZE) {
      const a = this.iso(0, y);
      const b = this.iso(WORLD_SIZE, y);
      this.floor.lineBetween(a.x, a.y, b.x, b.y);
    }
  }

  private footprint(entity: SimSnapshot["entities"][number]) {
    const collider = entity.components?.collider;
    const declared = entity.attributes.footprintWidth;
    const width = collider?.width ?? (typeof declared === "number" && declared > 0
      ? declared
      : entity.type === "object" && /tree/i.test(entity.name) ? 3 : 1);
    const height = collider?.height ?? (typeof entity.attributes.footprintHeight === "number" && entity.attributes.footprintHeight > 0
      ? entity.attributes.footprintHeight : width);
    return { width, height };
  }

  private syncEntities() {
    if (!this.snapshot || !this.add) return;
    const active = new Set<string>();
    for (const entity of this.snapshot.entities) {
      if (entity.containedIn) continue;
      active.add(entity.id);
      const size = this.footprint(entity);
      const center = this.iso(entity.position.x + size.width / 2, entity.position.y + size.height / 2);
      const foot = { x: center.x, y: center.y + size.height * TILE_HEIGHT / 2 };
      const layer = entity.components?.render?.layer === "ground" || entity.components?.render?.assetKey === "road"
        ? "ground"
        : "actor";
      let rendered = this.entities.get(entity.id);
      if (!rendered) {
        const key = entity.components?.render?.assetKey ?? (entity.type === "object" && /tree/i.test(entity.name)
          ? "tree"
          : entity.type === "building" || entity.attributes.category === "mall"
            ? "mall"
            : entity.type === "player" ? "player"
            : entity.type === "agent" ? "agent" : "fallback");
        const sprite = key === "fallback"
          ? this.add.rectangle(foot.x, foot.y, 28, 28, entity.type === "player" ? 0x5379ff : 0x9aa3b2).setOrigin(0.5, 1).setDepth(spriteDepth(foot.y, layer))
          : this.add.sprite(foot.x, foot.y, key).setOrigin(0.5, 1).setDepth(spriteDepth(foot.y, layer));
        if (sprite instanceof Phaser.GameObjects.Sprite) {
          const displayWidth = key === "tree"
            ? TILE_WIDTH * 2.8
            : key === "portal"
              ? (size.width + size.height) * (TILE_WIDTH / 2)
              : key === "mall" || key === "road" || key === "gacha"
                ? TILE_WIDTH * size.width
                : TILE_WIDTH * 0.9;
          sprite.setScale(displayWidth * (entity.components?.render?.scale ?? 1) / sprite.width);
        }
        rendered = {
          sprite,
          x: entity.position.x,
          y: entity.position.y,
          targetX: entity.position.x,
          targetY: entity.position.y,
          width: size.width,
          height: size.height,
          id: entity.id,
          layer,
        };
        this.entities.set(entity.id, rendered);
      } else {
        rendered.targetX = entity.position.x;
        rendered.targetY = entity.position.y;
        rendered.width = size.width;
        rendered.height = size.height;
        rendered.layer = layer;
        rendered.sprite.setDepth(spriteDepth(foot.y, layer));
      }
    }
    for (const [id, rendered] of this.entities) {
      if (active.has(id)) continue;
      if (rendered.dialogue) {
        this.floaters.push({
          ...rendered.dialogue,
          x: rendered.x,
          y: rendered.y,
          tilesW: rendered.width,
          tilesH: rendered.height,
        });
      }
      rendered.sprite.destroy();
      this.entities.delete(id);
    }
    for (const [id, line] of this.pendingSpeech) {
      if (!this.entities.has(id)) continue;
      this.pendingSpeech.delete(id);
      this.showDialogue(id, line.text, line.kind);
    }
  }

  private positionDialogue(x: number, y: number, tilesW: number, tilesH: number, spriteHeight: number, bubble: DialogueBubble) {
    const center = this.iso(x + tilesW / 2, y + tilesH / 2);
    const footY = center.y + tilesH * TILE_HEIGHT / 2;
    bubble.container.setPosition(center.x - bubble.width / 2, footY - spriteHeight - bubble.height - 12);
    bubble.container.setDepth(DIALOGUE_DEPTH);
  }

  private onPointerDown(pointer: Phaser.Input.Pointer) {
    this.dragging = true;
    this.dragStart = { x: pointer.x, y: pointer.y, scrollX: this.cameras.main.scrollX, scrollY: this.cameras.main.scrollY };
  }

  private onPointerUp() { this.dragging = false; }

  private onPointerMove(pointer: Phaser.Input.Pointer) {
    if (this.dragging) {
      const camera = this.cameras.main;
      camera.scrollX = this.dragStart.scrollX + (this.dragStart.x - pointer.x) / camera.zoom;
      camera.scrollY = this.dragStart.scrollY + (this.dragStart.y - pointer.y) / camera.zoom;
    }
    const tile = this.tileAt(pointer.worldX, pointer.worldY);
    const key = `${tile.x},${tile.y}`;
    if (key !== this.lastHover) {
      this.lastHover = key;
      this.hoverTile.clear();
      if (tile.x >= 0 && tile.x < WORLD_SIZE && tile.y >= 0 && tile.y < WORLD_SIZE) {
        this.hoverTile.fillStyle(0x77aaff, 0.2);
        this.diamond(this.hoverTile, tile.x, tile.y);
        this.hoverTile.fillPath();
        this.hoverTile.lineStyle(2 / this.cameras.main.zoom, 0x3d7cff, 0.9);
        this.hoverTile.strokePath();
      }
    }
    this.hoverEntity.clear();
    for (const rendered of this.entities.values()) {
      if (tile.x < rendered.x || tile.y < rendered.y || tile.x >= rendered.x + rendered.width || tile.y >= rendered.y + rendered.height) continue;
      this.hoverEntity.lineStyle(3 / this.cameras.main.zoom, 0xff8a36, 1);
      this.diamond(this.hoverEntity, rendered.x, rendered.y, rendered.width, rendered.height);
      this.hoverEntity.strokePath();
    }
  }

  private onWheel(pointer: Phaser.Input.Pointer, _gameObjects: Phaser.GameObjects.GameObject[], _deltaX: number, deltaY: number) {
    const camera = this.cameras.main;
    const before = camera.getWorldPoint(pointer.x, pointer.y);
    camera.zoom = Phaser.Math.Clamp(camera.zoom * (deltaY < 0 ? 1.1 : 0.9), MIN_ZOOM, MAX_ZOOM);
    const after = camera.getWorldPoint(pointer.x, pointer.y);
    camera.scrollX += before.x - after.x;
    camera.scrollY += before.y - after.y;
    this.onPointerMove(pointer);
  }
}

export { TownScene };
