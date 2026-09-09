import { isAgentCommandType, isObserveDirection, type AgentCommandType, type AgentObservation, type WorldBroadcast } from "./agent";

export const WORLD_ID = "starter-town";

/** One logical cell is one drawn diamond. Client and server never use different units. */
export const TILE_WIDTH = 128;
export const TILE_HEIGHT = 64;

export type { AgentCommandType as SimCommandType, AgentObservation, ObserveDirection, WorldBroadcast } from "./agent";
export { AGENT_COMMAND_TYPES as SIM_COMMAND_TYPES, isAgentCommandType as isSimCommandType } from "./agent";

/** Player / Agent → server. Live actions go over the debug socket, not HTTP. */
export type ClientMessage =
  | {
      type: "hello";
      requestId?: string;
      apiKey: string;
      actorId?: string;
    }
  | {
      type: "observe";
      requestId?: string;
      actorId?: string;
      radius?: number;
      direction?: import("./agent").ObserveDirection;
    }
  | {
      type: "command";
      requestId?: string;
      actorId?: string;
      commandType: AgentCommandType;
      targetId?: string;
      expectedVersion?: number;
      payload?: Record<string, number | string | boolean>;
    };

/** Wire form of WorldSimulation.getSnapshot(). Extra fields on the wire are ignored. */
export interface SimSnapshot {
  tick: number;
  entityCount: number;
  chunkCount: number;
  entities: Array<{
    id: string;
    definitionId: string;
    version: number;
    type: string;
    name: string;
    description: string;
    position: { x: number; y: number; chunkId: string };
    attributes: Record<string, number | string | boolean>;
    state: { status: string; activity: string; targetId: string | null; facing?: string };
  }>;
  recentEvents: Array<{
    id: string;
    type: string;
    sourceId?: string;
    targetId?: string;
    depth: number;
    payload?: Record<string, number | string | boolean | null>;
  }>;
  rejected: Array<{ commandId: string; reason: string }>;
}

export type ServerMessage = {
  requestId?: string;
} & (
  | { type: "sim_snapshot"; payload: SimSnapshot }
  | { type: "observation"; payload: AgentObservation }
  | { type: "broadcast"; payload: WorldBroadcast }
  | { type: "command_result"; payload: { ok: boolean; commandId?: string; error?: string } }
);

export function isClientMessage(value: unknown): value is ClientMessage {
  if (!value || typeof value !== "object") return false;
  const message = value as Record<string, unknown>;
  if (message.type === "hello") {
    return typeof message.apiKey === "string" && message.apiKey.length > 0;
  }
  if (message.type === "observe") {
    return message.direction === undefined || isObserveDirection(message.direction);
  }
  if (message.type === "command") {
    return isAgentCommandType(message.commandType);
  }
  return false;
}
