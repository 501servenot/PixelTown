import type { Command } from "../domain/command";
import { numberAttr, type RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY, type WorldSimEvent } from "../domain/event";
import type { SimStore } from "./host";

export function executeAttack(host: SimStore, command: Command, actor: RuntimeEntity, target: RuntimeEntity): void {
  const damage = typeof command.payload?.damage === "number" ? command.payload.damage : 10;
  const damageType = String(command.payload?.damageType ?? (command.payload?.verb === "chop" ? "chop" : "kinetic"));
  applyDamage(host, target, damage, actor.id, false, damageType);
}

export function executeDestroy(host: SimStore, _command: Command, actor: RuntimeEntity, target: RuntimeEntity): void {
  applyDamage(host, target, numberAttr(target, "health", 0), actor.id, true);
}

export function applyDamage(host: SimStore, target: RuntimeEntity, damage: number, sourceId: string, destroy = false, damageType = "kinetic"): void {
  const health = Math.max(0, numberAttr(target, "health") - damage);
  target.attributes.health = health;
  if (sourceId) target.state.targetId = sourceId;
  target.version += 1;
  host.markDirty(target.id);
  host.emit({
    type: "entity_damaged",
    sourceId,
    targetId: target.id,
    depth: 0,
    priority: EVENT_PRIORITY.gameplay,
    payload: { damage, health, damageType, x: target.position.x, y: target.position.y, chunkId: target.position.chunkId },
  });
  if (destroy || health <= 0) destroyEntity(host, target, sourceId, undefined, damageType);
}

export function destroyEntity(host: SimStore, target: RuntimeEntity, sourceId: string, parent?: WorldSimEvent, damageType = "kinetic"): void {
  target.attributes.health = 0;
  target.state.status = "dead";
  target.version += 1;
  host.markDirty(target.id);
  const destroyed = host.emit({
    type: "entity_destroyed",
    sourceId,
    targetId: target.id,
    parentEventId: parent?.id,
    depth: parent ? parent.depth + 1 : 0,
    priority: EVENT_PRIORITY.gameplay,
    payload: { damageType, x: target.position.x, y: target.position.y, chunkId: target.position.chunkId },
  });
  const actor = sourceId ? host.live(sourceId) : undefined;
  host.applyEffects(target, "destroyed", destroyed, actor);
  host.removeEntity(target.id, sourceId, destroyed);
}
