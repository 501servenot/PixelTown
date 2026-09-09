import type { ObserveDirection } from "./agent";

/** What an external Agent sends. The gateway translates this into world commands. */
export type AgentIntent = {
  basedOnTick?: number;
  expiresAtTick?: number;
  expectSelf?: number;
} & (
  | { do: "look"; radius?: number; direction?: ObserveDirection }
  | { do: "face"; direction: Exclude<ObserveDirection, "all"> }
  | { do: "move"; to?: { x: number; y: number }; by?: { dx: number; dy: number } }
  | { do: "shout"; text: string }
  | { do: "use"; target: string; verb: string; text?: string; expect?: number; damage?: number }
);

export interface AgentSelfView {
  id: string;
  name: string;
  kind: string;
  x: number;
  y: number;
  chunk: string;
  facing: string;
  status: string;
  activity: string;
  health?: number | string | boolean;
  energy?: number | string | boolean;
  version: number;
}

export interface AgentSeeView {
  id: string;
  name: string;
  kind: string;
  description: string;
  x: number;
  y: number;
  distance: number;
  version: number;
  status: string;
  health?: number | string | boolean;
  youCan: Array<{ verb: string; inRange: boolean; range: number; note: string }>;
}

export interface AgentHeardView {
  id: string;
  tick: number;
  type: string;
  text: string;
  priority: number;
  startedAtTick: number;
  expiresAtTick: number;
  about?: string;
  count?: number;
}

export interface AgentHeardBatch {
  type: "heard_batch";
  tick: number;
  items: AgentHeardView[];
}

export interface AgentSaidView {
  id: string;
  from: string;
  name: string;
  text: string;
  tick: number;
}

/** What an external Agent receives. Keep this small enough for an LLM context. */
export interface AgentPerception {
  ok: true;
  tick: number;
  you: AgentSelfView;
  see: AgentSeeView[];
  heard: AgentHeardView[];
  said: AgentSaidView[];
  canDo: Array<"look" | "face" | "move" | "shout" | "use">;
}

export interface AgentIntentResult {
  ok: boolean;
  accepted?: boolean;
  commandId?: string;
  error?: string;
  rejected?: string;
  perception?: AgentPerception;
}

export interface AgentTurnLast {
  accepted: boolean;
  commandId?: string;
  rejected?: string;
}

/** One think-act cycle from the world. The Agent replies with parseable JSON only. */
export interface AgentTurn extends AgentPerception {
  type: "turn";
  turn: number;
  sessionId: string;
  last?: AgentTurnLast;
  reply: "intent";
  next?: string;
  priority?: "said" | "heard" | "idle";
}

export interface AgentSessionHello {
  type: "session";
  sessionId: string;
  actorId: string;
  token?: string;
  schema: typeof AGENT_REPLY_SCHEMA;
  turn: AgentTurn;
}

/** Plug this into structured-output / json_schema. The world only accepts this shape. */
export const AGENT_REPLY_SCHEMA = {
  $id: "pixeltown.agent.reply",
  title: "PixelTown Agent reply",
  type: "object",
  required: ["do"],
  additionalProperties: false,
  properties: {
    think: { type: "string", description: "Optional reasoning. The world ignores this." },
    do: { type: "string", enum: ["look", "face", "move", "shout", "use"] },
    basedOnTick: { type: "integer", minimum: 0 },
    expiresAtTick: { type: "integer", minimum: 0 },
    expectSelf: { type: "integer", minimum: 0 },
    radius: { type: "integer", minimum: 1 },
    direction: { type: "string", enum: ["north", "south", "east", "west", "all"] },
    to: {
      type: "object",
      additionalProperties: false,
      required: ["x", "y"],
      properties: { x: { type: "integer" }, y: { type: "integer" } },
    },
    by: {
      type: "object",
      additionalProperties: false,
      required: ["dx", "dy"],
      properties: { dx: { type: "integer" }, dy: { type: "integer" } },
    },
    target: { type: "string" },
    verb: { type: "string" },
    expect: { type: "integer" },
    damage: { type: "number" },
    text: { type: "string", maxLength: 280, description: "Required for talk or shout; shout is public within range." },
  },
} as const;

export function isAgentIntent(value: unknown): value is AgentIntent {
  if (!value || typeof value !== "object") return false;
  const intent = value as Record<string, unknown>;
  if (intent.basedOnTick !== undefined && (!Number.isInteger(intent.basedOnTick) || Number(intent.basedOnTick) < 0)) return false;
  if (intent.expiresAtTick !== undefined && (!Number.isInteger(intent.expiresAtTick) || Number(intent.expiresAtTick) < 0)) return false;
  if (intent.expectSelf !== undefined && (!Number.isInteger(intent.expectSelf) || Number(intent.expectSelf) < 0)) return false;
  if (intent.do === "look") return true;
  if (intent.do === "face") {
    return intent.direction === "north" || intent.direction === "south" || intent.direction === "east" || intent.direction === "west";
  }
  if (intent.do === "move") {
    return Boolean(intent.to) || Boolean(intent.by);
  }
  if (intent.do === "shout") {
    return typeof intent.text === "string" && intent.text.trim().length > 0;
  }
  if (intent.do === "use") {
    if (typeof intent.target !== "string" || typeof intent.verb !== "string") return false;
    if (intent.verb === "talk") return typeof intent.text === "string" && intent.text.trim().length > 0;
    return true;
  }
  return false;
}

/** Accepts raw JSON, fenced markdown, or { think, do }. Only `do` is executed. */
export function parseAgentReply(value: unknown): { think?: string; intent: AgentIntent } | undefined {
  const obj = coerceObject(value);
  if (!obj) return undefined;
  const think = typeof obj.think === "string" ? obj.think : undefined;
  if (isAgentIntent(obj.intent)) return { think, intent: obj.intent };
  const { think: _think, intent: _intent, apiKey: _apiKey, token: _token, hello: _hello, type: _type, ...rest } = obj;
  if (isAgentIntent(rest)) return { think, intent: rest };
  return undefined;
}

function coerceObject(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === "string") {
    const trimmed = value.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    try {
      return coerceObject(JSON.parse(trimmed));
    } catch {
      return undefined;
    }
  }
  if (value && typeof value === "object") return value as Record<string, unknown>;
  return undefined;
}
