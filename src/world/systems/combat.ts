import type { Command } from "../domain/command";
import { numberAttr, type RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY, type WorldSimEvent } from "../domain/event";
import type { SimStore } from "./host";

export function executeAttack(host: SimStore, command: Command, actor: RuntimeEntity, target: RuntimeEntity): void {
  const damage = typeof command.payload?.damage === "number" ? command.payload.damage : 10;
  applyDamage(host, target, damage, actor.id);
}

export function executeDestroy(host: SimStore, _command: Command, actor: RuntimeEntity, target: RuntimeEntity): void {
  applyDamage(host, target, numberAttr(target, "health", 0), actor.id, true);
}

export function applyDamage(host: SimStore, target: RuntimeEntity, damage: number, sourceId: string, destroy = false): void {
  const health = Math.max(0, numberAttr(target, "health") - damage);
  target.attributes.health = health;
  target.version += 1;
  host.markDirty(target.id);
  host.emit({
    type: "entity_damaged",
    sourceId,
    targetId: target.id,
    depth: 0,
    priority: EVENT_PRIORITY.gameplay,
    payload: { damage, health, x: target.position.x, y: target.position.y, chunkId: target.position.chunkId },
  });
  if (destroy || health <= 0) destroyEntity(host, target, sourceId);
}

export function destroyEntity(host: SimStore, target: RuntimeEntity, sourceId: string, parent?: WorldSimEvent): void {
  target.attributes.health = 0;
  target.state.status = "dead";
  target.state.activity = "idle";
  target.version += 1;
  host.markDirty(target.id);
  const destroyed = host.emit({
    type: "entity_destroyed",
    sourceId,
    targetId: target.id,
    parentEventId: parent?.id,
    depth: parent ? parent.depth + 1 : 0,
    priority: EVENT_PRIORITY.gameplay,
    payload: { x: target.position.x, y: target.position.y, chunkId: target.position.chunkId },
  });
  host.applyEffects(target, "destroyed", destroyed);
  host.removeEntity(target.id, sourceId, destroyed);
}
