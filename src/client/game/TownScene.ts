import Phaser from "phaser";
import {
  AgentState,
  TimeSegment,
  WorldEntity,
  WorldSnapshot,
  timeSegmentForMinutes,
} from "../../shared/protocol";

const VIEW_WIDTH = 720;
const VIEW_HEIGHT = 470;
const TILE_WIDTH = 64;
const TILE_HEIGHT = 32;

// The server still owns a 22×14 logical world. The renderer exposes a larger
// chunk plane and places that logical town on the central landmass.
// ponytail: one generated ring plus infinite ocean; add streamed chunk seeds when new land is needed.
const CHUNK_SIZE = 8;
const VISUAL_WIDTH = 96;
const VISUAL_HEIGHT = 64;
const DISTRICT_OFFSET = { x: 40, y: 24 };
const MIN_ZOOM = 0.55;
const MAX_ZOOM = 3.2;

export type MarketAssetKind = "building" | "stall" | "vending" | "lantern" | "tree" | "sign" | "car";

export interface MarketAssetDefinition {
  id: string;
  kind: MarketAssetKind;
  x: number;
  y: number;
  palette?: number[];
  label?: string;
  animated?: boolean;
  /** A local key loaded in preload; swapping this key changes the pixel model. */
  textureKey?: string;
  scale?: number;
  details?: string;
  footprint?: { width: number; depth: number };
}

export const DEFAULT_MARKET_ASSETS: MarketAssetDefinition[] = [
  { id: "tower-north", kind: "building", x: 3, y: 1, textureKey: "reference-building-01", scale: 0.35, footprint: { width: 2, depth: 2 }, label: "蓝湾玻璃塔", details: "18 层玻璃幕墙 · 屋顶天线 · 独立楼体" },
  { id: "brick-east", kind: "building", x: 7, y: 2, textureKey: "reference-building-02", scale: 0.38, footprint: { width: 2, depth: 2 }, label: "红砖屋顶花园", details: "6 层办公楼 · 屋顶花园 · 可查看立面" },
  { id: "office-center", kind: "building", x: 10, y: 3, textureKey: "reference-building-03", scale: 0.42, footprint: { width: 3, depth: 2 }, label: "中央办公楼", details: "9 层办公楼 · 逐层窗灯 · 屋顶机房" },
  { id: "tower-south", kind: "building", x: 5, y: 5, textureKey: "reference-building-04", scale: 0.27, footprint: { width: 2, depth: 1 }, label: "滨水副塔", details: "12 层公寓 · 阳台绿植 · 独立楼体" },
  { id: "brick-west", kind: "building", x: 2, y: 6, textureKey: "reference-building-05", scale: 0.28, footprint: { width: 2, depth: 2 }, label: "老街公寓", details: "5 层住宅 · 露台与店面 · 独立楼体" },
  { id: "office-south", kind: "building", x: 9, y: 7, textureKey: "reference-building-06", scale: 0.28, footprint: { width: 2, depth: 2 }, label: "南岸工作室", details: "7 层工作室 · 夜间窗灯 · 独立楼体" },
  { id: "tower-harbor", kind: "building", x: 13, y: 2, textureKey: "reference-building-07", scale: 0.24, footprint: { width: 2, depth: 2 }, label: "港湾金融塔", details: "15 层玻璃幕墙 · 观景平台 · 独立楼体" },
  { id: "office-civic", kind: "building", x: 0, y: 8, textureKey: "reference-building-08", scale: 0.25, footprint: { width: 3, depth: 2 }, label: "市民中心", details: "8 层公共建筑 · 屋顶花园 · 独立楼体" },
  { id: "brick-dock", kind: "building", x: 13, y: 8, textureKey: "reference-building-02", scale: 0.24, footprint: { width: 2, depth: 2 }, label: "码头仓楼", details: "4 层仓储改造 · 临海装卸层 · 独立楼体" },
  { id: "office-skyline", kind: "building", x: 4, y: 9, textureKey: "reference-building-04", scale: 0.22, footprint: { width: 2, depth: 2 }, label: "天际线公馆", details: "10 层公寓 · 屋顶泳池 · 独立楼体" },
  { id: "tower-plaza", kind: "building", x: 8, y: 0, textureKey: "reference-building-03", scale: 0.21, footprint: { width: 2, depth: 1 }, label: "北广场塔", details: "13 层办公楼 · 空中连桥 · 独立楼体" },
  { id: "tree-plaza", kind: "tree", x: 4, y: 5, palette: [0x276d5c, 0x76c982], label: "广场绿岛" },
  { id: "tree-bridge", kind: "tree", x: 12, y: 7, palette: [0x276d5c, 0x8bd48a], label: "桥头树" },
  { id: "lantern-west", kind: "lantern", x: 4, y: 3, palette: [0xd97752, 0xffd27f], label: "西街路灯", animated: true },
  { id: "lantern-east", kind: "lantern", x: 11, y: 6, palette: [0xd97752, 0xffd27f], label: "东街路灯", animated: true },
  { id: "sign-market", kind: "sign", x: 6, y: 4, palette: [0x42b9c8, 0xf2a35f], label: "市场入口", animated: true },
  { id: "port-crane", kind: "sign", x: 14, y: 9, palette: [0xd97752, 0xf2d27c], label: "东港起重机", details: "海岸港口设施 · 可扩建码头" },
  { id: "port-light", kind: "lantern", x: 15, y: 8, palette: [0x3e6570, 0xffd27f], label: "港口信号灯", animated: true },
  { id: "car-red-1", kind: "car", x: 1, y: 3, textureKey: "reference-vehicle-09", scale: 0.14, label: "红色出租车", animated: true, details: "沿环路行驶 · 车灯与车轮可见" },
  { id: "car-red-2", kind: "car", x: 5, y: 3, textureKey: "reference-vehicle-10", scale: 0.13, label: "滨水轿车", animated: true, details: "沿环路行驶 · 独立车辆对象" },
  { id: "car-red-3", kind: "car", x: 9, y: 5, textureKey: "reference-vehicle-11", scale: 0.13, label: "东街轿车", animated: true, details: "沿环路行驶 · 独立车辆对象" },
  { id: "car-red-4", kind: "car", x: 11, y: 7, textureKey: "reference-vehicle-12", scale: 0.12, label: "桥头轿车", animated: true, details: "沿桥面行驶 · 独立车辆对象" },
];

