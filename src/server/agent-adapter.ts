import type { AgentCommandType } from "../shared/agent";
import type {
  AgentHeardView,
  AgentIntent,
  AgentPerception,
  AgentSaidView,
  AgentSeeView,
  AgentSelfView,
  AgentTurn,
  AgentTurnLast,
} from "../shared/agent-io";
import type { AgentObservation } from "../world/perception/observe";
import type { WorldBroadcast } from "../world/perception/public-event";
import { TALK_AUDIBLE_DURATION_TICKS } from "../world/perception/speech";
import type { SpeechLine } from "../world/perception/speech";
import type { Command } from "../world/domain/command";

export function toPerception(observation: AgentObservation): AgentPerception {
  return {
    ok: true,
    tick: observation.tick,
    you: toSelf(observation),
    see: observation.visible.map(toSee),
    heard: observation.broadcasts.map(toHeard),
    said: observation.said.map(
      (item): AgentSaidView => ({
        id: item.id,
        from: item.fromId,
        name: item.fromName,
        text: item.text,
        tick: item.tick,
      }),
    ),
    canDo: ["look", "face", "move", "shout", "use"],
  };
}

export function toHeard(item: WorldBroadcast): AgentHeardView {
  return {
    id: item.id,
    tick: item.tick,
    type: item.type,
    text: item.message,
    priority: item.priority,
    startedAtTick: item.startedAtTick,
    expiresAtTick: item.expiresAtTick,
    from: item.sourceId,
    about: item.targetId ?? item.sourceId,
  };
}

/** Converts a transient nearby speech delivery into the existing heard channel. */
export function toOverheard(line: SpeechLine): AgentHeardView {
  return {
    id: line.id,
    tick: line.tick,
    type: "speech_overheard",
    text: `${line.fromName} 说道：“${line.text}”`,
    priority: 1,
    startedAtTick: line.tick,
    expiresAtTick: line.tick + TALK_AUDIBLE_DURATION_TICKS,
    from: line.fromId,
    name: line.fromName,
    about: line.fromId,
  };
}

export function toTurn(
  perception: AgentPerception,
  meta: { sessionId: string; turn: number; last?: AgentTurnLast },
): AgentTurn {
  const turn: AgentTurn = {
    type: "turn",
    turn: meta.turn,
    sessionId: meta.sessionId,
    last: meta.last,
    reply: "intent",
    ...perception,
  };
  if (perception.said.length) turn.priority = "said";
  else if (perception.heard.length) turn.priority = "heard";
  else turn.priority = "idle";
  if (meta.turn === 1) {
    turn.next = "POST the next { think?, do } to /v1/agent with the same Authorization header";
  }
  return turn;
}

export function toCommand(actorId: string, intent: AgentIntent): { kind: "look"; radius?: number; direction?: string } | { kind: "act"; command: Omit<Command, "id" | "timestamp"> } {
  if (intent.do === "look") return { kind: "look", radius: intent.radius, direction: intent.direction };
  if (intent.do === "face") {
    return { kind: "act", command: commandMeta({ actorId, type: "observe", payload: { direction: intent.direction } }, intent) };
  }
  if (intent.do === "move") {
    if (intent.to) {
      return { kind: "act", command: commandMeta({ actorId, type: "move", payload: { x: intent.to.x, y: intent.to.y } }, intent) };
    }
    return {
      kind: "act",
      command: commandMeta({ actorId, type: "move", payload: { dx: intent.by?.dx ?? 0, dy: intent.by?.dy ?? 0 } }, intent),
    };
  }
  if (intent.do === "shout") {
    return { kind: "act", command: commandMeta({ actorId, type: "shout", payload: { text: intent.text } }, intent) };
  }
  const payload: Record<string, number | string | boolean> = { verb: intent.verb };
  if (intent.damage !== undefined) payload.damage = intent.damage;
  if (intent.text !== undefined) payload.text = intent.text;
  return {
    kind: "act",
    command: commandMeta({
      actorId,
      type: "interact" satisfies AgentCommandType,
      targetId: intent.target,
      expectedVersion: typeof intent.expect === "number" ? intent.expect : undefined,
      payload,
    }, intent),
  };
}

function commandMeta(command: Omit<Command, "id" | "timestamp">, intent: AgentIntent): Omit<Command, "id" | "timestamp"> {
  const result = { ...command };
  if (intent.basedOnTick !== undefined) result.basedOnTick = intent.basedOnTick;
  if (intent.expiresAtTick !== undefined) result.expiresAtTick = intent.expiresAtTick;
  if (intent.expectSelf !== undefined) result.expectedActorVersion = intent.expectSelf;
  return result;
}

function toSelf(observation: AgentObservation): AgentSelfView {
  const you = observation.self;
  return {
    id: you.id,
    name: you.name,
    kind: you.type,
    x: you.position.x,
    y: you.position.y,
    chunk: you.position.chunkId,
    facing: you.state.facing,
    status: you.state.status,
    activity: you.state.activity,
    health: you.attributes.health,
    energy: you.attributes.energy,
    version: you.version,
  };
}

function toSee(entity: AgentObservation["visible"][number]): AgentSeeView {
  return {
    id: entity.id,
    name: entity.name,
    kind: entity.type,
    description: entity.description,
    x: entity.position.x,
    y: entity.position.y,
    distance: entity.distance,
    version: entity.version,
    status: entity.state.status,
    health: entity.attributes.health,
    youCan: entity.interactions.map((item) => ({
      verb: item.type,
      inRange: item.inRange,
      range: item.range,
      note: item.description,
    })),
  };
}
