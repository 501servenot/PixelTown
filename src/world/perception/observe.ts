/**
 * Observation is a read. It never mutates the world.
 * Visibility is a manhattan radius plus a 90° facing cone (or all around).
 * `said` is peeked by default; only a consumed observe drains the inbox.
 */

import {
  manhattan,
  type EntityType,
  type ObserveDirection,
  type RuntimeEntity,
  type WorldPosition,
} from "../domain/entity";
import type { SpeechLine } from "./speech";
import {
  BROADCAST_RADIUS,
  broadcastMessage,
  heardBroadcast,
  PUBLIC_BROADCASTS,
  PublicEventManager,
  type WorldBroadcast,
} from "./public-event";

export const DEFAULT_OBSERVE_RADIUS = 8;

const VERB_HINTS: Record<string, string> = {
  talk: "交谈",
  attack: "攻击",
  chop: "砍伐",
  pickup: "拾取",
  destroy: "摧毁",
};

export interface OfferedInteraction {
  type: string;
  range: number;
  inRange: boolean;
  description: string;
}

export interface ObservedEntity {
  id: string;
  version: number;
  type: EntityType;
  name: string;
  description: string;
  position: WorldPosition;
  distance: number;
  attributes: RuntimeEntity["attributes"];
  state: RuntimeEntity["state"];
  interactions: OfferedInteraction[];
}

export interface AgentObservation {
  tick: number;
  observerId: string;
  radius: number;
  direction: ObserveDirection;
  self: ObservedEntity;
  visible: ObservedEntity[];
  broadcasts: WorldBroadcast[];
  said: SpeechLine[];
}

export function inView(
  origin: Pick<WorldPosition, "x" | "y">,
  target: Pick<WorldPosition, "x" | "y">,
  radius: number,
  direction: ObserveDirection,
): boolean {
  const distance = manhattan(origin, target);
  if (distance > radius) return false;
  if (direction === "all" || distance === 0) return true;
  const dx = target.x - origin.x;
  const dy = target.y - origin.y;
  if (direction === "east") return dx >= 0 && Math.abs(dy) <= dx;
  if (direction === "west") return dx <= 0 && Math.abs(dy) <= -dx;
  if (direction === "south") return dy >= 0 && Math.abs(dx) <= dy;
  return dy <= 0 && Math.abs(dx) <= -dy;
}

/** What the target allows this actor to do. The target's interaction list is authoritative. */
export function offeredInteractions(actor: RuntimeEntity, target: RuntimeEntity): OfferedInteraction[] {
  if (!target.interaction.enabled) return [];
  const distance = manhattan(actor.position, target.position);
  return target.interaction.actions
    .filter((action) => action.targetTypes.includes(actor.type))
    .map((action) => ({
      type: action.type,
      range: target.interaction.range,
      inRange: distance <= target.interaction.range,
      description: VERB_HINTS[action.type] ?? action.type,
    }));
}

export function describeEntity(actor: RuntimeEntity, target: RuntimeEntity): ObservedEntity {
  return {
    id: target.id,
    version: target.version,
    type: target.type,
    name: target.name,
    description: target.description,
    position: { ...target.position },
    distance: manhattan(actor.position, target.position),
    attributes: { ...target.attributes },
    state: { ...target.state },
    interactions: offeredInteractions(actor, target),
  };
}

export {
  BROADCAST_RADIUS,
  broadcastMessage,
  heardBroadcast,
  PUBLIC_BROADCASTS,
  PublicEventManager,
  type WorldBroadcast,
};