type Layout = {
  width: number;
  height: number;
  originX: number;
  originY: number;
  worldWidth: number;
  worldHeight: number;
};

type GridPoint = { x: number; y: number };
type CityObjectKind = "building" | "vehicle" | "prop";

type CarRuntime = {
  path: GridPoint[];
  progress: number;
  speed: number;
  sprite: Phaser.GameObjects.Image;
};

type CityObject = {
  id: string;
  name: string;
  kind: CityObjectKind;
  gridX: number;
  gridY: number;
  container: Phaser.GameObjects.Container;
  zone?: Phaser.GameObjects.Zone;
  hitWidth: number;
  hitHeight: number;
  details: string;
  footprint: { width: number; depth: number };
  footprintArea: number;
  car?: CarRuntime;
};

const PHASE_STYLE: Record<TimeSegment, { overlay: number; alpha: number; background: number; glow: number; weather: number }> = {
  dawn: { overlay: 0x776d9d, alpha: 0.13, background: 0x1c2b35, glow: 0xf3a866, weather: 0.08 },
  noon: { overlay: 0x9bd8d2, alpha: 0.02, background: 0x14252d, glow: 0xffe08a, weather: 0.03 },
  dusk: { overlay: 0xb85e65, alpha: 0.2, background: 0x382c36, glow: 0xff9a62, weather: 0.16 },
  night: { overlay: 0x17244d, alpha: 0.42, background: 0x121c36, glow: 0x61c7e5, weather: 0.28 },
};

const WEATHER_SEEDS = Array.from({ length: 28 }, (_, index) => ({
  x: (index * 83) % VIEW_WIDTH,
  y: (index * 47) % VIEW_HEIGHT,
  speed: 18 + (index % 5) * 6,
}));

const PEDESTRIANS = [
  { start: 2, end: 11, lane: -1, offset: 0.1, speed: 0.08, color: 0xf29b73 },
  { start: 4, end: 12, lane: 1, offset: 0.55, speed: 0.06, color: 0x78c9d4 },
  { start: 1, end: 9, lane: 0, offset: 0.8, speed: 0.1, color: 0xe5c467 },
];

const CAR_PATH: GridPoint[] = [
  { x: 1, y: 3 },
  { x: 4, y: 3 },
  { x: 7, y: 4 },
  { x: 10, y: 5 },
  { x: 12, y: 6 },
  { x: 10, y: 8 },
  { x: 6, y: 8 },
  { x: 3, y: 6 },
];

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function makeLayout(width: number, height: number): Layout {
  const marginX = 100;
  // Buildings are taller than one tile; reserve a generous top shelf for them.
  const marginY = 216;
  const mapWidth = (width + height) * (TILE_WIDTH / 2);
  const mapHeight = (width + height) * (TILE_HEIGHT / 2);
  return {
    width,
    height,
    originX: marginX + height * (TILE_WIDTH / 2),
    originY: marginY,
    worldWidth: mapWidth + marginX * 2,
    worldHeight: mapHeight + marginY + 92,
  };
}

function polygon(graphics: Phaser.GameObjects.Graphics, points: number[][], color: number, alpha = 1): void {
  graphics.fillStyle(color, alpha);
  graphics.beginPath();
  graphics.moveTo(points[0][0], points[0][1]);
  for (const [x, y] of points.slice(1)) graphics.lineTo(x, y);
  graphics.closePath();
  graphics.fillPath();
}

function diamond(
  graphics: Phaser.GameObjects.Graphics,
  x: number,
  y: number,
  color: number,
  alpha = 1,
  width = TILE_WIDTH,
  height = TILE_HEIGHT,
): void {
  polygon(
    graphics,
    [
      [x, y - height / 2],
      [x + width / 2, y],
      [x, y + height / 2],
      [x - width / 2, y],
    ],
    color,
    alpha,
  );
  graphics.lineStyle(1, 0x263442, 0.48);
  graphics.strokePath();
}

