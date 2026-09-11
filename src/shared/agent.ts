export type { ObserveDirection } from "../world/domain/entity";
export { isFacing, isObserveDirection } from "../world/domain/entity";
export type { AgentObservation, ObservedEntity, OfferedInteraction, WorldBroadcast } from "../world/perception/observe";
export type { SpeechLine } from "../world/perception/speech";

/** Agent/玩家可提交的 Command 类型词表；服务端按此校验入口消息，再分发到对应系统执行。 */
export type AgentCommandType = "move" | "observe" | "interact" | "talk" | "attack" | "pickup" | "destroy" | "shout";

export const AGENT_COMMAND_TYPES: AgentCommandType[] = [
  "move",
  "observe",
  "interact",
  "talk",
  "attack",
  "pickup",
  "destroy",
  "shout",
];

export function isAgentCommandType(value: unknown): value is AgentCommandType {
  return typeof value === "string" && AGENT_COMMAND_TYPES.includes(value as AgentCommandType);
}
