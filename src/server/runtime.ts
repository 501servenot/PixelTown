import {
  AGENT_ID,
  AgentAction,
  AgentState,
  AgentTurnResult,
  CommandResult,
  Observation,
  Position,
  WorldEntity,
  WorldEvent,
  WorldSnapshot,
  WORLD_ID,
  manhattanDistance,
} from "../shared/protocol";
import { planNextAction } from "./planner";
import type { DurableWorldState } from "./supabase";

const MAX_EVENTS = 24;
const OBSERVATION_RADIUS = 5;
const INTERACTION_DISTANCE = 2;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function createEntities(): WorldEntity[] {
  return [
    {
      id: "town-hall",
      kind: "landmark",
      name: "镇公所",
      position: { x: 5, y: 3 },
      description: "小镇的中心，公告和居民登记都在这里。",
      capabilities: ["inspect", "greet"],
      state: { open: true },
    },
    {
      id: "quest-board",
      kind: "quest",
      name: "任务公告板",
      position: { x: 6, y: 4 },
      description: "一张写着‘帮森林边缘找回三颗种子’的公告。",
      capabilities: ["inspect", "greet"],
      state: { questId: "seed-search", reward: "friendship" },
    },
    {
      id: "market-square",
      kind: "landmark",
      name: "集市广场",
      position: { x: 8, y: 5 },
      description: "未来会开放玩家商店的广场，目前只有长椅和风车。",
      capabilities: ["inspect", "greet"],
      state: { tradingEnabled: false },
    },
    {
      id: "old-well",
      kind: "landmark",
      name: "老水井",
      position: { x: 3, y: 6 },
      description: "井水清凉，井沿上刻着不认识的像素符号。",
      capabilities: ["inspect", "greet"],
      state: { waterLevel: "full" },
    },
    {
      id: "forest-edge",
      kind: "resource",
      name: "森林边缘",
      position: { x: 10, y: 7 },
      description: "镇外的树林，地上散落着可以采集的种子。",
      capabilities: ["inspect", "gather"],
      state: { resource: "seed", remaining: 3 },
    },
    {
      id: "bakery",
      kind: "landmark",
      name: "麦穗面包房",
      position: { x: 2, y: 2 },
      description: "还没有老板，但窗户里飘出烤面包的香味。",
      capabilities: ["inspect", "greet"],
      state: { open: false },
    },
  ];
}

function createAgent(): AgentState {
  return {
    id: AGENT_ID,
    name: "小镇观察员",
    position: { x: 5, y: 5 },
    status: "idle",
    energy: 100,
    inventory: {},
    stateVersion: 0,
  };
}

export class WorldRuntime {
  readonly worldId = WORLD_ID;
  worldName = "晨雾小镇";
  width = 22;
  height = 14;

  private worldTime = 8 * 60;
  private stateVersion = 0;
  private eventCounter = 0;
  // ponytail: one in-memory authority is enough for this vertical slice; shard by room before scaling out.
  private readonly entities = createEntities();
  private readonly agents = new Map<string, AgentState>([[AGENT_ID, createAgent()]]);
  private readonly events: WorldEvent[] = [];
  private readonly listeners = new Set<(snapshot: WorldSnapshot) => void>();
  private readonly requestCache = new Map<string, CommandResult>();
  private timer?: ReturnType<typeof setInterval>;

  hydrate(state: DurableWorldState): void {
    if (state.world?.name) this.worldName = state.world.name;
    if (Number.isFinite(state.world?.width)) this.width = Math.max(1, Number(state.world?.width));
    if (Number.isFinite(state.world?.height)) this.height = Math.max(1, Number(state.world?.height));
    if (Number.isFinite(state.world?.worldTime)) this.worldTime = Math.max(0, Number(state.world?.worldTime));
    if (Number.isFinite(state.world?.stateVersion)) this.stateVersion = Math.max(0, Number(state.world?.stateVersion));

    // Keep the built-in starter side when a partially seeded MVP only has entities or agents.
    if (state.entities.length > 0) {
      this.entities.splice(0, this.entities.length, ...clone(state.entities));
    }
    if (state.agents.length > 0) {
      this.agents.clear();
      for (const agent of state.agents) this.agents.set(agent.id, clone(agent));
    }
  }

