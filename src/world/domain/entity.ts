import type { EntityComponents, ColliderComponent, RenderComponent } from "./components";

/**
 * Entity is a description of something in the world. It never mutates the world
 * itself — only Simulation may do that.
 */

export const CHUNK_SIZE = 64;
export const SPATIAL_CELL_SIZE = 8;

/** 实体的粗分类词表；只决定权限与感知角色（谁能观察、谁能交互），行为由配方里的 behavior/effects 描述。 */
export type EntityType =
  | "player"
  | "agent"
  | "npc"
  | "animal"
  | "building"
  | "item"
  | "resource"
  | "object";

/** 四方向朝向词表；视野锥与客户端渲染共用的方向。 */
export type Facing = "north" | "south" | "east" | "west";
/** 观察方向：四个朝向之一，或 all 表示全向；observe 拉取感知时的视野参数。 */
export type ObserveDirection = Facing | "all";

/** 实体生命状态词表；非 alive 的实体不能执行 Command，也不参与多数系统。 */
export type EntityStatus = "alive" | "dead" | "disabled" | "sleeping";
/** 实体当前活动词表；玩家/Agent 的 activity 由 command 写入，NPC 的自主 activity 由 behavior 写入。 */
export type EntityActivity =
  | "idle"
  | "walking"
  | "talking"
  | "shouting"
  | "attacking"
  | "working"
  | "eating"
  | "resting"
  | "alert"
  | "observing";

/** 世界坐标：格子 x/y 加所属 chunkId（chunk 为 64×64 格的空间分区）。 */
export interface WorldPosition {
  x: number;
  y: number;
  chunkId: string;
}

/** 实体的可变状态：生命状态、当前活动、目标与朝向；各系统运行时的主要读写对象。 */
export interface EntityState {
  status: EntityStatus;
  activity: EntityActivity;
  targetId: string | null;
  facing: Facing;
}

/** effect/behavior 规则的条件键集合（by/hasStatus/health< 等）；匹配器只做相等与阈值判断，无计算能力。 */
export interface EffectCondition {
  by?: string;
  actorHasTag?: string;
  targetHasTag?: string;
  actorHolds?: string;
  actorIsOwner?: boolean;
  hasStatus?: string;
  "health<"?: number;
  "energy<"?: number;
  activity?: string;
  material?: string;
  linkAlive?: boolean;
}

/** effect 引擎执行的一条原语调用（damage/heal/status/transfer/spawn/destroy/emit 等）；op 字段决定分支，其余字段是参数。 */
export interface EffectOp {
  op: string;
  type?: string;
  damageType?: string;
  amount?: number;
  value?: number;
  name?: string;
  target?: string;
  duration?: number;
  what?: string;
  to?: string;
  entityType?: string;
  count?: number;
  fromTable?: string;
  radius?: number;
  signal?: string;
  text?: string;
  into?: string;
}

/** 加权随机表的一行：配方 ID 与权重；spawn 原语的 fromTable 用它做服务端权威摇号。 */
export interface WeightedEntry {
  entityType: string;
  weight: number;
}

/** 挂在实体上的一个计时状态（如 alert）：名称加剩余 tick 数，status 系统逐 tick 递减直至过期。 */
export interface StatusInstance {
  name: string;
  remaining: number;
}

/** NPC 自主行为的一项：动作类型、启用开关与可选触发条件。 */
export interface BehaviorAction {
  type: string;
  enabled: boolean;
  condition?: EffectCondition;
}

/** NPC 的自主行为配置：tickRate 决定每 N tick 思考一次，actions 按优先级排列；产出的 Command 与玩家走同一管道。 */
export interface EntityBehavior {
  tickRate: number;
  actions: BehaviorAction[];
}

/** 实体声明可接受的一种交互动词，以及允许发起它的实体类型（targetTypes）。 */
export interface InteractionAction {
  type: string;
  targetTypes: EntityType[];
}

