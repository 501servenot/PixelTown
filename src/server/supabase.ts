import type { AgentState, WorldEntity, WorldSnapshot } from "../shared/protocol";

export type PersistenceMode = "off" | "best-effort" | "required";

export interface DurableWorldState {
  world?: {
    name?: string;
    width?: number;
    height?: number;
    worldTime?: number;
    stateVersion?: number;
  };
  entities: WorldEntity[];
  agents: AgentState[];
}

export interface HydrationResult {
  found: boolean;
  state?: DurableWorldState;
}

interface SupabaseConfig {
  url: string;
  key: string;
  schema: string;
  mode: PersistenceMode;
  bootstrap: boolean;
  timeoutMs: number;
  chunkSize: number;
}

interface WorldRow {
  id: string;
  name: string;
  map_version?: string;
  chunk_size?: number;
  metadata?: unknown;
}

interface EntityRow {
  id: string;
  world_id: string;
  kind: string;
  name: string;
  x: number;
  y: number;
  chunk_x?: number;
  chunk_y?: number;
  capabilities?: string[];
  state?: unknown;
  active?: boolean;
}

interface AgentRow {
  id: string;
  world_id: string;
  name: string;
  definition?: unknown;
}

interface AgentRuntimeRow {
  agent_id: string;
  world_id: string;
  x: number;
  y: number;
  chunk_x?: number;
  chunk_y?: number;
  state_revision?: number;
  status?: string;
  memory?: unknown;
  stats?: unknown;
}

interface ChunkRow {
  world_id: string;
  chunk_x: number;
  chunk_y: number;
  current_revision?: number;
}

type JsonRecord = Record<string, unknown>;