export class TownScene extends Phaser.Scene {
  private snapshot?: WorldSnapshot;
  private layout = makeLayout(VISUAL_WIDTH, VISUAL_HEIGHT);
  private groundLayer?: Phaser.GameObjects.Graphics;
  private staticLayer?: Phaser.GameObjects.Graphics;
  private dynamicLayer?: Phaser.GameObjects.Graphics;
  private entityLayer?: Phaser.GameObjects.Graphics;
  private labelsLayer?: Phaser.GameObjects.Container;
  private lightingLayer?: Phaser.GameObjects.Graphics;
  private weatherLayer?: Phaser.GameObjects.Graphics;
  private selectionLayer?: Phaser.GameObjects.Graphics;
  private selectionPanel?: Phaser.GameObjects.Container;
  private selectionTitle?: Phaser.GameObjects.Text;
  private selectionBody?: Phaser.GameObjects.Text;
  private customAssets = DEFAULT_MARKET_ASSETS;
  private readonly objectViews = new Map<string, CityObject>();
  private readonly cars: CityObject[] = [];
  private selectedObject?: CityObject;
  private hoveredObject?: CityObject;
  private timeSegment: TimeSegment = "dawn";
  private animationClock = 0;
  private hasFitted = false;
  private dragPointer?: { x: number; y: number };

  constructor() {
    super("TownScene");
  }

  preload(): void {
    this.load.image("building-tower", "assets/tower.png");
    this.load.image("building-brick", "assets/brick.png");
    this.load.image("building-office", "assets/office.png");
    this.load.image("vehicle-car", "assets/car.png");
    for (let index = 1; index <= 8; index += 1) this.load.image(`reference-building-${String(index).padStart(2, "0")}`, `assets/reference-building-${String(index).padStart(2, "0")}.png`);
    for (let index = 9; index <= 12; index += 1) this.load.image(`reference-vehicle-${String(index).padStart(2, "0")}`, `assets/reference-vehicle-${String(index).padStart(2, "0")}.png`);
  }

  create(): void {
    this.groundLayer = this.add.graphics().setDepth(0);
    this.staticLayer = this.add.graphics().setDepth(20);
    this.entityLayer = this.add.graphics().setDepth(700);
    this.labelsLayer = this.add.container(0, 0).setDepth(760);
    this.selectionLayer = this.add.graphics().setDepth(1000);
    this.dynamicLayer = this.add.graphics().setDepth(900);
    this.lightingLayer = this.add.graphics().setDepth(950);
    this.weatherLayer = this.add.graphics().setDepth(1010);
    this.createSelectionPanel();

    this.input.on("pointerdown", this.beginPan, this);
    this.input.on("pointermove", this.movePan, this);
    this.input.on("pointerup", this.endPan, this);
    this.input.on("pointerupoutside", this.endPan, this);

    this.rebuild();
    this.setTimeOfDay(timeSegmentForMinutes(this.snapshot?.worldTime ?? 480));
    this.fitMap();
  }

  update(_time: number, delta: number): void {
    this.animationClock += delta / 1000;
    this.renderDynamic();
    this.renderLighting();
    this.renderWeather();
  }

  setSnapshot(snapshot: WorldSnapshot): void {
    const firstSnapshot = !this.snapshot;
    this.snapshot = snapshot;
    if (!this.groundLayer) return;
    this.renderEntities();
    if (firstSnapshot) this.setTimeOfDay(timeSegmentForMinutes(snapshot.worldTime));
  }

  setCustomAssets(assets: MarketAssetDefinition[]): void {
    this.customAssets = assets.length ? assets : DEFAULT_MARKET_ASSETS;
    if (this.groundLayer) this.rebuildObjects();
  }

  setTimeOfDay(segment: TimeSegment): void {
    this.timeSegment = segment;
    this.renderLighting();
    this.renderWeather();
  }

  setZoom(value: number): number {
    const zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
    this.cameras.main.setZoom(zoom);
    this.renderSelection();
    return zoom;
  }

  getZoom(): number {
    return this.cameras.main.zoom || 1;
  }

  fitMap(): number {
    const zoom = 0.72;
    const camera = this.cameras.main;
    // Ocean continues past the generated chunk ring; the camera bounds leave
    // room for future land generation without changing the scene contract.
    camera.setBounds(-10000, -10000, 20000, 20000);
    camera.setZoom(zoom);
    const focus = this.districtPoint(8, 6);
    camera.centerOn(focus.x, focus.y + 120);
    camera.setRoundPixels(true);
    this.hasFitted = true;
    this.renderSelection();
    return zoom;
  }

  getViewportInfo(): { zoom: number; visibleWidth: number; visibleHeight: number } {
    const zoom = this.getZoom();
    return {
      zoom,
      visibleWidth: Math.round(VIEW_WIDTH / (TILE_WIDTH * zoom)),
      visibleHeight: Math.round(VIEW_HEIGHT / (TILE_HEIGHT * zoom)),
    };
  }

  private point(x: number, y: number): GridPoint {
    return {
      x: this.layout.originX + (x - y) * (TILE_WIDTH / 2),
      y: this.layout.originY + (x + y) * (TILE_HEIGHT / 2),
    };
  }

  private districtPoint(x: number, y: number): GridPoint {
    return this.point(x + DISTRICT_OFFSET.x, y + DISTRICT_OFFSET.y);
  }

  private isLand(x: number, y: number): boolean {
    const dx = (x - (DISTRICT_OFFSET.x + 8)) / 16;
    const dy = (y - (DISTRICT_OFFSET.y + 5)) / 11;
    return dx * dx + dy * dy < 1 || (x >= DISTRICT_OFFSET.x + 2 && x <= DISTRICT_OFFSET.x + 15 && y >= DISTRICT_OFFSET.y + 5 && y <= DISTRICT_OFFSET.y + 12);
  }

  private rebuild(): void {
    this.layout = makeLayout(VISUAL_WIDTH, VISUAL_HEIGHT);
    this.groundLayer?.clear();
    this.staticLayer?.clear();
    this.dynamicLayer?.clear();
    this.entityLayer?.clear();
    this.labelsLayer?.removeAll(true);
    this.selectionLayer?.clear();
    this.destroyObjectViews();
    this.drawGround();
    this.rebuildObjects();
    this.renderEntities();
    this.renderDynamic();
    if (!this.hasFitted) this.fitMap();
  }