/** 实体的交互声明：开关、距离与可接受动词列表；只声明"可以发起"，发起后发生什么由 effects 决定。 */
export interface EntityInteraction {
  enabled: boolean;
  range: number;
  actions: InteractionAction[];
}

/** 一条事件反应规则：trigger 命中且 condition 满足后，由 effect 引擎按序执行 do 里的原语；同 trigger 多条规则只取第一条条件满足者。 */
export interface EntityEffect {
  trigger: string;
  condition?: EffectCondition;
  do: EffectOp[];
}

/** 实体的开放属性表（health/speed/vision 等）；各系统按需读取并自行钳制，配方也可放供 condition 引用的惰性数据。 */
export type EntityAttributes = Record<string, number | string | boolean>;

/** 实体配方：entities/*.json 里一份实体定义的形状；id 是配方 ID 而非实例 ID，实例化后成为 RuntimeEntity。 */
export interface EntityDefinition {
  id: string;
  version: number;
  type: EntityType;
  name: string;
  description?: string;
  material?: string;
  position?: WorldPosition;
  attributes: EntityAttributes;
  state: Omit<EntityState, "facing"> & { facing?: Facing };
  behavior?: EntityBehavior;
  interaction?: EntityInteraction;
  effects: EntityEffect[];
  tags?: string[];
  tables?: Record<string, WeightedEntry[]>;
  collider?: ColliderComponent;
  render?: RenderComponent;
}

/** 去掉位置的配方模板：可复用于在任意坐标实例化；运行时坐标属于实例。 */
export type EntityArchetype = Omit<EntityDefinition, "position">;

/** 世界中的活实体：配方实例化后的运行时对象；id 是实例 ID，definitionId 指回配方目录里的定义。 */
export interface RuntimeEntity {
  id: string;
  definitionId: string;
  version: number;
  type: EntityType;
  name: string;
  description: string;
  material: string | null;
  position: WorldPosition;
  attributes: EntityAttributes;
  state: EntityState;
  behavior: EntityBehavior;
  interaction: EntityInteraction;
  effects: EntityEffect[];
  tags: string[];
  tables: Record<string, WeightedEntry[]>;
  statuses: StatusInstance[];
  containedIn: string | null;
  /** Explicit components derived from the archetype; legacy fields remain for compatibility. */
  components: EntityComponents;
}

/** RuntimeEntity 的别名：内容生成与持久化代码使用的名字。 */
export type EntityInstance = RuntimeEntity;

export function chunkIdAt(x: number, y: number): string {
  return `chunk_${Math.floor(x / CHUNK_SIZE)}_${Math.floor(y / CHUNK_SIZE)}`;
}

export function parseChunkId(chunkId: string): { cx: number; cy: number } {
  const match = /^chunk_(-?\d+)_(-?\d+)$/.exec(chunkId);
  if (!match) throw new Error(`Invalid chunkId: ${chunkId}`);
  return { cx: Number(match[1]), cy: Number(match[2]) };
}

export function placedPosition(x: number, y: number): WorldPosition {
  return { x, y, chunkId: chunkIdAt(x, y) };
}

export function manhattan(a: Pick<WorldPosition, "x" | "y">, b: Pick<WorldPosition, "x" | "y">): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}

export function isObserver(entity: Pick<RuntimeEntity, "type">): boolean {
  return entity.type === "player" || entity.type === "agent";
}

export function facingFromDelta(dx: number, dy: number, fallback: Facing = "east"): Facing {
  if (dx === 0 && dy === 0) return fallback;
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "east" : "west";
  return dy > 0 ? "south" : "north";
}

export function isFacing(value: unknown): value is Facing {
  return value === "north" || value === "south" || value === "east" || value === "west";
}

export function isObserveDirection(value: unknown): value is ObserveDirection {
  return isFacing(value) || value === "all";
}

