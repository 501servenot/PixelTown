import type { Command } from "../domain/command";
import { hasStatus, numberAttr, type RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import { matchesCondition } from "./effects";
import type { SimStore, SimView } from "./host";

/**
 * Produce one autonomous command when an entity's behavior timer is due.
 * Player / Agent activity is written by command systems; NPC activity is written here.
 */
export function planBehavior(entity: RuntimeEntity, tick: number, view?: SimView): Omit<Command, "id" | "timestamp"> | undefined {
  const interval = Math.floor(entity.behavior.tickRate);
  if (interval <= 0 || tick % interval !== 0 || entity.state.status !== "alive") return undefined;
  if (entity.type === "player" || entity.type === "agent") return undefined;
  if (entity.containedIn) return undefined;

  const dummy = {
    id: "behavior",
    type: "entity_state_changed" as const,
    depth: 0,
    priority: EVENT_PRIORITY.ai,
    timestamp: tick,
  };
  const enabled = entity.behavior.actions.filter((action) => {
    if (!action.enabled) return false;
    if (!action.condition) return true;
    if (!view) return false;
    return matchesCondition(view as SimStore, entity, action.condition, dummy);
  });
  const types = enabled.map((action) => action.type);
  const energy = typeof entity.attributes.energy === "number" ? entity.attributes.energy : undefined;
  const maxEnergy = typeof entity.attributes.maxEnergy === "number" ? entity.attributes.maxEnergy : 100;
  if (types.includes("rest") && energy !== undefined && energy <= maxEnergy * 0.25) {
    return { actorId: entity.id, type: "rest", payload: { autonomous: true } };
  }
  if (types.includes("chase") && hasStatus(entity, "alert") && entity.state.targetId && view) {
    const target = view.live(entity.state.targetId);
    if (target && !target.containedIn) {
      const step = stepToward(entity.position.x, entity.position.y, target.position.x, target.position.y);
      if (step.dx !== 0 || step.dy !== 0) {
        return { actorId: entity.id, type: "move", payload: { ...step, autonomous: true } };
      }
    }
  }
  if (!types.includes("wander")) return undefined;
  const direction = wanderStep(entity, tick);
  if (!direction || (direction.dx === 0 && direction.dy === 0)) return undefined;
  return {
    actorId: entity.id,
    type: "move",
    payload: { dx: direction.dx, dy: direction.dy, autonomous: true },
  };
}

export function executeRest(host: SimStore, command: Command, actor: RuntimeEntity): void {
  const maxEnergy = typeof actor.attributes.maxEnergy === "number" ? actor.attributes.maxEnergy : 100;
  const energy = typeof actor.attributes.energy === "number" ? actor.attributes.energy : maxEnergy;
  actor.attributes.energy = Math.min(maxEnergy, energy + 5);
  if (actor.type === "player" || actor.type === "agent" || command.payload?.autonomous) {
    actor.state.activity = "resting";
  }
  actor.version += 1;
  host.markDirty(actor.id);
  host.emit({
    type: "entity_state_changed",
    sourceId: actor.id,
    targetId: actor.id,
    depth: 0,
    priority: command.payload?.autonomous ? EVENT_PRIORITY.ai : EVENT_PRIORITY.player,
    payload: { activity: "resting", energy: actor.attributes.energy },
  });
}

function wanderStep(entity: RuntimeEntity, tick: number): { dx: number; dy: number } | undefined {
  const radius = numberAttr(entity, "wanderRadius", 0);
  const homeX = entity.attributes.homeX;
  const homeY = entity.attributes.homeY;
  const hasHome = radius > 0 && typeof homeX === "number" && typeof homeY === "number";
  if (hasHome) {
    const away = Math.abs(entity.position.x - homeX) + Math.abs(entity.position.y - homeY);
    if (away > radius) return stepToward(entity.position.x, entity.position.y, homeX, homeY);
  }

  const heading = wanderHeading(entity, tick);
  if (!heading) return undefined;
  if (hasHome) {
    const nextAway = Math.abs(entity.position.x + heading.dx - homeX) + Math.abs(entity.position.y + heading.dy - homeY);
    if (nextAway > radius) return undefined;
  }
  return heading;
}

function wanderHeading(entity: RuntimeEntity, tick: number): { dx: number; dy: number } | undefined {
  const interval = Math.max(1, Math.floor(entity.behavior.tickRate));
  const steps = Math.max(0, Math.floor(numberAttr(entity, "wanderSteps", 0)));
  const pause = Math.max(0, Math.floor(numberAttr(entity, "wanderPause", 0)));
  if (steps <= 0 || pause <= 0) return stableDirection(entity.id, tick);

  const pauseSlots = Math.max(1, Math.ceil(pause / interval));
  const cycleSlots = steps + pauseSlots;
  const think = Math.floor(tick / interval);
  const index = Math.max(0, think - 1);
  const phase = index % cycleSlots;
  if (phase >= steps) return undefined;
  return stableDirection(entity.id, Math.floor(index / cycleSlots));
}

function stepToward(fromX: number, fromY: number, toX: number, toY: number): { dx: number; dy: number } {
  const dx = Math.sign(toX - fromX);
  const dy = Math.sign(toY - fromY);
  if (dx === 0 && dy === 0) return { dx: 0, dy: 0 };
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

/** Mix id+tick then avalanche so tickRate multiples of 4 do not lock one compass point. */
function stableDirection(id: string, tick: number): { dx: number; dy: number } {
  let hash = tick | 0;
  for (let index = 0; index < id.length; index += 1) {
    hash = Math.imul(hash ^ id.charCodeAt(index), 0x9e3779b9);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x7feb352d);
  hash ^= hash >>> 15;
  return [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ][(hash >>> 0) % 4];
}
