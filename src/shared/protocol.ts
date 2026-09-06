export const WORLD_ID = "starter-town";
export const AGENT_ID = "agent-1";

export type Direction = "north" | "south" | "east" | "west";
export type EntityKind = "landmark" | "resource" | "quest";
export type AgentStatus = "idle" | "thinking" | "moving";
export type ActionType = "move" | "inspect" | "greet" | "gather";

export interface Position {
  x: number;
  y: number;
}

export interface WorldEntity {
  id: string;
  kind: EntityKind;
  name: string;
  position: Position;
  description: string;
  capabilities: string[];
  state: Record<string, unknown>;
}

export interface AgentState {
  id: string;
  name: string;
  position: Position;
  status: AgentStatus;
  energy: number;
  inventory: Record<string, number>;
  stateVersion: number;
}

export interface WorldEvent {
  id: string;
  type: string;
  message: string;
  worldTime: number;
  stateVersion: number;
  agentId?: string;
  entityId?: string;
}

export interface WorldSnapshot {
  worldId: string;
  name: string;
  width: number;
  height: number;
  worldTime: number;
  stateVersion: number;
  entities: WorldEntity[];
  agents: AgentState[];
  recentEvents: WorldEvent[];
}

export interface Observation {
  observationVersion: number;
  observedAt: number;
  worldId: string;
  worldTime: number;
  agent: AgentState;
  nearbyEntities: WorldEntity[];
  availableActions: ActionType[];
  recentEvents: WorldEvent[];
}

export type AgentAction =
  | { type: "move"; direction: Direction }
  | { type: "inspect"; entityId: string }
  | { type: "greet"; entityId: string }
  | { type: "gather"; entityId: string };

export interface CommandRequest {
  action: AgentAction;
  clientRequestId?: string;
  expectedStateVersion?: number;
}

export interface CommandResult {
  ok: boolean;
  stateVersion: number;
  message: string;
  action?: AgentAction;
  event?: WorldEvent;
  observation?: Observation;
  error?: string;
}

export interface AgentDecision {
  agentId: string;
  observationVersion: number;
  action: AgentAction;
  rationale: string;
}

export interface AgentTurnResult {
  observation: Observation;
  decision: AgentDecision;
  result: CommandResult;
}

export interface ServerMessage {
  type: "snapshot" | "event";
  payload: WorldSnapshot | WorldEvent;
}

export function isAgentAction(value: unknown): value is AgentAction {
  if (!value || typeof value !== "object") return false;
  const action = value as Record<string, unknown>;
  if (action.type === "move") {
    return ["north", "south", "east", "west"].includes(String(action.direction));
  }
  return ["inspect", "greet", "gather"].includes(String(action.type)) && typeof action.entityId === "string";
}

export function manhattanDistance(a: Position, b: Position): number {
  return Math.abs(a.x - b.x) + Math.abs(a.y - b.y);
}