  private drawGround(): void {
    const graphics = this.groundLayer;
    if (!graphics) return;
    graphics.clear();
    for (let y = 0; y < this.layout.height; y += 1) {
      for (let x = 0; x < this.layout.width; x += 1) {
        const p = this.point(x, y);
        const localX = x - DISTRICT_OFFSET.x;
        const localY = y - DISTRICT_OFFSET.y;
        const water = !this.isLand(x, y);
        const mainRoad = localX >= 0 && localX < 18 && Math.abs(localY - Math.round(2 + localX * 0.45)) <= 0;
        const crossRoad = localX >= 6 && localX <= 7 && localY >= 2 && localY <= 12;
        const plaza = localX >= 4 && localX <= 6 && localY >= 5 && localY <= 7;
        const color = water
          ? 0x174f68
          : plaza
            ? 0x3f7669
            : mainRoad || crossRoad
              ? 0x414e58
              : (x + y) % 2
                ? 0x2d5d59
                : 0x356862;
        diamond(graphics, p.x, p.y, color);
        if (water && (x + y) % 2 === 0) {
          graphics.lineStyle(1, 0x75c7cf, 0.42);
          graphics.lineBetween(p.x - 13, p.y + 2, p.x + 11, p.y - 2);
        }
        if ((mainRoad || crossRoad) && !water && (x + y) % 2 === 0) {
          graphics.fillStyle(0xe4c07b, 0.7);
          graphics.fillRect(p.x - 4, p.y - 1, 8, 2);
        }
        if (x % CHUNK_SIZE === 0 || y % CHUNK_SIZE === 0) {
          graphics.lineStyle(1, water ? 0x2d7182 : 0x70a48b, 0.2);
          graphics.lineBetween(p.x - TILE_WIDTH / 2, p.y, p.x, p.y - TILE_HEIGHT / 2);
        }
      }
    }

    // A compact bridge and its cable towers establish the waterfront edge.
    const bridgeLeft = this.districtPoint(1, 12);
    const bridgeRight = this.districtPoint(15, 12);
    graphics.lineStyle(8, 0x27343e, 1);
    graphics.lineBetween(bridgeLeft.x, bridgeLeft.y - 3, bridgeRight.x, bridgeRight.y - 3);
    graphics.lineStyle(2, 0xf0d09a, 0.95);
    graphics.lineBetween(bridgeLeft.x, bridgeLeft.y - 8, bridgeRight.x, bridgeRight.y - 8);
    for (const ratio of [0.18, 0.38, 0.58, 0.78]) {
      const x = bridgeLeft.x + (bridgeRight.x - bridgeLeft.x) * ratio;
      const y = bridgeLeft.y + (bridgeRight.y - bridgeLeft.y) * ratio;
      graphics.fillStyle(0xcad8d1, 1);
      graphics.fillRect(x - 2, y - 26, 4, 26);
      graphics.lineStyle(1, 0xd98b67, 0.7);
      graphics.lineBetween(x, y - 24, x - 22, y - 5);
      graphics.lineBetween(x, y - 24, x + 22, y - 5);
    }
  }

  private rebuildObjects(): void {
    this.destroyObjectViews();
    const assets = this.customAssets
      .filter((asset) => asset.x >= 0 && asset.y >= 0 && asset.x < this.layout.width && asset.y < this.layout.height)
      .filter((asset) => asset.kind !== "building" || this.isLand(asset.x + DISTRICT_OFFSET.x, asset.y + DISTRICT_OFFSET.y))
      .sort((a, b) => a.x + a.y - (b.x + b.y));
    assets.forEach((asset, index) => {
      if (asset.kind === "building") this.createBuilding(asset, index);
      else if (asset.kind === "car") this.createCar(asset, index);
      else this.createProp(asset, index);
    });
    this.renderSelection();
  }

  private destroyObjectViews(): void {
    for (const object of this.objectViews.values()) {
      object.zone?.destroy();
      object.container.destroy(true);
    }
    this.objectViews.clear();
    this.cars.length = 0;
    this.selectedObject = undefined;
    this.hoveredObject = undefined;
    this.selectionPanel?.setVisible(false);
  }

  private createBuilding(asset: MarketAssetDefinition, index: number): void {
    const point = this.districtPoint(asset.x, asset.y);
    const textureKey = asset.textureKey ?? ["building-tower", "building-brick", "building-office"][index % 3];
    const visual = this.add.container(point.x, point.y).setDepth(100 + point.y);
    const shadow = this.add.graphics();
    diamond(shadow, 0, -2, 0x091923, 0.4, TILE_WIDTH * 1.9, TILE_HEIGHT * 1.15);
    visual.add(shadow);

    let width = 88;
    let height = 120;
    if (this.textures.exists(textureKey)) {
      const image = this.add.image(0, 0, textureKey).setOrigin(0.5, 1);
      const scale = asset.scale ?? 0.22;
      image.setScale(scale);
      width = image.width * scale;
      height = image.height * scale;
      visual.add(image);
    } else {
      const fallback = this.add.graphics();
      this.drawFallbackBuilding(fallback, asset, index);
      visual.add(fallback);
    }

    const object: CityObject = {
      id: asset.id,
      name: asset.label ?? asset.id,
      kind: "building",
      gridX: asset.x,
      gridY: asset.y,
      container: visual,
      hitWidth: Math.max(width * 0.92, TILE_WIDTH * 1.7),
      hitHeight: height,
      details: asset.details ?? "独立建筑对象 · 屋顶与窗户细节",
      footprint: asset.footprint ?? { width: 2, depth: 2 },
      footprintArea: (asset.footprint?.width ?? 2) * (asset.footprint?.depth ?? 2),
    };
    this.objectViews.set(object.id, object);
    this.bindObject(object);
  }

