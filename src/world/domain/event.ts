/** 世界事件的类型词表：世界中可发生的全部事件种类。 */
export type EventType =
  | "entity_created"
  | "entity_removed"
  | "entity_moved"
  | "entity_damaged"
  | "entity_destroyed"
  | "entity_state_changed"
  | "entity_shouted"
  | "entity_emitted"
  | "interaction_completed";

export const EVENT_PRIORITY = {
  critical: 0,
  player: 1,
  gameplay: 2,
  ai: 3,
  environment: 4,
  background: 5,
} as const;

export const MAX_EVENT_DEPTH = 8;
export const MAX_EVENTS_PER_TICK = 10_000;

/** 世界事件：系统之间唯一的通信方式；带 depth 与 parentEventId 记录因果链，配合 maxEventDepth / maxEventsPerTick 防链式爆炸。 */
export interface WorldSimEvent {
  id: string;
  type: EventType;
  sourceId?: string;
  targetId?: string;
  parentEventId?: string;
  depth: number;
  priority: number;
  timestamp: number;
  durationTicks?: number;
  payload?: Record<string, number | string | boolean | null>;
}

/** 事件缓冲与调度器：按优先级和时间成批派发，单 tick 超预算的事件顺延到下一批，深度超 maxEventDepth 的直接丢弃。 */
export class EventQueue {
  private readonly current: WorldSimEvent[] = [];
  private readonly overflow: WorldSimEvent[] = [];

  get pending(): number {
    return this.current.length + this.overflow.length;
  }

  enqueue(event: WorldSimEvent, budget: number = MAX_EVENTS_PER_TICK): boolean {
    if (event.depth > MAX_EVENT_DEPTH) return false;
    if (this.current.length >= budget) {
      this.overflow.push(event);
      return false;
    }
    this.current.push(event);
    return true;
  }

  drain(budget: number = MAX_EVENTS_PER_TICK): WorldSimEvent[] {
    const batch = this.current
      .splice(0, budget)
      .sort((a, b) => a.priority - b.priority || a.timestamp - b.timestamp || a.id.localeCompare(b.id));
    if (this.overflow.length > 0 && this.current.length < budget) {
      const take = Math.min(budget - this.current.length, this.overflow.length);
      this.current.push(...this.overflow.splice(0, take));
    }
    return batch;
  }
}
