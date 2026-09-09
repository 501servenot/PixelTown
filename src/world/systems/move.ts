import type { Command } from "../domain/command";
import { facingFromDelta, placedPosition, type RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import type { SimStore } from "./host";

export function executeMove(host: SimStore, command: Command, actor: RuntimeEntity): void {
  const nextX = typeof command.payload?.x === "number" ? command.payload.x : actor.position.x + Number(command.payload?.dx ?? 0);
  const nextY = typeof command.payload?.y === "number" ? command.payload.y : actor.position.y + Number(command.payload?.dy ?? 0);
  if (!Number.isInteger(nextX) || !Number.isInteger(nextY)) {
    host.reject(command, "move target must be integer cells");
    return;
  }
  const from = { ...actor.position };
  const next = placedPosition(nextX, nextY);
  if (from.chunkId !== next.chunkId) {
    host.chunk(from.chunkId).remove(actor.id);
    actor.position = next;
    host.chunk(next.chunkId).add(actor);
  } else {
    host.chunk(from.chunkId).relocate(actor, next);
  }
  host.lastSeen.set(actor.id, { ...next });
  actor.state.facing = facingFromDelta(next.x - from.x, next.y - from.y, actor.state.facing);
  actor.state.activity = "walking";
  if (command.payload?.autonomous && typeof actor.attributes.energy === "number") {
    actor.attributes.energy = Math.max(0, actor.attributes.energy - 1);
  }
  actor.version += 1;
  host.markDirty(actor.id);
  host.emit({
    type: "entity_moved",
    sourceId: actor.id,
    targetId: actor.id,
    depth: 0,
    priority: command.payload?.autonomous ? EVENT_PRIORITY.ai : EVENT_PRIORITY.player,
    payload: { fromX: from.x, fromY: from.y, x: next.x, y: next.y, chunkId: next.chunkId },
  });
}