  private createCar(asset: MarketAssetDefinition, index: number): void {
    const point = this.districtPoint(asset.x, asset.y);
    const visual = this.add.container(point.x, point.y).setDepth(130 + point.y);
    const shadow = this.add.graphics();
    diamond(shadow, 0, -1, 0x08161e, 0.52, 32, 13);
    visual.add(shadow);
    const textureKey = asset.textureKey ?? "vehicle-car";
    let image: Phaser.GameObjects.Image | undefined;
    if (this.textures.exists(textureKey)) {
      image = this.add.image(0, 0, textureKey).setOrigin(0.5, 1);
      const scale = asset.scale ?? 0.2;
      image.setScale(scale);
      if (index % 3 === 1) image.setTint(0xffd46c);
      if (index % 3 === 2) image.setTint(0x8fd6e8);
      visual.add(image);
    } else {
      const fallback = this.add.graphics();
      this.drawFallbackCar(fallback, index);
      visual.add(fallback);
    }
    const width = Math.max(image?.displayWidth || 66, 66);
    const height = Math.max(image?.displayHeight || 48, 48);
    const object: CityObject = {
      id: asset.id,
      name: asset.label ?? asset.id,
      kind: "vehicle",
      gridX: asset.x,
      gridY: asset.y,
      container: visual,
      hitWidth: width * 1.05,
      hitHeight: height,
      details: asset.details ?? "独立车辆对象 · 车轮与车灯细节",
      footprint: { width: 1, depth: 0.5 },
      footprintArea: 0.5,
      car: {
        path: CAR_PATH,
        progress: (index * 1.65) % CAR_PATH.length,
        speed: 0.42 + (index % 3) * 0.06,
        sprite: image ?? this.add.image(0, 0, "vehicle-car").setVisible(false),
      },
    };
    this.objectViews.set(object.id, object);
    this.cars.push(object);
    this.bindObject(object);
    this.placeCar(object);
  }

  private createProp(asset: MarketAssetDefinition, index: number): void {
    const point = this.districtPoint(asset.x, asset.y);
    const visual = this.add.container(point.x, point.y).setDepth(150 + point.y);
    const graphics = this.add.graphics();
    this.drawProp(graphics, asset, index);
    visual.add(graphics);
    const object: CityObject = {
      id: asset.id,
      name: asset.label ?? asset.id,
      kind: "prop",
      gridX: asset.x,
      gridY: asset.y,
      container: visual,
      hitWidth: 48,
      hitHeight: 72,
      details: asset.details ?? "街景细节 · 独立可交互对象",
      footprint: asset.footprint ?? { width: 1, depth: 1 },
      footprintArea: (asset.footprint?.width ?? 1) * (asset.footprint?.depth ?? 1),
    };
    this.objectViews.set(object.id, object);
    this.bindObject(object);
  }

  private bindObject(object: CityObject): void {
    const zone = this.add
      .zone(object.container.x, object.container.y, object.hitWidth, object.hitHeight)
      .setOrigin(0.5, 1)
      .setSize(object.hitWidth, object.hitHeight)
      .setDepth(object.container.depth + 1);
    zone.setInteractive({ useHandCursor: true });
    zone.setData("cityObjectId", object.id);
    object.zone = zone;
    zone.on("pointerover", () => {
      this.hoveredObject = object;
      this.renderSelection();
    });
    zone.on("pointerout", () => {
      if (this.hoveredObject === object) this.hoveredObject = undefined;
      this.renderSelection();
    });
    zone.on(
      "pointerdown",
      (
        _pointer: Phaser.Input.Pointer,
        _localX: number,
        _localY: number,
        event: Phaser.Types.Input.EventData,
      ) => {
        event?.stopPropagation?.();
        this.selectObject(object);
      },
    );
  }

  private createSelectionPanel(): void {
    const panel = this.add.container(12, 12).setScrollFactor(0).setDepth(2000).setVisible(false);
    const background = this.add.graphics();
    background.fillStyle(0x0e1921, 0.94);
    background.fillRect(0, 0, 280, 86);
    background.lineStyle(1, 0x79cbd0, 0.9);
    background.strokeRect(0, 0, 280, 86);
    const title = this.add.text(10, 8, "", {
      color: "#ffe09a",
      fontFamily: "monospace",
      fontSize: "12px",
      fontStyle: "bold",
    });
    const body = this.add.text(10, 29, "", {
      color: "#b9d2cb",
      fontFamily: "monospace",
      fontSize: "10px",
      lineSpacing: 2,
    });
    panel.add([background, title, body]);
    this.selectionPanel = panel;
    this.selectionTitle = title;
    this.selectionBody = body;
    this.add
      .text(VIEW_WIDTH - 10, VIEW_HEIGHT - 10, "点击楼 / 车查看 · 拖拽平移 · 滚轮缩放", {
        color: "#9ab6b1",
        fontFamily: "monospace",
        fontSize: "10px",
        stroke: "#0d151c",
        strokeThickness: 3,
      })
      .setOrigin(1, 1)
      .setScrollFactor(0)
      .setDepth(2000);
  }

