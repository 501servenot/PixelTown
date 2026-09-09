import { placedPosition, type RuntimeEntity, type WorldPosition } from "../domain/entity";
import { EVENT_PRIORITY, type WorldSimEvent } from "../domain/event";
import type { SimStore } from "./host";

export function applyEffects(host: SimStore, entity: RuntimeEntity, trigger: string, parent: WorldSimEvent): void {
  for (const effect of entity.effects) {
    if (effect.trigger !== trigger) continue;
    if (effect.type === "spawn" && effect.entityType) {
      const count = effect.count ?? 1;
      for (let i = 0; i < count; i += 1) {
        host.spawnLoot(effect.entityType, placedPosition(entity.position.x, entity.position.y), parent);
      }
    } else if (effect.type === "damage" && effect.radius && effect.value) {
      for (const nearby of host.queryNearby(entity.position, effect.radius)) {
        if (nearby.id === entity.id || nearby.state.status !== "alive") continue;
        host.applyDamage(nearby, effect.value, entity.id);
      }
    } else if (effect.type === "alert" && effect.radius) {
      alertNearby(host, entity.position, effect.radius, entity.id, parent);
    }
  }
}

export function reactToEvent(host: SimStore, event: WorldSimEvent, maxEventDepth: number): void {
  if (event.depth >= maxEventDepth) return;
  if (event.type !== "entity_damaged" && event.type !== "entity_destroyed") return;
  const origin = event.targetId ? host.live(event.targetId) : undefined;
  const position =
    origin?.position ?? (event.targetId ? host.lastSeen.get(event.targetId) : undefined) ?? positionFromPayload(event);
  if (!position) return;
  alertNearby(host, position, 4, event.sourceId ?? event.targetId, event);
}

export function alertNearby(
  host: SimStore,
  position: Pick<WorldPosition, "x" | "y">,
  radius: number,
  sourceId: string | undefined,
  parent?: WorldSimEvent,
): void {
  const depth = parent ? parent.depth + 1 : 0;
  if (depth > host.maxEventDepth) return;
  for (const nearby of host.queryNearby(position, radius)) {
    if (nearby.id === sourceId || nearby.id === parent?.targetId) continue;
    if (nearby.type !== "npc" && nearby.type !== "animal") continue;
    if (nearby.state.status !== "alive" || nearby.state.activity === "alert") continue;
    nearby.state.activity = "alert";
    nearby.state.targetId = parent?.targetId ?? sourceId ?? null;
    nearby.version += 1;
    host.markDirty(nearby.id);
    const changed = host.emit({
      type: "entity_state_changed",
      sourceId,
      targetId: nearby.id,
      parentEventId: parent?.id,
      depth,
      priority: EVENT_PRIORITY.ai,
      payload: { activity: "alert" },
    });
    host.applyEffects(nearby, "alerted", changed);
  }
}

export function positionFromPayload(event: WorldSimEvent): WorldPosition | undefined {
  const x = event.payload?.x;
  const y = event.payload?.y;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  return placedPosition(x, y);
}
