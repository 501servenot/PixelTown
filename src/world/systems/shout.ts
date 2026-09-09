import type { Command } from "../domain/command";
import type { RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import type { SimStore } from "./host";

export const MAX_SHOUT_CHARS = 280;

export function executeShout(host: SimStore, command: Command, actor: RuntimeEntity): void {
  const text = String(command.payload?.text ?? "").trim();
  if (!text) {
    host.reject(command, "shout requires text");
    return;
  }
  if (text.length > MAX_SHOUT_CHARS) {
    host.reject(command, `shout text must be ${MAX_SHOUT_CHARS} characters or less`);
    return;
  }
  actor.state.activity = "shouting";
  actor.state.targetId = null;
  actor.version += 1;
  host.markDirty(actor.id);
  host.emit({
    type: "entity_shouted",
    sourceId: actor.id,
    depth: 0,
    priority: EVENT_PRIORITY.player,
    payload: { text },
  });
}