  private selectObject(object?: CityObject): void {
    this.selectedObject = object;
    this.selectionPanel?.setVisible(Boolean(object));
    if (object) {
      const kind = object.kind === "building" ? "楼宇" : object.kind === "vehicle" ? "车辆" : "街景";
      this.selectionTitle?.setText(`${kind}  ·  ${object.name}`);
      this.selectionBody?.setText(`${object.details}\n占地 ${object.footprint.width}×${object.footprint.depth} 格 · ${object.footprintArea} 格\n网格 (${Math.round(object.gridX)}, ${Math.round(object.gridY)}) · ${object.id}`);
    }
    this.renderSelection();
  }

  private renderSelection(): void {
    const graphics = this.selectionLayer;
    if (!graphics) return;
    graphics.clear();
    const objects = [this.selectedObject, this.hoveredObject].filter((object): object is CityObject => Boolean(object));
    for (const object of objects) {
      const selected = object === this.selectedObject;
      const color = selected ? 0xffd477 : 0x75d7ff;
      graphics.lineStyle(selected ? 2 : 1, color, selected ? 1 : 0.85);
      graphics.strokeRect(
        object.container.x - object.hitWidth / 2,
        object.container.y - object.hitHeight,
        object.hitWidth,
        object.hitHeight,
      );
      if (selected) {
        graphics.fillStyle(color, 0.07);
        graphics.fillRect(
          object.container.x - object.hitWidth / 2,
          object.container.y - object.hitHeight,
          object.hitWidth,
          object.hitHeight,
        );
      }
    }
  }

  private drawFallbackBuilding(graphics: Phaser.GameObjects.Graphics, asset: MarketAssetDefinition, index: number): void {
    const [front = 0x4d8eaa, trim = 0xd8e6dd] = asset.palette ?? [];
    const height = 92 + (index % 3) * 16;
    polygon(graphics, [[-32, -height + 12], [0, -height - 5], [32, -height + 12], [0, -height + 28]], trim);
    polygon(graphics, [[-32, -height + 12], [0, -height + 28], [0, -6], [-32, -22]], front);
    polygon(graphics, [[32, -height + 12], [0, -height + 28], [0, -6], [32, -22]], 0x315e78);
    graphics.fillStyle(0x162b38, 1);
    for (let row = 0; row < Math.max(2, Math.floor(height / 20)); row += 1) {
      for (let column = 0; column < 3; column += 1) {
        graphics.fillRect(-24 + column * 9, -height + 38 + row * 13, 5, 7);
        graphics.fillRect(7 + column * 7, -height + 38 + row * 13, 4, 7);
      }
    }
    graphics.fillStyle(trim, 1);
    graphics.fillRect(-11, -height - 18, 22, 5);
  }

  private drawFallbackCar(graphics: Phaser.GameObjects.Graphics, index: number): void {
    const body = index % 2 ? 0xd6a84e : 0xd95852;
    polygon(graphics, [[-22, -9], [-9, -20], [12, -20], [22, -9], [17, -2], [-18, -2]], body);
    polygon(graphics, [[-8, -18], [-2, -25], [10, -22], [14, -15]], 0x27485b);
    graphics.fillStyle(0xffe7a4, 1);
    graphics.fillRect(-19, -9, 4, 3);
    graphics.fillRect(15, -9, 4, 3);
    graphics.fillStyle(0x17212b, 1);
    graphics.fillRect(-14, -2, 6, 5);
    graphics.fillRect(8, -2, 6, 5);
  }

  private drawProp(graphics: Phaser.GameObjects.Graphics, asset: MarketAssetDefinition, index: number): void {
    const [dark = 0x2a7a68, light = 0x8bd48a] = asset.palette ?? [];
    if (asset.kind === "tree") {
      graphics.fillStyle(0x704c3d, 1);
      graphics.fillRect(-3, -27, 6, 22);
      graphics.fillStyle(dark, 1);
      graphics.fillRect(-14, -42, 28, 17);
      graphics.fillRect(-9, -50, 18, 10);
      graphics.fillStyle(light, 1);
      graphics.fillRect(-8, -42, 7, 7);
      graphics.fillRect(3, -46, 7, 8);
      return;
    }
    if (asset.kind === "lantern") {
      graphics.fillStyle(0x202c35, 1);
      graphics.fillRect(-1, -42, 2, 36);
      graphics.fillStyle(dark, 1);
      graphics.fillRect(-7, -40, 14, 12);
      graphics.fillStyle(light, 1);
      graphics.fillRect(-3, -37, 6, 6);
      return;
    }
    if (asset.kind === "sign") {
      const right = asset.palette?.[1] ?? 0xf2a35f;
      graphics.fillStyle(0x1b2934, 1);
      graphics.fillRect(-2, -43, 4, 38);
      graphics.fillStyle(dark, 1);
      graphics.fillRect(-17, -46, 15, 10);
      graphics.fillStyle(right, 1);
      graphics.fillRect(2, -46, 15, 10);
      graphics.fillStyle(0xfff2c2, 0.9);
      graphics.fillRect(-13, -43, 7, 3);
      graphics.fillRect(6, -43, 7, 3);
      return;
    }
    if (asset.kind === "stall") {
      graphics.fillStyle(0x2a3037, 1);
      graphics.fillRect(-18, -17, 3, 19);
      graphics.fillRect(15, -17, 3, 19);
      graphics.fillStyle(dark, 1);
      graphics.fillRect(-22, -26, 44, 10);
      graphics.fillStyle(light, 1);
      graphics.fillRect(-12, -26, 8, 5);
      graphics.fillRect(4, -26, 8, 5);
      graphics.fillStyle(0x593a34, 1);
      graphics.fillRect(-17, -13, 34, 7);
      return;
    }
    // Vending machines are deliberately tiny, but still own their own hit zone.
    graphics.fillStyle(0x17212b, 1);
    graphics.fillRect(-8, -31, 16, 25);
    graphics.fillStyle(dark, 1);
    graphics.fillRect(-6, -29, 12, 21);
    graphics.fillStyle(light, 1);
    graphics.fillRect(-4, -16, 3, 3);
    graphics.fillRect(2, -16, 3, 3);
    if (index % 2 === 0) graphics.fillStyle(0xffffff, 0.75);
  }

