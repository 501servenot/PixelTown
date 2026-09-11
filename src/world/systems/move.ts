import type { Command } from "../domain/command";
import { CHUNK_SIZE, facingFromDelta, placedPosition, type RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import { relocateActor } from "./contain";
import { fireFootprintTriggers } from "./effects";
import type { SimStore } from "./host";

export function executeMove(host: SimStore, command: Command, actor: RuntimeEntity): void {
  const nextX = typeof command.payload?.x === "number" ? command.payload.x : actor.position.x + Number(command.payload?.dx ?? 0);
  const nextY = typeof command.payload?.y === "number" ? command.payload.y : actor.position.y + Number(command.payload?.dy ?? 0);
  if (!Number.isInteger(nextX) || !Number.isInteger(nextY)) {
    host.reject(command, "move target must be integer cells");
    return;
  }
  const next = placedPosition(nextX, nextY);
  const { width: actorWidth, height: actorHeight } = actor.components.collider;
  const blockedBy = host.queryNearby(next, CHUNK_SIZE).find((other) => {
    if (other.id === actor.id || other.state.status !== "alive" || !other.components.collider.solid) return false;
    // Mobile actors may share cells; solid world props (tree/building) own the collision box.
    if (actor.type !== "agent" && actor.type !== "player") return false;
    if (other.type === "agent" || other.type === "player" || other.type === "npc" || other.type === "animal") return false;
    const { width: otherWidth, height: otherHeight } = other.components.collider;
    return overlaps(next.x, next.y, actorWidth, actorHeight, other.position.x, other.position.y, otherWidth, otherHeight);
  });
  if (blockedBy) {
    host.reject(command, `blocked by ${blockedBy.name || blockedBy.id}`);
    return;
  }
  const { from } = relocateActor(host, actor, next);
  actor.state.facing = facingFromDelta(next.x - from.x, next.y - from.y, actor.state.facing);
  if (actor.type === "player" || actor.type === "agent") actor.state.activity = "walking";
  if (command.payload?.autonomous && typeof actor.attributes.energy === "number") {
    actor.attributes.energy = Math.max(0, actor.attributes.energy - 1);
  }
  host.emit({
    type: "entity_moved",
    sourceId: actor.id,
    targetId: actor.id,
    depth: 0,
    priority: command.payload?.autonomous ? EVENT_PRIORITY.ai : EVENT_PRIORITY.player,
    payload: { fromX: from.x, fromY: from.y, x: next.x, y: next.y, chunkId: next.chunkId },
  });
  fireFootprintTriggers(host, actor, from, next);
}

function overlaps(ax: number, ay: number, aw: number, ah: number, bx: number, by: number, bw: number, bh: number): boolean {
  return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}
