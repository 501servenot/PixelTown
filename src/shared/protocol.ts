import { isAgentCommandType, isObserveDirection, type AgentCommandType, type AgentObservation, type SpeechLine, type WorldBroadcast } from "./agent";

export const WORLD_ID = "starter-town";

/** One logical cell is one drawn diamond. Client and server never use different units. */
export const TILE_WIDTH = 128;
export const TILE_HEIGHT = 64;
export const WORLD_CHUNKS = 8;
export const WORLD_SIZE = 64 * WORLD_CHUNKS;

export type { AgentCommandType as SimCommandType, AgentObservation, ObserveDirection, SpeechLine, WorldBroadcast } from "./agent";
export { AGENT_COMMAND_TYPES as SIM_COMMAND_TYPES, isAgentCommandType as isSimCommandType } from "./agent";

/** 玩家/调试客户端发往服务端的消息：hello 认证、observe 拉取感知、command 提交意图；实时操作走 /ws socket，不走 HTTP。 */
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

/** WorldSimulation.getSnapshot() 的线上传输形状：客户端画面协议的世界快照；线上多出的字段会被忽略。 */
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
    material?: string | null;
    position: { x: number; y: number; chunkId: string };
    attributes: Record<string, number | string | boolean>;
    state: { status: string; activity: string; targetId: string | null; facing?: string };
    statuses?: Array<{ name: string; remaining: number }>;
    containedIn?: string | null;
    components?: {
      transform?: { position: { x: number; y: number; chunkId: string } };
      collider?: { width: number; height: number; solid: boolean };
      render?: { assetKey: string; scale: number; anchor: "foot"; layer?: "ground" | "actor" };
    };
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

/** 服务端推给客户端的消息：世界快照、观察结果、公共广播（heard）、私聊（said）与命令回执。 */
export type ServerMessage = {
  requestId?: string;
} & (
  | { type: "sim_snapshot"; payload: SimSnapshot }
  | { type: "observation"; payload: AgentObservation }
  | { type: "broadcast"; payload: WorldBroadcast }
  | { type: "speech"; payload: SpeechLine }
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
