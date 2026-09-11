import { heldItemOf, numberAttr, placedPosition, type RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import type { Command } from "../domain/command";
import type { SimStore } from "./host";

const MAX_CAPACITY = 8;

export function heldItem(host: SimStore, actorId: string): RuntimeEntity | undefined {
  return heldItemOf(host.liveAll(), actorId);
}

export function stashEntity(host: SimStore, item: RuntimeEntity, actor: RuntimeEntity): boolean {
  if (item.containedIn) return false;
  const capacity = Math.min(MAX_CAPACITY, Math.max(1, numberAttr(actor, "capacity", 1)));
  const carried = host.liveAll().filter((entity) => entity.containedIn === actor.id).length;
  if (carried >= capacity) return false;
  host.chunk(item.position.chunkId).remove(item.id);
  item.containedIn = actor.id;
  item.position = { ...actor.position };
  item.version += 1;
  actor.attributes.carried = carried + 1;
  actor.version += 1;
  host.markDirty(item.id);
  host.markDirty(actor.id);
  return true;
}

export function dropEntityToWorld(host: SimStore, item: RuntimeEntity, at: { x: number; y: number }): void {
  const next = placedPosition(at.x, at.y);
  const carrier = item.containedIn ? host.live(item.containedIn) : undefined;
  item.containedIn = null;
  item.position = next;
  item.components.transform.position = { ...next };
  item.version += 1;
  host.chunk(next.chunkId).add(item);
  if (carrier) {
    carrier.attributes.carried = Math.max(0, numberAttr(carrier, "carried", 1) - 1);
    carrier.version += 1;
    host.markDirty(carrier.id);
  }
  host.markDirty(item.id);
}

export function executePickup(host: SimStore, command: Command, actor: RuntimeEntity, target: RuntimeEntity): void {
  if (!stashEntity(host, target, actor)) {
    host.reject(command, `${actor.id} cannot carry ${target.id}`);
    return;
  }
  host.emit({
    type: "interaction_completed",
    sourceId: actor.id,
    targetId: target.id,
    depth: 0,
    priority: EVENT_PRIORITY.player,
    payload: { action: "pickup", commandId: command.id },
  });
}

export function relocateActor(host: SimStore, actor: RuntimeEntity, at: { x: number; y: number }): { from: ReturnType<typeof placedPosition>; next: ReturnType<typeof placedPosition> } {
  const from = { ...actor.position };
  const next = placedPosition(at.x, at.y);
  if (from.chunkId !== next.chunkId) {
    host.chunk(from.chunkId).remove(actor.id);
    actor.position = next;
    host.chunk(next.chunkId).add(actor);
  } else {
    host.chunk(from.chunkId).relocate(actor, next);
  }
  actor.components.transform.position = { ...next };
  host.lastSeen.set(actor.id, { ...next });
  for (const item of host.liveAll()) {
    if (item.containedIn !== actor.id) continue;
    item.position = { ...next };
    item.components.transform.position = { ...next };
  }
  actor.version += 1;
  host.markDirty(actor.id);
  return { from, next };
}

export function consumeHeld(host: SimStore, actor: RuntimeEntity, definitionId?: string): RuntimeEntity | undefined {
  const item = heldItem(host, actor.id);
  if (!item) return undefined;
  if (definitionId && item.definitionId !== definitionId) return undefined;
  host.removeEntity(item.id, actor.id);
  actor.attributes.carried = Math.max(0, numberAttr(actor, "carried", 1) - 1);
  actor.version += 1;
  host.markDirty(actor.id);
  return item;
}