export function numberAttr(entity: RuntimeEntity, key: string, fallback = 0): number {
  const value = entity.attributes[key];
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function cloneEntity(entity: RuntimeEntity): RuntimeEntity {
  return structuredClone(entity);
}

export function instantiate(definition: EntityDefinition, id: string, position: WorldPosition): RuntimeEntity {
  const placed = { ...position, chunkId: chunkIdAt(position.x, position.y) };
  const collider = definition.collider ?? defaultCollider(definition);
  const render = definition.render ?? defaultRender(definition);
  return {
    id,
    definitionId: definition.id,
    version: 1,
    type: definition.type,
    name: definition.name,
    description: definition.description ?? "",
    material: definition.material ?? null,
    position: placed,
    attributes: stampHome(
      {
        ...definition.attributes,
        ...(definition.material && definition.attributes.material === undefined ? { material: definition.material } : {}),
      },
      placed,
    ),
    state: {
      status: definition.state.status,
      activity: definition.state.activity,
      targetId: definition.state.targetId,
      facing: definition.state.facing ?? "east",
    },
    behavior: definition.behavior
      ? {
          tickRate: definition.behavior.tickRate,
          actions: definition.behavior.actions.map((action) => ({ ...action, condition: action.condition ? { ...action.condition } : undefined })),
        }
      : { tickRate: 1, actions: [] },
    interaction: definition.interaction
      ? {
          enabled: definition.interaction.enabled,
          range: definition.interaction.range,
          actions: definition.interaction.actions.map((action) => ({ ...action, targetTypes: [...action.targetTypes] })),
        }
      : { enabled: false, range: 0, actions: [] },
    effects: (definition.effects ?? []).map((effect) => ({
      trigger: effect.trigger,
      condition: effect.condition ? { ...effect.condition } : undefined,
      do: (effect.do ?? []).map((step) => ({ ...step })),
    })),
    tags: [...(definition.tags ?? [])],
    tables: Object.fromEntries(
      Object.entries(definition.tables ?? {}).map(([name, rows]) => [name, rows.map((row) => ({ ...row }))]),
    ),
    statuses: [],
    containedIn: null,
    components: {
      transform: { position: { ...placed } },
      collider: { ...collider },
      render: { ...render },
    },
  };
}

function stampHome(attributes: EntityAttributes, placed: WorldPosition): EntityAttributes {
  if (typeof attributes.wanderRadius !== "number" || attributes.homeX !== undefined) return attributes;
  return { ...attributes, homeX: placed.x, homeY: placed.y };
}

function defaultCollider(definition: EntityDefinition): ColliderComponent {
  const width = typeof definition.attributes.footprintWidth === "number" && definition.attributes.footprintWidth > 0
    ? definition.attributes.footprintWidth
    : 1;
  const height = typeof definition.attributes.footprintHeight === "number" && definition.attributes.footprintHeight > 0
    ? definition.attributes.footprintHeight
    : width;
  return { width, height, solid: definition.attributes.collision !== false };
}

function defaultRender(definition: EntityDefinition): RenderComponent {
  const assetKey = definition.render?.assetKey
    ?? (definition.type === "player" ? "player"
      : definition.type === "agent" ? "agent"
        : "fallback");
  return {
    assetKey,
    scale: definition.render?.scale ?? 1,
    anchor: "foot",
    ...(definition.render?.layer ? { layer: definition.render.layer } : {}),
  };
}

export function occupiesCell(entity: RuntimeEntity, x: number, y: number): boolean {
  const { width, height } = entity.components.collider;
  return x >= entity.position.x && x < entity.position.x + width && y >= entity.position.y && y < entity.position.y + height;
}

export function hasStatus(entity: RuntimeEntity, name: string): boolean {
  return entity.statuses.some((item) => item.name === name && item.remaining > 0);
}

export function heldItemOf(entities: Iterable<RuntimeEntity>, actorId: string): RuntimeEntity | undefined {
  for (const entity of entities) {
    if (entity.containedIn === actorId) return entity;
  }
  return undefined;
}