  private renderDynamic(): void {
    this.updateCars();
    const graphics = this.dynamicLayer;
    if (!graphics) return;
    graphics.clear();
    const pulse = 0.55 + Math.sin(this.animationClock * 3.2) * 0.25;
    const style = PHASE_STYLE[this.timeSegment];
    for (const object of this.cars) {
      const point = object.container;
      graphics.fillStyle(style.glow, 0.1 + pulse * 0.16);
      graphics.fillRect(point.x - 18, point.y - 13, 5, 3);
      graphics.fillRect(point.x + 13, point.y - 13, 5, 3);
    }
    for (const pedestrian of PEDESTRIANS) {
      const progress = (this.animationClock * pedestrian.speed + pedestrian.offset) % 1;
      const x = pedestrian.start + progress * (pedestrian.end - pedestrian.start);
      const y = Math.round(2 + x * 0.45) + pedestrian.lane;
      if (x < 0 || y < 0 || x >= this.layout.width || y >= this.layout.height) continue;
      const point = this.districtPoint(x, y);
      graphics.fillStyle(0x17212b, 0.7);
      graphics.fillRect(point.x - 4, point.y - 4, 8, 3);
      graphics.fillStyle(pedestrian.color, 1);
      graphics.fillRect(point.x - 2, point.y - 13, 4, 5);
      graphics.fillRect(point.x - 4, point.y - 8, 8, 6);
      graphics.fillStyle(0xffe0b0, 1);
      graphics.fillRect(point.x - 2, point.y - 16, 4, 4);
    }
    const agent = this.snapshot?.agents[0];
    if (agent && agent.position.x >= 0 && agent.position.y >= 0 && agent.position.x < this.layout.width && agent.position.y < this.layout.height) {
      const point = this.districtPoint(agent.position.x, agent.position.y);
      graphics.fillStyle(0x75d7ff, 0.12 + (Math.sin(this.animationClock * 4) + 1) * 0.05);
      graphics.fillRect(point.x - 16, point.y - 42, 32, 28);
    }
    if (this.selectedObject?.kind === "vehicle") {
      this.selectionBody?.setText(`${this.selectedObject.details}\n占地 ${this.selectedObject.footprint.width}×${this.selectedObject.footprint.depth} 格 · ${this.selectedObject.footprintArea} 格\n网格 (${Math.round(this.selectedObject.gridX)}, ${Math.round(this.selectedObject.gridY)}) · ${this.selectedObject.id}`);
      this.renderSelection();
    }
  }

  private updateCars(): void {
    for (const object of this.cars) {
      const car = object.car;
      if (!car) continue;
      car.progress = (car.progress + (1 / 60) * car.speed) % car.path.length;
      this.placeCar(object);
    }
  }

  private placeCar(object: CityObject): void {
    const car = object.car;
    if (!car) return;
    const segment = Math.floor(car.progress) % car.path.length;
    const next = (segment + 1) % car.path.length;
    const t = car.progress - Math.floor(car.progress);
    const a = car.path[segment];
    const b = car.path[next];
    const gridX = a.x + (b.x - a.x) * t;
    const gridY = a.y + (b.y - a.y) * t;
    const point = this.districtPoint(gridX, gridY);
    object.gridX = gridX;
    object.gridY = gridY;
    object.container.setPosition(point.x, point.y);
    object.container.setDepth(130 + point.y);
    object.zone?.setPosition(point.x, point.y).setDepth(object.container.depth + 1);
    car.sprite.setFlipX(b.x + b.y < a.x + a.y);
  }

  private renderEntities(): void {
    const graphics = this.entityLayer;
    const labels = this.labelsLayer;
    if (!graphics || !labels) return;
    graphics.clear();
    labels.removeAll(true);
    for (const entity of [...(this.snapshot?.entities ?? [])]
      .filter((item) => item.position.x >= 0 && item.position.y >= 0 && item.position.x < this.layout.width && item.position.y < this.layout.height)
      .sort((a, b) => a.position.x + a.position.y - (b.position.x + b.position.y))) {
      this.drawEntity(graphics, entity);
    }
    for (const agent of this.snapshot?.agents ?? []) {
      if (agent.position.x >= 0 && agent.position.y >= 0 && agent.position.x < this.layout.width && agent.position.y < this.layout.height) {
        this.drawAgent(graphics, agent);
      }
    }
  }

