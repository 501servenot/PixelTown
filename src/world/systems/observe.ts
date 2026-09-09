import type { Command } from "../domain/command";
import { isObserver, type ObserveDirection, type RuntimeEntity } from "../domain/entity";
import { DEFAULT_OBSERVE_RADIUS, describeEntity, inView, type AgentObservation } from "../perception/observe";
import type { PublicEventManager } from "../perception/public-event";
import type { SpeechInbox } from "../perception/speech";
import type { SimStore, SimView } from "./host";

export function executeObserve(host: SimStore, command: Command, actor: RuntimeEntity): void {
  const facing = command.payload?.direction;
  if (facing === "north" || facing === "south" || facing === "east" || facing === "west") {
    actor.state.facing = facing;
  }
  actor.state.activity = "observing";
  actor.version += 1;
  host.markDirty(actor.id);
}

export function observeActor(
  host: SimView,
  speech: SpeechInbox,
  broadcasts: PublicEventManager,
  actorId: string,
  options: { radius?: number; direction?: ObserveDirection; consumeSaid?: boolean } = {},
): AgentObservation {
  const actor = host.live(actorId);
  if (!actor) throw new Error(`Unknown observer: ${actorId}`);
  if (!isObserver(actor)) throw new Error(`${actorId} is ${actor.type}, not a player or agent`);
  const radius = options.radius ?? DEFAULT_OBSERVE_RADIUS;
  const direction = options.direction ?? actor.state.facing;
  const visible = host
    .queryNearby(actor.position, radius)
    .filter((entity) => entity.id !== actor.id && inView(actor.position, entity.position, radius, direction))
    .map((entity) => describeEntity(actor, entity));
  return {
    tick: host.tickCount,
    observerId: actor.id,
    radius,
    direction,
    self: describeEntity(actor, actor),
    visible,
    broadcasts: broadcasts.heardBy(actor.position, host.tickCount),
    said: options.consumeSaid === true ? speech.take(actor.id) : speech.for(actor.id),
  };
}
