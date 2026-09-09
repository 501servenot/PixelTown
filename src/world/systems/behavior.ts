import type { Command } from "../domain/command";
import type { RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import type { SimStore } from "./host";

/**
 * Produce one autonomous command when an entity's behavior timer is due.
 * `tickRate` is measured in simulation ticks; zero disables autonomous work.
 */
export function planBehavior(entity: RuntimeEntity, tick: number): Omit<Command, "id" | "timestamp"> | undefined {
  const interval = Math.floor(entity.behavior.tickRate);
  if (interval <= 0 || tick % interval !== 0 || entity.state.status !== "alive") return undefined;
  if (entity.type === "player" || entity.type === "agent") return undefined;
  if (entity.state.activity !== "idle" && entity.state.activity !== "resting" && entity.state.activity !== "walking") return undefined;

  const actions = entity.behavior.actions.filter((action) => action.enabled).map((action) => action.type);
  const energy = typeof entity.attributes.energy === "number" ? entity.attributes.energy : undefined;
  const maxEnergy = typeof entity.attributes.maxEnergy === "number" ? entity.attributes.maxEnergy : 100;
  if (actions.includes("rest") && energy !== undefined && energy <= maxEnergy * 0.25) {
    return { actorId: entity.id, type: "rest", payload: { autonomous: true } };
  }
  if (!actions.includes("wander")) return undefined;

  // ponytail: deterministic one-cell wander; add occupancy/pathfinding when obstacles matter.
  const direction = stableDirection(entity.id, tick);
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
  actor.state.activity = "resting";
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

function stableDirection(id: string, tick: number): { dx: number; dy: number } {
  let hash = tick;
  for (let index = 0; index < id.length; index += 1) hash = (hash * 31 + id.charCodeAt(index)) | 0;
  return [
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
    { dx: 0, dy: 1 },
    { dx: 0, dy: -1 },
  ][(hash >>> 0) % 4];
}