  private drawEntity(graphics: Phaser.GameObjects.Graphics, entity: WorldEntity): void {
    const point = this.districtPoint(entity.position.x, entity.position.y);
    const colors: Record<WorldEntity["kind"], number> = { landmark: 0xf1c66d, quest: 0xf07878, resource: 0x8fd694 };
    graphics.fillStyle(0x17212b, 0.95);
    graphics.fillRect(point.x - 10, point.y - 28, 20, 20);
    graphics.fillStyle(colors[entity.kind], 1);
    graphics.fillRect(point.x - 7, point.y - 25, 14, 14);
    graphics.fillStyle(0xffffff, 0.95);
    graphics.fillRect(point.x - 3, point.y - 22, 3, 3);
    graphics.fillRect(point.x + 2, point.y - 22, 3, 3);
    this.addLabel(entity.name, point.x, point.y + 6, "#f5ead3");
  }

  private drawAgent(graphics: Phaser.GameObjects.Graphics, agent: AgentState): void {
    const point = this.districtPoint(agent.position.x, agent.position.y);
    graphics.fillStyle(0x151a24, 1);
    graphics.fillRect(point.x - 10, point.y - 40, 20, 20);
    graphics.fillStyle(0x75d7ff, 1);
    graphics.fillRect(point.x - 7, point.y - 37, 14, 14);
    graphics.fillStyle(0x10212a, 1);
    graphics.fillRect(point.x - 4, point.y - 34, 3, 3);
    graphics.fillRect(point.x + 2, point.y - 34, 3, 3);
    this.addLabel(agent.name, point.x, point.y - 54, "#75d7ff");
  }

  private addLabel(text: string, x: number, y: number, color: string): void {
    const label = this.add.text(x, y, text, {
      color,
      fontFamily: "monospace",
      fontSize: "10px",
      stroke: "#101820",
      strokeThickness: 3,
    });
    label.setOrigin(0.5, 0);
    this.labelsLayer?.add(label);
  }

  private renderLighting(): void {
    const graphics = this.lightingLayer;
    if (!graphics) return;
    const style = PHASE_STYLE[this.timeSegment];
    graphics.clear();
    this.cameras.main.setBackgroundColor(style.background);
    graphics.fillStyle(style.overlay, style.alpha);
    const view = this.cameras.main.worldView;
    graphics.fillRect(view.x - view.width, view.y - view.height, view.width * 3, view.height * 3);
  }

  private renderWeather(): void {
    const graphics = this.weatherLayer;
    if (!graphics) return;
    const style = PHASE_STYLE[this.timeSegment];
    graphics.clear();
    const rain = this.timeSegment === "dusk" || this.timeSegment === "night";
    for (const seed of WEATHER_SEEDS) {
      const seedX = (seed.x / VIEW_WIDTH) * this.layout.worldWidth;
      const seedY = (seed.y / VIEW_HEIGHT) * this.layout.worldHeight;
      const y = (seedY + this.animationClock * seed.speed) % this.layout.worldHeight;
      const x = (seedX + Math.sin(this.animationClock + seed.y) * 3) % this.layout.worldWidth;
      if (rain) {
        graphics.lineStyle(1, 0x9ad9e9, style.weather);
        graphics.lineBetween(x, y, x - 4, y + 10);
      } else if (this.timeSegment === "dawn") {
        graphics.fillStyle(0xffdb91, style.weather);
        graphics.fillRect(x, y, 2, 2);
      }
    }
  }

  private beginPan(pointer: Phaser.Input.Pointer): void {
    if (pointer.button === 2) return;
    this.dragPointer = { x: pointer.x, y: pointer.y };
    this.selectObject(undefined);
  }

  private movePan(pointer: Phaser.Input.Pointer): void {
    if (!this.dragPointer || !pointer.isDown) return;
    const camera = this.cameras.main;
    camera.scrollX -= (pointer.x - this.dragPointer.x) / camera.zoom;
    camera.scrollY -= (pointer.y - this.dragPointer.y) / camera.zoom;
    this.dragPointer = { x: pointer.x, y: pointer.y };
  }

  private endPan(): void {
    this.dragPointer = undefined;
  }
}

export class TownGame {
  private readonly game: Phaser.Game;
  private zoom = 0.7;

  constructor(parent: HTMLElement) {
    this.game = new Phaser.Game({
      type: Phaser.AUTO,
      width: VIEW_WIDTH,
      height: VIEW_HEIGHT,
      backgroundColor: "#101820",
      parent,
      scene: [TownScene],
      pixelArt: true,
      antialias: false,
      roundPixels: true,
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

  setZoom(value: number): number {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    this.zoom = clamp(value, MIN_ZOOM, MAX_ZOOM);
    if (scene && this.game.scene.isActive("TownScene")) this.zoom = scene.setZoom(this.zoom);
    return this.zoom;
  }

  getZoom(): number {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    if (scene && this.game.scene.isActive("TownScene")) this.zoom = scene.getZoom();
    return this.zoom;
  }

  fitMap(): number {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    if (scene && this.game.scene.isActive("TownScene")) this.zoom = scene.fitMap();
    return this.zoom;
  }

  setTimeOfDay(segment: TimeSegment): void {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    scene?.setTimeOfDay(segment);
  }

  setCustomAssets(assets: MarketAssetDefinition[]): void {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    scene?.setCustomAssets(assets);
  }

  getViewportInfo(): { zoom: number; visibleWidth: number; visibleHeight: number } | undefined {
    const scene = this.game.scene.getScene("TownScene") as TownScene | undefined;
    return scene?.getViewportInfo();
  }

  destroy(): void {
    this.game.destroy(true);
  }
}