  getSnapshot(): WorldSnapshot {
    return clone({
      worldId: this.worldId,
      name: this.worldName,
      width: this.width,
      height: this.height,
      worldTime: this.worldTime,
      stateVersion: this.stateVersion,
      entities: this.entities,
      agents: [...this.agents.values()],
      recentEvents: this.events,
    });
  }

  observe(agentId: string, radius = OBSERVATION_RADIUS): Observation {
    const agent = this.agents.get(agentId);
    if (!agent) throw new Error(`Unknown agent: ${agentId}`);
    const nearbyEntities = this.entities.filter(
      (entity) => manhattanDistance(entity.position, agent.position) <= radius,
    );
    const availableActions = ["move"] as Observation["availableActions"];
    if (nearbyEntities.some((entity) => entity.capabilities.includes("inspect"))) availableActions.push("inspect");
    if (nearbyEntities.some((entity) => entity.capabilities.includes("greet"))) availableActions.push("greet");
    if (
      nearbyEntities.some(
        (entity) => entity.capabilities.includes("gather") && Number(entity.state.remaining ?? 0) > 0,
      )
    ) {
      availableActions.push("gather");
    }
    return clone({
      observationVersion: this.stateVersion,
      observedAt: Date.now(),
      worldId: this.worldId,
      worldTime: this.worldTime,
      agent,
      nearbyEntities,
      availableActions,
      recentEvents: this.events.slice(-8),
    });
  }

  executeCommand(
    agentId: string,
    action: AgentAction,
    clientRequestId?: string,
    expectedStateVersion?: number,
  ): CommandResult {
    if (clientRequestId) {
      const cached = this.requestCache.get(clientRequestId);
      if (cached) return clone(cached);
    }

    const agent = this.agents.get(agentId);
    if (!agent) return this.fail(action, `Unknown agent: ${agentId}`);
    if (expectedStateVersion !== undefined && expectedStateVersion !== this.stateVersion) {
      return this.fail(action, `世界已经更新（当前 v${this.stateVersion}），请重新观察后再行动。`);
    }

    let result: CommandResult;
    switch (action.type) {
      case "move":
        result = this.move(agent, action);
        break;
      case "inspect":
        result = this.interact(agent, action, "inspect");
        break;
      case "greet":
        result = this.interact(agent, action, "greet");
        break;
      case "gather":
        result = this.gather(agent, action);
        break;
      default:
        result = this.fail(action, "Unsupported action");
    }

    if (result.ok) result.observation = this.observe(agentId);
    if (clientRequestId && this.requestCache.size < 256) this.requestCache.set(clientRequestId, clone(result));
    return result;
  }

  runAgentTurn(agentId: string): AgentTurnResult {
    const observation = this.observe(agentId);
    const decision = planNextAction(observation);
    const result = this.executeCommand(
      agentId,
      decision.action,
      `planner:${agentId}:${observation.observationVersion}`,
      observation.observationVersion,
    );
    return { observation, decision, result };
  }

