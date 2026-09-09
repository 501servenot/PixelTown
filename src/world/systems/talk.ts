import type { Command } from "../domain/command";
import type { RuntimeEntity } from "../domain/entity";
import { EVENT_PRIORITY } from "../domain/event";
import { MAX_TALK_CHARS, type SpeechLine } from "../perception/speech";
import type { SimStore, SpeechPort } from "./host";

export function executeTalk(host: SimStore & SpeechPort, command: Command, actor: RuntimeEntity, target: RuntimeEntity): void {
  const text = String(command.payload?.text ?? "").trim();
  if (!text) {
    host.reject(command, "talk requires text");
    return;
  }
  if (text.length > MAX_TALK_CHARS) {
    host.reject(command, `talk text must be ${MAX_TALK_CHARS} characters or less`);
    return;
  }
  actor.state.activity = "talking";
  actor.state.targetId = target.id;
  actor.version += 1;
  target.state.activity = "talking";
  target.state.targetId = actor.id;
  target.version += 1;
  host.markDirty(actor.id);
  host.markDirty(target.id);
  deliverSpeech(host, actor, target, text);
  host.emit({
    type: "interaction_completed",
    sourceId: actor.id,
    targetId: target.id,
    depth: 0,
    priority: EVENT_PRIORITY.player,
    payload: { action: "talk", commandId: command.id },
  });
}

export function deliverSpeech(host: SpeechPort, actor: RuntimeEntity, target: RuntimeEntity, text: string): void {
  const line: SpeechLine = {
    id: host.nextSpeechId(),
    tick: host.tickCount,
    fromId: actor.id,
    fromName: actor.name,
    toId: target.id,
    text,
  };
  host.pushSpeech(line);
}
