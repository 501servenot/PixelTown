import { CHUNK_SIZE, chunkIdAt, manhattan, type WorldPosition } from "../domain/entity";
import type { Chunk } from "../state/chunk";

export interface WorldBroadcast {
  id: string;
  tick: number;
  type: string;
  sourceId?: string;
  targetId?: string;
  origin: WorldPosition;
  radius: number;
  message: string;
  priority: number;
  startedAtTick: number;
  expiresAtTick: number;
  payload?: Record<string, number | string | boolean | null>;
}

export const PUBLIC_BROADCASTS = new Set(["entity_damaged", "entity_destroyed", "entity_shouted"]);

/** Duration is expressed in simulation ticks; one tick is 50ms. */
export const PUBLIC_EVENT_DURATION_TICKS: Record<string, number> = {
  entity_damaged: 1,
  entity_destroyed: 40,
  entity_shouted: 20,
};

export const BROADCAST_RADIUS: Record<string, number> = {
  entity_damaged: 8,
  entity_destroyed: 8,
  entity_shouted: 24,
};

export function heardBroadcast(listener: Pick<WorldPosition, "x" | "y">, broadcast: WorldBroadcast): boolean {
  return manhattan(listener, broadcast.origin) <= broadcast.radius;
}

export function broadcastMessage(
  eventType: string,
  names: { source?: string; target?: string },
  payload?: Record<string, number | string | boolean | null>,
): string {
  const source = names.source ?? "某物";
  const target = names.target ?? "某物";
  if (eventType === "entity_damaged") return `${source} 对 ${target} 造成了 ${payload?.damage ?? "?"} 点伤害`;
  if (eventType === "entity_destroyed") return `${target} 被摧毁了`;
  if (eventType === "entity_shouted") return `${source} 喊道：“${payload?.text ?? ""}”`;
  if (eventType === "entity_moved") return `${source} 移动到了 (${payload?.x ?? "?"}, ${payload?.y ?? "?"})`;
  if (eventType === "entity_state_changed") return `${target} 现在是 ${payload?.activity ?? "未知状态"}`;
  if (eventType === "interaction_completed") {
    const verb = String(payload?.action ?? "交互");
    return `${source} 对 ${target} 进行了${verb}`;
  }
  if (eventType === "entity_created") return `${target} 出现了`;
  if (eventType === "entity_removed") return `${target} 离开了`;
  return `${source} 影响了 ${target}`;
}

/** Global event records with per-chunk indexes for spatial lookup. */
export class PublicEventManager {
  private readonly events = new Map<string, WorldBroadcast>();
  private readonly expiryBuckets = new Map<number, Set<string>>();
  private maxRadius = 0;
  private lastExpiredTick = 0;

  constructor(
    private readonly ensureChunk: (id: string) => Chunk,
    private readonly findChunk: (id: string) => Chunk | undefined,
  ) {}

  publish(event: WorldBroadcast): void {
    this.events.set(event.id, cloneBroadcast(event));
    this.maxRadius = Math.max(this.maxRadius, event.radius);
    const expiring = this.expiryBuckets.get(event.expiresAtTick) ?? new Set<string>();
    expiring.add(event.id);
    this.expiryBuckets.set(event.expiresAtTick, expiring);
    for (const chunkId of coveredChunks(event.origin, event.radius)) {
      this.ensureChunk(chunkId).addPublicEvent(event.id);
    }
  }

  expire(tick: number): void {
    for (let cursor = this.lastExpiredTick + 1; cursor <= tick; cursor += 1) {
      const ids = this.expiryBuckets.get(cursor);
      if (!ids) continue;
      this.expiryBuckets.delete(cursor);
      for (const id of ids) {
        const event = this.events.get(id);
        if (event && event.expiresAtTick <= tick) this.remove(event.id, event);
      }
    }
    this.lastExpiredTick = Math.max(this.lastExpiredTick, tick);
  }

  heardBy(position: Pick<WorldPosition, "x" | "y">, tick: number): WorldBroadcast[] {
    const result: WorldBroadcast[] = [];
    const seen = new Set<string>();
    // ponytail: scan chunks within the largest event radius; add a radius-bucket index if huge events dominate.
    for (const chunkId of coveredChunks(position, this.maxRadius)) {
      const chunk = this.findChunk(chunkId);
      if (!chunk) continue;
      for (const eventId of chunk.publicEvents()) {
        if (seen.has(eventId)) continue;
        const event = this.events.get(eventId);
        if (!event || event.expiresAtTick <= tick || !heardBroadcast(position, event)) continue;
        seen.add(eventId);
        result.push(cloneBroadcast(event));
      }
    }
    return result.sort((a, b) => a.tick - b.tick || a.id.localeCompare(b.id));
  }

  recent(): WorldBroadcast[] {
    return [...this.events.values()].map(cloneBroadcast);
  }

  private remove(id: string, event: WorldBroadcast): void {
    this.events.delete(id);
    for (const chunkId of coveredChunks(event.origin, event.radius)) {
      this.findChunk(chunkId)?.removePublicEvent(id);
    }
  }
}

function coveredChunks(origin: Pick<WorldPosition, "x" | "y">, radius: number): string[] {
  const minX = Math.floor((origin.x - radius) / CHUNK_SIZE);
  const maxX = Math.floor((origin.x + radius) / CHUNK_SIZE);
  const minY = Math.floor((origin.y - radius) / CHUNK_SIZE);
  const maxY = Math.floor((origin.y + radius) / CHUNK_SIZE);
  const ids: string[] = [];
  for (let x = minX; x <= maxX; x += 1) {
    for (let y = minY; y <= maxY; y += 1) ids.push(chunkIdAt(x * CHUNK_SIZE, y * CHUNK_SIZE));
  }
  return ids;
}

function cloneBroadcast(event: WorldBroadcast): WorldBroadcast {
  return {
    ...event,
    origin: { ...event.origin },
    payload: event.payload ? { ...event.payload } : undefined,
  };
}
