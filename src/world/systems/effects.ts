import {
  hasStatus,
  heldItemOf,
  numberAttr,
  occupiesCell,
  placedPosition,
  type EffectCondition,
  type EffectOp,
  type RuntimeEntity,
  type WeightedEntry,
  type WorldPosition,
} from "../domain/entity";
import { EVENT_PRIORITY, type WorldSimEvent } from "../domain/event";
import { applyStatus, removeStatus } from "./status";
import { consumeHeld, dropEntityToWorld, heldItem, relocateActor, stashEntity } from "./contain";
import type { SimStore } from "./host";

const MAX_OPS_PER_ENTITY = 16;
const MAX_EFFECT_RADIUS = 24;

export function applyEffects(
  host: SimStore,
  entity: RuntimeEntity,
  trigger: string,
  parent: WorldSimEvent,
  actor?: RuntimeEntity,
): void {
  const matched = entity.effects.find((effect) => effect.trigger === trigger && matchesCondition(host, entity, effect.condition, parent, actor));
  if (!matched) return;
  let budget = 0;
  for (const step of matched.do) {
    budget += 1;
    if (budget > MAX_OPS_PER_ENTITY) break;
    runOp(host, entity, step, parent, actor);
  }
}

export function matchesCondition(
  host: SimStore,
  self: RuntimeEntity,
  condition: EffectCondition | undefined,
  parent: WorldSimEvent,
  actor?: RuntimeEntity,
): boolean {
  if (!condition) return true;
  if (condition.by && String(parent.payload?.damageType ?? "") !== condition.by) return false;
  if (condition.hasStatus && !hasStatus(self, condition.hasStatus)) return false;
  if (condition.activity && self.state.activity !== condition.activity) return false;
  if (condition.material && self.attributes.material !== condition.material) return false;
  if (typeof condition["health<"] === "number" && numberAttr(self, "health") >= condition["health<"]) return false;
  if (typeof condition["energy<"] === "number" && numberAttr(self, "energy") >= condition["energy<"]) return false;
  if (condition.actorHasTag && !actor?.tags.includes(condition.actorHasTag)) return false;
  if (condition.targetHasTag && !self.tags.includes(condition.targetHasTag)) return false;
  if (condition.actorIsOwner && actor && self.attributes.ownerId !== actor.id) return false;
  if (condition.actorHolds) {
    const held = actor ? heldItem(host, actor.id) : undefined;
    if (!held || held.definitionId !== condition.actorHolds) return false;
  }
  if (condition.linkAlive) {
    const linkId = typeof self.attributes.linkId === "string" ? self.attributes.linkId : "";
    const linked = linkId ? host.live(linkId) : undefined;
    if (!linked || linked.state.status !== "alive") return false;
  }
  return true;
}

function runOp(host: SimStore, self: RuntimeEntity, step: EffectOp, parent: WorldSimEvent, actor?: RuntimeEntity): void {
  if (step.op === "damage") {
    const amount = Number(step.amount ?? step.value ?? 0);
    const radius = Math.min(MAX_EFFECT_RADIUS, Number(step.radius ?? 0));
    const damageType = String(step.damageType ?? step.type ?? "kinetic");
    if (radius > 0) {
      for (const nearby of host.queryNearby(self.position, radius)) {
        if (nearby.id === self.id || nearby.state.status !== "alive") continue;
        host.applyDamage(nearby, amount, self.id, false, damageType);
      }
      return;
    }
    const target = resolveTarget(host, self, step.target, actor);
    if (target) host.applyDamage(target, amount, actor?.id ?? self.id, false, damageType);
    return;
  }
  if (step.op === "heal") {
    const target = resolveTarget(host, self, step.target, actor) ?? self;
    const amount = Number(step.amount ?? step.value ?? 0);
    const max = numberAttr(target, "maxHealth", numberAttr(target, "health"));
    target.attributes.health = Math.min(max, numberAttr(target, "health") + amount);
    target.version += 1;
    host.markDirty(target.id);
    return;
  }
  if (step.op === "status") {
    const target = resolveTarget(host, self, step.target, actor) ?? self;
    if (step.target === "remove" || step.type === "remove") {
      removeStatus(target, String(step.name ?? ""));
    } else {
      applyStatus(target, String(step.name ?? "alert"), Number(step.duration ?? 40));
    }
    target.version += 1;
    host.markDirty(target.id);
    return;
  }
  if (step.op === "transfer") {
    runTransfer(host, self, step, actor);
    return;
  }
  if (step.op === "spawn") {
    const count = Number(step.count ?? 1);
    const origin = placedPosition(self.position.x, self.position.y);
    if (step.fromTable) {
      const picked = pickWeighted(self.tables[step.fromTable] ?? [], host.tickCount, self.id);
      if (picked) host.spawnLoot(picked, origin, parent);
      return;
    }
    if (!step.entityType) return;
    for (let i = 0; i < count; i += 1) host.spawnLoot(step.entityType, origin, parent);
    return;
  }
  if (step.op === "destroy") {
    if (step.what === "actor.heldItem" && actor) consumeHeld(host, actor);
    return;
  }
  if (step.op === "emit") {
    runEmit(host, self, step, parent, actor);
    return;
  }
}