  subscribe(listener: (snapshot: WorldSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(intervalMs = 1000): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    this.worldTime += 1;
    for (const agent of this.agents.values()) {
      if (agent.energy < 100 && this.worldTime % 5 === 0) agent.energy += 1;
    }
    this.broadcast();
  }

  private move(agent: AgentState, action: Extract<AgentAction, { type: "move" }>): CommandResult {
    const delta: Record<typeof action.direction, Position> = {
      north: { x: 0, y: -1 },
      south: { x: 0, y: 1 },
      east: { x: 1, y: 0 },
      west: { x: -1, y: 0 },
    };
    const next = {
      x: agent.position.x + delta[action.direction].x,
      y: agent.position.y + delta[action.direction].y,
    };
    if (next.x < 0 || next.y < 0 || next.x >= this.width || next.y >= this.height) {
      return this.fail(action, "那一格超出小镇边界了。");
    }
    agent.position = next;
    agent.status = "moving";
    return this.commit(agent, action, `向${this.directionLabel(action.direction)}移动到 (${next.x}, ${next.y})。`, "agent.moved");
  }

  private interact(
    agent: AgentState,
    action: Extract<AgentAction, { type: "inspect" | "greet" }>,
    mode: "inspect" | "greet",
  ): CommandResult {
    const entity = this.entities.find((candidate) => candidate.id === action.entityId);
    if (!entity) return this.fail(action, "找不到这个实体。");
    if (!entity.capabilities.includes(mode)) return this.fail(action, `「${entity.name}」不支持这个动作。`);
    if (manhattanDistance(agent.position, entity.position) > INTERACTION_DISTANCE) {
      return this.fail(action, `离「${entity.name}」太远了，先走近一些。`);
    }
    const message =
      mode === "inspect"
        ? `观察「${entity.name}」：${entity.description}`
        : `向「${entity.name}」打了招呼。`;
    return this.commit(agent, action, message, `agent.${mode}` , entity);
  }

  private gather(agent: AgentState, action: Extract<AgentAction, { type: "gather" }>): CommandResult {
    const entity = this.entities.find((candidate) => candidate.id === action.entityId);
    if (!entity || entity.kind !== "resource") return this.fail(action, "这里没有可采集的资源。");
    if (!entity.capabilities.includes("gather")) return this.fail(action, `「${entity.name}」不支持采集。`);
    if (manhattanDistance(agent.position, entity.position) > INTERACTION_DISTANCE) {
      return this.fail(action, `离「${entity.name}」太远了，先走近一些。`);
    }
    const remaining = Number(entity.state.remaining ?? 0);
    if (remaining <= 0) return this.fail(action, "这片资源已经被采集完了。");
    entity.state.remaining = remaining - 1;
    const resource = String(entity.state.resource ?? "item");
    agent.inventory[resource] = (agent.inventory[resource] ?? 0) + 1;
    agent.energy = Math.max(0, agent.energy - 2);
    return this.commit(agent, action, `采集到 1 个 ${resource}，还剩 ${remaining - 1} 个。`, "agent.gathered", entity);
  }

  private commit(
    agent: AgentState,
    action: AgentAction,
    message: string,
    type: string,
    entity?: WorldEntity,
  ): CommandResult {
    agent.status = "idle";
    this.stateVersion += 1;
    agent.stateVersion = this.stateVersion;
    const event: WorldEvent = {
      id: `event-${++this.eventCounter}`,
      type,
      message,
      worldTime: this.worldTime,
      stateVersion: this.stateVersion,
      agentId: agent.id,
      ...(entity ? { entityId: entity.id } : {}),
    };
    this.events.push(event);
    if (this.events.length > MAX_EVENTS) this.events.shift();
    this.broadcast();
    return { ok: true, stateVersion: this.stateVersion, message, action: clone(action), event: clone(event) };
  }

  private fail(action: AgentAction, error: string): CommandResult {
    return { ok: false, stateVersion: this.stateVersion, message: error, error, action: clone(action) };
  }

  private directionLabel(direction: Extract<AgentAction, { type: "move" }> ["direction"]): string {
    return { north: "北", south: "南", east: "东", west: "西" }[direction];
  }

  private broadcast(): void {
    // ponytail: MVP sends a full snapshot at 1 Hz; add room AOI + deltas when player count warrants it.
    const snapshot = this.getSnapshot();
    for (const listener of this.listeners) listener(snapshot);
  }
}