function env(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function numberFrom(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function recordFrom(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function stringArrayFrom(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function inventoryFrom(value: unknown): Record<string, number> {
  const record = recordFrom(value);
  const inventory: Record<string, number> = {};
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === "number" && Number.isFinite(item)) inventory[key] = item;
  }
  return inventory;
}

function statusFrom(value: unknown): AgentState["status"] {
  return value === "thinking" || value === "moving" ? value : "idle";
}

function parseMode(value: string | undefined): PersistenceMode {
  return value === "off" || value === "required" ? value : "best-effort";
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function chunkKey(x: number, y: number): string {
  return `${x}:${y}`;
}

const BUILTIN_DESCRIPTIONS: Record<string, string> = {
  "town-hall": "小镇的中心，公告和居民登记都在这里。",
  "quest-board": "一张写着‘帮森林边缘找回三颗种子’的公告。",
  "market-square": "未来会开放玩家商店的广场，目前只有长椅和风车。",
  "old-well": "井水清凉，井沿上刻着不认识的像素符号。",
  "forest-edge": "镇外的树林，地上散落着可以采集的种子。",
  bakery: "还没有老板，但窗户里飘出烤面包的香味。",
};

export function createSupabaseRepository(): SupabaseRepository | null {
  const url = env("SUPABASE_URL");
  const key = env("SUPABASE_SECRET_KEY") ?? env("SUPABASE_SERVER_KEY") ?? env("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  // A publishable key is intentionally rejected here: this adapter writes server state.
  if (key.startsWith("sb_publishable_")) return null;

  const timeoutMs = Math.max(500, Number(process.env.SUPABASE_REQUEST_TIMEOUT_MS ?? 5000));
  const chunkSize = Math.max(1, Number(process.env.WORLD_CHUNK_SIZE ?? 32));
  return new SupabaseRepository({
    url,
    key,
    schema: env("SUPABASE_SCHEMA") ?? "game",
    mode: parseMode(env("SUPABASE_PERSISTENCE")),
    bootstrap: process.env.SUPABASE_BOOTSTRAP !== "false",
    timeoutMs: Number.isFinite(timeoutMs) ? timeoutMs : 5000,
    chunkSize: Number.isFinite(chunkSize) ? chunkSize : 32,
  });
}

export class SupabaseRepository {
  private state: "configured" | "ready" | "error" = "configured";
  private lastError?: string;
  private worldMetadata: JsonRecord = {};
  private mapVersion = "starter-1";
  private chunkSize: number;
  private readonly chunkRevisions = new Map<string, number>();
  private readonly agentDefinitions = new Map<string, JsonRecord>();
  private readonly agentMemory = new Map<string, JsonRecord>();
  private readonly agentStats = new Map<string, JsonRecord>();
  // ponytail: one write queue prevents an older HTTP request from overwriting a newer snapshot.
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(private readonly config: SupabaseConfig) {
    this.chunkSize = config.chunkSize;
  }

  getStatus(): {
    enabled: true;
    mode: PersistenceMode;
    state: "configured" | "ready" | "error";
    lastError?: string;
  } {
    return {
      enabled: true,
      mode: this.config.mode,
      state: this.state,
      ...(this.lastError ? { lastError: this.lastError } : {}),
    };
  }

  shouldBootstrap(): boolean {
    return this.config.bootstrap;
  }

  async load(worldId: string): Promise<HydrationResult | undefined> {
    if (this.config.mode === "off") return undefined;

    try {
      const worlds = await this.request<WorldRow[]>("worlds", {
        query: { id: `eq.${worldId}`, select: "id,name,map_version,chunk_size,metadata", limit: "1" },
      });
      if (!worlds[0]) {
        this.state = "ready";
        this.lastError = undefined;
        return { found: false };
      }

      const world = worlds[0];
      this.mapVersion = world.map_version ?? this.mapVersion;
      this.chunkSize = Math.max(1, numberFrom(world.chunk_size, this.chunkSize));
      this.worldMetadata = recordFrom(world.metadata);

      const [entities, agents, runtimes, chunks] = await Promise.all([
        this.request<EntityRow[]>("entities", {
          query: { world_id: `eq.${worldId}`, select: "id,world_id,kind,name,x,y,chunk_x,chunk_y,capabilities,state,active" },
        }),
        this.request<AgentRow[]>("agents", {
          query: { world_id: `eq.${worldId}`, select: "id,world_id,name,definition" },
        }),
        this.request<AgentRuntimeRow[]>("agent_runtime", {
          query: { world_id: `eq.${worldId}`, select: "agent_id,world_id,x,y,chunk_x,chunk_y,state_revision,status,memory,stats" },
        }),
        this.request<ChunkRow[]>("world_chunks", {
          query: { world_id: `eq.${worldId}`, select: "world_id,chunk_x,chunk_y,current_revision" },
        }),
      ]);

      for (const chunk of chunks) {
        this.chunkRevisions.set(chunkKey(chunk.chunk_x, chunk.chunk_y), numberFrom(chunk.current_revision, 0));
      }
      for (const agent of agents) this.agentDefinitions.set(agent.id, recordFrom(agent.definition));

      const runtimeByAgent = new Map(runtimes.map((runtime) => [runtime.agent_id, runtime]));
      for (const runtime of runtimes) {
        this.agentMemory.set(runtime.agent_id, recordFrom(runtime.memory));
        this.agentStats.set(runtime.agent_id, recordFrom(runtime.stats));
      }

      const mappedEntities = entities
        .filter((entity) => entity.active !== false)
        .map((entity) => this.mapEntity(entity));
      const mappedAgents = agents.map((agent) => this.mapAgent(agent, runtimeByAgent.get(agent.id)));
      const runtimeMetadata = recordFrom(this.worldMetadata.runtime);

      // A manually-created world row with no content is still an uninitialized MVP world.
      if (mappedEntities.length === 0 && mappedAgents.length === 0) {
        this.state = "ready";
        this.lastError = undefined;
        return { found: false };
      }

      this.state = "ready";
      this.lastError = undefined;
      return {
        found: true,
        state: {
          world: {
            name: world.name,
            width: numberFrom(this.worldMetadata.width, 22),
            height: numberFrom(this.worldMetadata.height, 14),
            worldTime: numberFrom(runtimeMetadata.worldTime, 8 * 60),
            stateVersion: numberFrom(runtimeMetadata.stateVersion, 0),
          },
          entities: mappedEntities,
          agents: mappedAgents,
        },
      };
    } catch (error) {
      return this.handleFailure("load", error);
    }
  }

  async persist(snapshot: WorldSnapshot): Promise<void> {
    if (this.config.mode === "off") return;
    const write = this.writeQueue.then(() => this.persistNow(snapshot));
    this.writeQueue = write.catch(() => undefined);
    return write;
  }

  private async persistNow(snapshot: WorldSnapshot): Promise<void> {

    try {
      await this.request("worlds", {
        method: "POST",
        upsert: "id",
        body: [
          {
            id: snapshot.worldId,
            name: snapshot.name,
            map_version: this.mapVersion,
            chunk_size: this.chunkSize,
            metadata: {
              orientation: "isometric",
              ...this.worldMetadata,
              width: snapshot.width,
              height: snapshot.height,
              runtime: {
                ...recordFrom(this.worldMetadata.runtime),
                worldTime: snapshot.worldTime,
                stateVersion: snapshot.stateVersion,
              },
            },
          },
        ],
      });

      const chunks = new Map<string, { x: number; y: number; entityCount: number }>();
      for (const entity of snapshot.entities) {
        const x = Math.floor(entity.position.x / this.chunkSize);
        const y = Math.floor(entity.position.y / this.chunkSize);
        const key = chunkKey(x, y);
        const current = chunks.get(key) ?? { x, y, entityCount: 0 };
        current.entityCount += 1;
        chunks.set(key, current);
      }
      for (const key of this.chunkRevisions.keys()) {
        if (chunks.has(key)) continue;
        const [x, y] = key.split(":").map(Number);
        chunks.set(key, { x, y, entityCount: 0 });
      }

      // ponytail: five independent REST writes are acceptable for this single-process MVP; use one DB RPC/transaction before multi-server authority.
      await Promise.all([
        this.request("entities", {
          method: "POST",
          upsert: "id",
          body: snapshot.entities.map((entity) => {
            const chunkX = Math.floor(entity.position.x / this.chunkSize);
            const chunkY = Math.floor(entity.position.y / this.chunkSize);
            return {
              id: entity.id,
              world_id: snapshot.worldId,
              kind: entity.kind,
              name: entity.name,
              x: entity.position.x,
              y: entity.position.y,
              chunk_x: chunkX,
              chunk_y: chunkY,
              entity_revision: snapshot.stateVersion,
              capabilities: entity.capabilities,
              state: { ...entity.state, __description: entity.description },
              active: true,
            };
          }),
        }),
        this.request("agents", {
          method: "POST",
          upsert: "id",
          body: snapshot.agents.map((agent) => ({
            id: agent.id,
            world_id: snapshot.worldId,
            name: agent.name,
            definition: this.agentDefinitions.get(agent.id) ?? {},
          })),
        }),
        this.request("agent_runtime", {
          method: "POST",
          upsert: "agent_id",
          body: snapshot.agents.map((agent) => {
            const chunkX = Math.floor(agent.position.x / this.chunkSize);
            const chunkY = Math.floor(agent.position.y / this.chunkSize);
            const stats = {
              ...this.agentStats.get(agent.id),
              energy: agent.energy,
              inventory: agent.inventory,
            };
            return {
              agent_id: agent.id,
              world_id: snapshot.worldId,
              x: agent.position.x,
              y: agent.position.y,
              chunk_x: chunkX,
              chunk_y: chunkY,
              state_revision: agent.stateVersion,
              status: agent.status,
              memory: this.agentMemory.get(agent.id) ?? {},
              stats,
            };
          }),
        }),
        this.request("world_chunks", {
          method: "POST",
          upsert: "world_id,chunk_x,chunk_y",
          body: [...chunks.values()].map((chunk) => {
            const key = chunkKey(chunk.x, chunk.y);
            const revision = Math.max(this.chunkRevisions.get(key) ?? 0, snapshot.stateVersion);
            this.chunkRevisions.set(key, revision);
            return {
              world_id: snapshot.worldId,
              chunk_x: chunk.x,
              chunk_y: chunk.y,
              current_revision: revision,
              last_checkpoint_revision: revision,
              entity_count: chunk.entityCount,
            };
          }),
        }),
      ]);
      this.state = "ready";
      this.lastError = undefined;
    } catch (error) {
      this.handleFailure("persist", error);
    }
  }

  private mapEntity(row: EntityRow): WorldEntity {
    const storedState = recordFrom(row.state);
    const description =
      typeof storedState.__description === "string"
        ? storedState.__description
        : BUILTIN_DESCRIPTIONS[row.id] ?? row.name;
    const { __description: _description, ...state } = storedState;
    return {
      id: row.id,
      kind: row.kind as WorldEntity["kind"],
      name: row.name,
      position: { x: numberFrom(row.x, 0), y: numberFrom(row.y, 0) },
      description,
      capabilities: stringArrayFrom(row.capabilities),
      state,
    };
  }

  private mapAgent(row: AgentRow, runtime: AgentRuntimeRow | undefined): AgentState {
    const stats = recordFrom(runtime?.stats);
    return {
      id: row.id,
      name: row.name,
      position: { x: numberFrom(runtime?.x, 5), y: numberFrom(runtime?.y, 5) },
      status: statusFrom(runtime?.status),
      energy: numberFrom(stats.energy, 100),
      inventory: inventoryFrom(stats.inventory),
      stateVersion: numberFrom(runtime?.state_revision, 0),
    };
  }

  private async request<T = unknown>(
    table: string,
    options: {
      method?: "GET" | "POST";
      query?: Record<string, string>;
      body?: unknown;
      upsert?: string;
    } = {},
  ): Promise<T> {
    const endpoint = new URL(`/rest/v1/${table}`, this.config.url.replace(/\/$/, ""));
    for (const [key, value] of Object.entries(options.query ?? {})) endpoint.searchParams.set(key, value);
    if (options.upsert) endpoint.searchParams.set("on_conflict", options.upsert);

    const method = options.method ?? "GET";
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.config.timeoutMs);
    try {
      const response = await fetch(endpoint, {
        method,
        signal: controller.signal,
        headers: {
          // Supabase secret keys are API keys, not JWT bearer tokens.
          apikey: this.config.key,
          ...(method === "GET" ? { "Accept-Profile": this.config.schema } : { "Content-Profile": this.config.schema }),
          ...(options.body === undefined ? {} : {
            "content-type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal",
          }),
        },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      });
      const text = await response.text();
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} from ${table}: ${text.slice(0, 300)}`);
      }
      return (text ? JSON.parse(text) : undefined) as T;
    } finally {
      clearTimeout(timeout);
    }
  }

  private handleFailure<T>(operation: string, error: unknown): T | undefined {
    const message = errorMessage(error);
    this.state = "error";
    this.lastError = `${operation}: ${message}`;
    if (this.config.mode === "required") throw new Error(`[supabase] ${this.lastError}`);
    console.warn(`[supabase] ${this.lastError}; continuing with in-memory runtime`);
    return undefined;
  }
}