function runTransfer(host: SimStore, self: RuntimeEntity, step: EffectOp, actor?: RuntimeEntity): void {
  if (step.what === "actor" && step.to === "link" && actor) {
    const linkId = typeof self.attributes.linkId === "string" ? self.attributes.linkId : "";
    const dest = linkId ? host.live(linkId) : undefined;
    if (!dest || dest.state.status !== "alive") return;
    const exitX = dest.position.x + dest.components.collider.width;
    const exitY = dest.position.y;
    const { from, next } = relocateActor(host, actor, { x: exitX, y: exitY });
    host.emit({
      type: "entity_moved",
      sourceId: actor.id,
      targetId: actor.id,
      depth: 0,
      priority: EVENT_PRIORITY.environment,
      payload: { fromX: from.x, fromY: from.y, x: next.x, y: next.y, chunkId: next.chunkId, via: "portal" },
    });
    fireFootprintTriggers(host, actor, from, next);
    return;
  }
  if (step.what !== "actor.heldItem" || !actor) return;
  const item = heldItem(host, actor.id);
  if (!item) return;
  if (step.to === "self") {
    dropEntityToWorld(host, item, actor.position);
    stashEntity(host, item, self);
    return;
  }
  if (step.to === "world") {
    dropEntityToWorld(host, item, actor.position);
  }
}

function runEmit(host: SimStore, self: RuntimeEntity, step: EffectOp, parent: WorldSimEvent, actor?: RuntimeEntity): void {
  const text = String(step.text ?? "");
  if (!text) return;
  if (step.signal === "said") {
    const to = step.target === "actor" && actor ? actor : undefined;
    if (!to) return;
    host.pushSpeech({
      id: host.nextSpeechId(),
      tick: host.tickCount,
      fromId: self.id,
      fromName: self.name,
      toId: to.id,
      text: text.slice(0, 280),
    });
    return;
  }
  const radius = Math.min(MAX_EFFECT_RADIUS, Number(step.radius ?? 8));
  host.emit({
    type: "entity_emitted",
    sourceId: self.id,
    targetId: self.id,
    parentEventId: parent.id,
    depth: parent.depth + 1,
    priority: EVENT_PRIORITY.environment,
    durationTicks: step.signal === "alarm" ? 40 : 20,
    payload: { text, signal: step.signal ?? "sound", radius, x: self.position.x, y: self.position.y, chunkId: self.position.chunkId },
  });
}

export function reactToEvent(host: SimStore, event: WorldSimEvent, maxEventDepth: number): void {
  if (event.depth >= maxEventDepth) return;
  if (event.type === "entity_damaged" || event.type === "entity_destroyed") {
    const origin = event.targetId ? host.live(event.targetId) : undefined;
    const position =
      origin?.position ?? (event.targetId ? host.lastSeen.get(event.targetId) : undefined) ?? positionFromPayload(event);
    if (position) alertNearby(host, position, 4, event.sourceId ?? event.targetId, event);
  }
  if (event.type === "entity_damaged" && event.targetId) {
    const target = host.live(event.targetId);
    const actor = event.sourceId ? host.live(event.sourceId) : undefined;
    if (target) host.applyEffects(target, "damaged", event, actor);
  }
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
    if (nearby.state.status !== "alive") continue;
    applyStatus(nearby, "alert", 80);
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
      payload: { status: "alert" },
    });
    host.applyEffects(nearby, "status:alert", changed);
  }
}

export function fireFootprintTriggers(
  host: SimStore,
  actor: RuntimeEntity,
  from: Pick<WorldPosition, "x" | "y">,
  to: Pick<WorldPosition, "x" | "y">,
): void {
  const nearby = host.queryNearby(to, 8);
  const dummy: WorldSimEvent = {
    id: "foot",
    type: "entity_moved",
    sourceId: actor.id,
    depth: 0,
    priority: EVENT_PRIORITY.environment,
    timestamp: host.tickCount,
  };
  for (const entity of nearby) {
    if (entity.id === actor.id || entity.containedIn) continue;
    const was = occupiesCell(entity, from.x, from.y);
    const now = occupiesCell(entity, to.x, to.y);
    if (!was && now) host.applyEffects(entity, "enter", dummy, actor);
    if (was && !now) host.applyEffects(entity, "exit", dummy, actor);
  }
}

export function fireTickEffects(host: SimStore): void {
  const dummy: WorldSimEvent = {
    id: "tick",
    type: "entity_state_changed",
    depth: 0,
    priority: EVENT_PRIORITY.background,
    timestamp: host.tickCount,
  };
  for (const entity of host.liveAll()) {
    if (entity.containedIn || entity.state.status !== "alive") continue;
    for (const effect of entity.effects) {
      const match = /^tick:(\d+)$/.exec(effect.trigger);
      if (!match) continue;
      const every = Number(match[1]);
      if (every <= 0 || host.tickCount % every !== 0) continue;
      if (!matchesCondition(host, entity, effect.condition, dummy)) continue;
      host.applyEffects(entity, effect.trigger, dummy);
    }
  }
}

export function pickWeighted(rows: WeightedEntry[], tick: number, salt: string): string | undefined {
  const total = rows.reduce((sum, row) => sum + Math.max(0, row.weight), 0);
  if (total <= 0) return undefined;
  let cursor = ((tick * 31 + hashSalt(salt)) >>> 0) % total;
  for (const row of rows) {
    cursor -= Math.max(0, row.weight);
    if (cursor < 0) return row.entityType;
  }
  return rows[rows.length - 1]?.entityType;
}

function hashSalt(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 31 + value.charCodeAt(i)) | 0;
  return hash >>> 0;
}

function resolveTarget(host: SimStore, self: RuntimeEntity, target: string | undefined, actor?: RuntimeEntity): RuntimeEntity | undefined {
  if (!target || target === "self") return self;
  if (target === "actor") return actor;
  return host.live(target);
}

export function positionFromPayload(event: WorldSimEvent): WorldPosition | undefined {
  const x = event.payload?.x;
  const y = event.payload?.y;
  if (typeof x !== "number" || typeof y !== "number") return undefined;
  return placedPosition(x, y);
}

export { heldItemOf };
