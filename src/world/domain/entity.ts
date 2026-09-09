/**
 * Entity is a description of something in the world. It never mutates the world
 * itself — only Simulation may do that.
 */

export const CHUNK_SIZE = 64;
export const SPATIAL_CELL_SIZE = 8;

export type EntityType =
  | "player"
  | "agent"
  | "npc"
  | "animal"
  | "building"
  | "item"
  | "resource"
  | "object";

export type Facing = "north" | "south" | "east" | "west";
export type ObserveDirection = Facing | "all";

export type EntityStatus = "alive" | "dead" | "disabled" | "sleeping";
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

export interface WorldPosition {
  x: number;
  y: number;
  chunkId: string;
}

export interface EntityState {
  status: EntityStatus;
  activity: EntityActivity;
  targetId: string | null;
  facing: Facing;
}

export interface BehaviorAction {
  type: string;
  enabled: boolean;
}

export interface EntityBehavior {
  tickRate: number;
  actions: BehaviorAction[];
}

export interface InteractionAction {
  type: string;
  targetTypes: EntityType[];
}

export interface EntityInteraction {
  enabled: boolean;
  range: number;
  actions: InteractionAction[];
}

export interface EntityEffect {
  trigger: string;
  type: string;
  entityType?: string;
  count?: number;
  radius?: number;
  value?: number;
}

export type EntityAttributes = Record<string, number | string | boolean>;

/** Catalog / seed JSON. `id` here is the definition id, not a live instance. */
export interface EntityDefinition {
  id: string;
  version: number;
  type: EntityType;
  name: string;
  description?: string;
  position?: WorldPosition;
  attributes: EntityAttributes;
  state: Omit<EntityState, "facing"> & { facing?: Facing };
  behavior?: EntityBehavior;
  interaction?: EntityInteraction;
  effects: EntityEffect[];
}

/** Live entity. `id` is the instance; `definitionId` points back at the catalog. */
export interface RuntimeEntity {
  id: string;
  definitionId: string;
  version: number;
  type: EntityType;
  name: string;
  description: string;
  position: WorldPosition;
  attributes: EntityAttributes;
  state: EntityState;
  behavior: EntityBehavior;
  interaction: EntityInteraction;
  effects: EntityEffect[];
}

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
  return {
    id,
    definitionId: definition.id,
    version: 1,
    type: definition.type,
    name: definition.name,
    description: definition.description ?? "",
    position: { ...position, chunkId: chunkIdAt(position.x, position.y) },
    attributes: { ...definition.attributes },
    state: {
      status: definition.state.status,
      activity: definition.state.activity,
      targetId: definition.state.targetId,
      facing: definition.state.facing ?? "east",
    },
    behavior: definition.behavior
      ? { tickRate: definition.behavior.tickRate, actions: definition.behavior.actions.map((action) => ({ ...action })) }
      : { tickRate: 1, actions: [] },
    interaction: definition.interaction
      ? {
          enabled: definition.interaction.enabled,
          range: definition.interaction.range,
          actions: definition.interaction.actions.map((action) => ({ ...action, targetTypes: [...action.targetTypes] })),
        }
      : { enabled: false, range: 0, actions: [] },
    effects: definition.effects.map((effect) => ({ ...effect })),
  };
}
