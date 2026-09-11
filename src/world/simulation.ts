import { loadEntityCatalog, type EntityCatalog } from "./state/catalog";
import { CommandQueue, type Command, type CommandReject } from "./domain/command";
import { Chunk } from "./state/chunk";
import {
  CHUNK_SIZE,
  chunkIdAt,
  cloneEntity,
  isObserver,
  manhattan,
  placedPosition,
  type ObserveDirection,
  type RuntimeEntity,
  type WorldPosition,
} from "./domain/entity";
import {
  offeredInteractions,
  type AgentObservation,
  type WorldBroadcast,
} from "./perception/observe";
import {
  BROADCAST_RADIUS,
  broadcastMessage,
  PUBLIC_BROADCASTS,
  PUBLIC_EVENT_DURATION_TICKS,
  PublicEventManager,
} from "./perception/public-event";
import { SpeechInbox, type SpeechLine } from "./perception/speech";
import { EVENT_PRIORITY, EventQueue, MAX_EVENT_DEPTH, MAX_EVENTS_PER_TICK, type WorldSimEvent } from "./domain/event";
import {
  applyDamage as applyDamageTo,
  applyEffects as applyEffectsTo,
  executeAttack,
  executeDestroy,
  executeMove,
  executeObserve,
  executeRest,
  executeShout,
  executePickup,
  executeTalk,
  fireTickEffects,
  observeActor,
  positionFromPayload,
  planBehavior,
  reactToEvent,
  removeEntity as detachEntity,
  spawnEntity,
  addEntity as placeEntity,
  tickStatuses,
} from "./systems";
import type { SimStore, SpeechPort } from "./systems/host";

/** 一个 tick 结束后的世界快照：全部实体、本 tick 的事件与广播、被拒命令；供服务端推送与客户端渲染。 */
export interface SimulationSnapshot {
  tick: number;
  entityCount: number;
  chunkCount: number;
  entities: RuntimeEntity[];
  recentEvents: WorldSimEvent[];
  recentBroadcasts: WorldBroadcast[];
  rejected: CommandReject[];
}

/** WorldSimulation 的构造参数：可注入配方目录，以及防事件链式爆炸的上限（maxEventDepth/maxEventsPerTick）。 */
export interface WorldSimulationOptions {
  catalog?: EntityCatalog;
  maxEventDepth?: number;
  maxEventsPerTick?: number;
}

/** 20 Hz. Cheap at this entity count; 60 Hz is also fine until a chunk has thousands of entities. */
export const TICK_MS = 50;

const COMPATIBLE_ACTIONS: Record<string, string[]> = {
  attack: ["attack", "chop"],
  destroy: ["destroy", "chop"],
  talk: ["talk"],
  pickup: ["pickup"],
  move: ["move"],
  rest: ["rest"],
  interact: ["talk", "attack", "chop", "pickup", "destroy", "collect"],
  collect: ["collect"],
};

/** 服务端权威的世界模拟器：20Hz 逐 tick 驱动，是唯一改世界的人；实现 SimStore/SpeechPort，把校验后的 Command 分发给各系统执行。 */
export class WorldSimulation implements SimStore, SpeechPort {
  private readonly chunks = new Map<string, Chunk>();
  private readonly entities = new Map<string, RuntimeEntity>();
  private readonly inbox = new CommandQueue();
  private readonly events = new EventQueue();
  private readonly dirty = new Set<string>();
  readonly lastSeen = new Map<string, WorldPosition>();
  private readonly emitted: WorldSimEvent[] = [];
  private readonly tickBroadcasts: WorldBroadcast[] = [];
  private readonly publicEvents: PublicEventManager;
  private readonly speech = new SpeechInbox();
  private readonly rejected: CommandReject[] = [];
  private readonly listeners = new Set<(snapshot: SimulationSnapshot) => void>();
  private readonly broadcastListeners = new Set<(broadcasts: WorldBroadcast[]) => void>();
  private readonly speechListeners = new Set<(line: SpeechLine) => void>();
  private broadcastSeq = 0;
  private speechSeq = 0;
  private readonly catalog: EntityCatalog;
  readonly maxEventDepth: number;
  private readonly maxEventsPerTick: number;
  private commandSeq = 0;
  private guestSeq = 0;
  private eventSeq = 0;
  private spawnSeq = 0;
  private clock = 0;
  private timer?: ReturnType<typeof setInterval>;
  tickCount = 0;

  constructor(options: WorldSimulationOptions = {}) {
    this.catalog = options.catalog ?? loadEntityCatalog();
    this.maxEventDepth = options.maxEventDepth ?? MAX_EVENT_DEPTH;
    this.maxEventsPerTick = options.maxEventsPerTick ?? MAX_EVENTS_PER_TICK;
    this.publicEvents = new PublicEventManager((id) => this.chunk(id), (id) => this.chunks.get(id));
  }

  get catalogSize(): number {
    return this.catalog.size;
  }

  seedStarterChunk(): void {
    this.spawn("player.default", "player_001", placedPosition(119, 85));
    const scout = this.spawn("agent.default", "agent_001", placedPosition(118, 85));
    scout.name = "Scout";
    scout.description = "第一个进入世界的 Agent，通过观察和 Command 参与模拟";
    const rover = this.spawn("agent.default", "agent_002", placedPosition(117, 85));
    rover.name = "Rover";
    rover.description = "第二个进入世界的 Agent，通过观察和 Command 参与模拟";
    const wren = this.spawn("agent.default", "agent_003", placedPosition(116, 85));
    wren.name = "Wren";
    wren.description = "第三个进入世界的 Agent，和 Scout、Rover 站在相邻格子上";
    this.spawn("npc.john", "npc_001", placedPosition(120, 85));
    this.spawn("object.tree", "tree_001", placedPosition(121, 85));
    this.spawn("animal.cat", "cat_001", placedPosition(122, 86));
  }

  /** Runtime starter layout used by the renderer: two test agents, one tree and one mall. */
  seedPlayableWorld(): void {
    this.spawn("player.default", "player_001", placedPosition(115, 87));
    const scout = this.spawn("agent.default", "agent_001", placedPosition(118, 85));
    scout.name = "Scout";
    scout.description = "第一个进入世界的测试 Agent";
    const rover = this.spawn("agent.default", "agent_002", placedPosition(117, 85));
    rover.name = "Rover";
    rover.description = "第二个进入世界的测试 Agent";
    const wren = this.spawn("agent.default", "agent_003", placedPosition(116, 85));
    wren.name = "Wren";
    wren.description = "第三个进入世界的测试 Agent";
    this.spawn("object.tree", "tree_001", placedPosition(121, 85));
    this.spawn("building.mall", "mall_001", placedPosition(160, 60));
    this.spawn("npc.guard_bot", "guard_001", placedPosition(119, 88));
    this.spawn("object.gacha", "gacha_001", placedPosition(112, 84));
    this.spawn("item.token", "token_001", placedPosition(111, 86));
    this.spawn("object.road", "road_001", placedPosition(114, 88));
    const portalA = this.spawn("object.portal", "portal_a", placedPosition(110, 85));
    const portalB = this.spawn("object.portal", "portal_b", placedPosition(210, 85));
    portalA.attributes.linkId = portalB.id;
    portalB.attributes.linkId = portalA.id;
  }

  admitVisitor(name: string): RuntimeEntity {
    this.guestSeq += 1;
    const id = `agent_guest_${this.guestSeq}`;
    const slot = this.guestSeq - 1;
    const entity = this.spawn("agent.default", id, placedPosition(116 + (slot % 5), 84 + Math.floor(slot / 5)));
    entity.name = name;
    entity.description = `${name}，从外面连进世界的 Agent`;
    return entity;
  }

  addEntity(entity: RuntimeEntity): void {
    placeEntity(this, entity);
  }

  spawn(definitionId: string, id: string, position: WorldPosition): RuntimeEntity {
    return spawnEntity(this, this.catalog, definitionId, id, position);
  }

  spawnLoot(definitionId: string, position: WorldPosition, parent: WorldSimEvent): void {
    this.spawnSeq += 1;
    this.spawn(definitionId, `${definitionId.replace(/\./g, "_")}_${this.spawnSeq}`, position);
    const created = this.emitted[this.emitted.length - 1];
    if (created) {
      created.parentEventId = parent.id;
      created.depth = parent.depth + 1;
    }
  }

  removeEntity(entityId: string, sourceId?: string, parent?: WorldSimEvent): RuntimeEntity | undefined {
    return detachEntity(this, entityId, sourceId, parent);
  }

  submitCommand(command: Omit<Command, "id" | "timestamp"> & { id?: string; timestamp?: number }): string {
    const id = command.id ?? this.nextCommandId();
    this.inbox.enqueue({
      ...command,
      id,
      timestamp: command.timestamp ?? this.clock,
    });
    return id;
  }

  tick(deltaTime = 1): SimulationSnapshot {
    this.clock += deltaTime;
    this.tickCount += 1;
    this.emitted.length = 0;
    this.tickBroadcasts.length = 0;
    this.rejected.length = 0;
    this.dirty.clear();
    this.publicEvents.expire(this.tickCount);

    this.scheduleBehaviors();
    this.dispatchInbox();
    const commands = this.collectCommands();
    for (const command of commands) this.executeCommand(command);
    tickStatuses(this);
    fireTickEffects(this);
    this.processEvents();
    this.flushBroadcasts();

    const snapshot = this.getSnapshot();
    if (commands.length > 0 || snapshot.recentEvents.length > 0 || snapshot.rejected.length > 0) {
      for (const listener of this.listeners) listener(snapshot);
    }
    return snapshot;
  }

  observe(actorId: string, options: { radius?: number; direction?: ObserveDirection; consumeSaid?: boolean } = {}): AgentObservation {
    return observeActor(this, this.speech, this.publicEvents, actorId, options);
  }

  canActorAct(actorId: string): boolean {
    const actor = this.live(actorId);
    return Boolean(actor && isObserver(actor) && actor.state.status === "alive");
  }

  getEntity(entityId: string): RuntimeEntity | undefined {
    const entity = this.entities.get(entityId);
    return entity ? cloneEntity(entity) : undefined;
  }

  getNearbyEntities(position: Pick<WorldPosition, "x" | "y">, radius: number): RuntimeEntity[] {
    return this.queryNearby(position, radius).map(cloneEntity);
  }

  getNearbyObservers(position: Pick<WorldPosition, "x" | "y">, radius: number): RuntimeEntity[] {
    return this.queryNearby(position, radius).filter(isObserver).map(cloneEntity);
  }

  getSnapshot(): SimulationSnapshot {
    return {
      tick: this.tickCount,
      entityCount: this.entities.size,
      chunkCount: this.chunks.size,
      entities: [...this.entities.values()].map(cloneEntity),
      recentEvents: this.emitted.map((event) => ({ ...event })),
      recentBroadcasts: this.tickBroadcasts.map((item) => ({ ...item, origin: { ...item.origin } })),
      rejected: this.rejected.map((item) => ({ ...item })),
    };
  }

  subscribe(listener: (snapshot: SimulationSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeBroadcast(listener: (broadcasts: WorldBroadcast[]) => void): () => void {
    this.broadcastListeners.add(listener);
    return () => this.broadcastListeners.delete(listener);
  }

  subscribeSpeech(listener: (line: SpeechLine) => void): () => void {
    this.speechListeners.add(listener);
    return () => this.speechListeners.delete(listener);
  }

  start(intervalMs = TICK_MS): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  live(id: string): RuntimeEntity | undefined {
    return this.entities.get(id);
  }

  putEntity(entity: RuntimeEntity): void {
    this.entities.set(entity.id, entity);
  }

  dropEntity(entityId: string): void {
    this.entities.delete(entityId);
    this.dirty.delete(entityId);
  }

  chunk(id: string): Chunk {
    let chunk = this.chunks.get(id);
    if (!chunk) {
      chunk = new Chunk(id);
      this.chunks.set(id, chunk);
    }
    return chunk;
  }

  markDirty(id: string): void {
    this.dirty.add(id);
  }

  queryNearby(position: Pick<WorldPosition, "x" | "y">, radius: number): RuntimeEntity[] {
    const seen = new Set<string>();
    const found: RuntimeEntity[] = [];
    const minX = position.x - radius;
    const maxX = position.x + radius;
    const minY = position.y - radius;
    const maxY = position.y + radius;
    const chunkIds = new Set<string>();
    const minChunkX = Math.floor(minX / CHUNK_SIZE);
    const maxChunkX = Math.floor(maxX / CHUNK_SIZE);
    const minChunkY = Math.floor(minY / CHUNK_SIZE);
    const maxChunkY = Math.floor(maxY / CHUNK_SIZE);
    for (let x = minChunkX; x <= maxChunkX; x += 1) {
      for (let y = minChunkY; y <= maxChunkY; y += 1) chunkIds.add(chunkIdAt(x * CHUNK_SIZE, y * CHUNK_SIZE));
    }
    for (const id of chunkIds) {
      const chunk = this.chunks.get(id);
      if (!chunk) continue;
      for (const entityId of chunk.spatial.candidates(position, radius)) {
        if (seen.has(entityId)) continue;
        const entity = this.live(entityId);
        if (!entity || entity.containedIn) continue;
        seen.add(entityId);
        if (manhattan(position, entity.position) <= radius) found.push(entity);
      }
    }
    return found;
  }

  applyDamage(target: RuntimeEntity, damage: number, sourceId: string, destroy = false, damageType = "kinetic"): void {
    applyDamageTo(this, target, damage, sourceId, destroy, damageType);
  }

  applyEffects(entity: RuntimeEntity, trigger: string, parent: WorldSimEvent, actor?: RuntimeEntity): void {
    applyEffectsTo(this, entity, trigger, parent, actor);
  }

  liveAll(): RuntimeEntity[] {
    return [...this.entities.values()];
  }

  nextSpeechId(): string {
    this.speechSeq += 1;
    return `say_${String(this.speechSeq).padStart(3, "0")}`;
  }

  pushSpeech(line: SpeechLine): void {
    this.speech.push(line);
    for (const listener of this.speechListeners) listener(line);
  }

  emit(partial: Omit<WorldSimEvent, "id" | "timestamp"> & { id?: string; timestamp?: number }): WorldSimEvent {
    const event: WorldSimEvent = {
      ...partial,
      id: partial.id ?? this.nextEventId(),
      timestamp: partial.timestamp ?? this.clock,
      durationTicks: partial.durationTicks,
      depth: partial.depth,
      priority: partial.priority,
    };
    this.emitted.push(event);
    this.events.enqueue(event, this.maxEventsPerTick);
    const origin =
      (event.targetId ? this.live(event.targetId)?.position : undefined) ??
      (event.targetId ? this.lastSeen.get(event.targetId) : undefined) ??
      (event.sourceId ? this.live(event.sourceId)?.position : undefined) ??
      positionFromPayload(event);
    if (origin && PUBLIC_BROADCASTS.has(event.type)) this.publishBroadcast(event, origin);
    return event;
  }

  reject(command: Command, reason: string): void {
    this.rejected.push({ commandId: command.id, reason });
  }

  private dispatchInbox(): void {
    for (const command of this.inbox.drain()) {
      const actor = this.live(command.actorId);
      const home = actor?.position.chunkId ?? chunkIdAt(0, 0);
      this.chunk(home).commands.enqueue(command);
    }
  }

  private collectCommands(): Command[] {
    const ids = [...this.chunks.keys()].sort();
    const commands: Command[] = [];
    for (const id of ids) commands.push(...this.chunk(id).commands.drain());
    return commands;
  }

  private executeCommand(command: Command): void {
    const actor = this.live(command.actorId);
    if (!actor) {
      this.reject(command, `actor ${command.actorId} does not exist`);
      return;
    }
    if (actor.state.status !== "alive") {
      this.reject(command, `${actor.id} is ${actor.state.status}`);
      return;
    }
    if (typeof command.expiresAtTick === "number" && this.tickCount >= command.expiresAtTick) {
      this.reject(command, `expired at tick ${command.expiresAtTick}`);
      return;
    }
    if (typeof command.expectedActorVersion === "number" && command.expectedActorVersion !== actor.version) {
      this.reject(command, `stale actor version: expected ${command.expectedActorVersion}, current ${actor.version}`);
      return;
    }

    if (command.type === "move") {
      executeMove(this, command, actor);
      return;
    }
    if (command.type === "observe") {
      executeObserve(this, command, actor);
      return;
    }
    if (command.type === "rest") {
      executeRest(this, command, actor);
      return;
    }
    if (command.type === "shout") {
      executeShout(this, command, actor);
      return;
    }

    const target = command.targetId ? this.live(command.targetId) : undefined;
    if (!command.targetId || !target) {
      this.reject(command, `target ${command.targetId ?? "?"} does not exist`);
      return;
    }
    if (typeof command.expectedVersion === "number" && command.expectedVersion !== target.version) {
      this.reject(command, `stale version: expected ${command.expectedVersion}, current ${target.version}`);
      return;
    }
    if (target.state.status !== "alive") {
      this.reject(command, `${target.id} is ${target.state.status}`);
      return;
    }
    const range = target.interaction.range || actor.interaction.range;
    if (manhattan(actor.position, target.position) > range) {
      this.reject(command, `${target.id} is out of range`);
      return;
    }
    const verb = command.type === "interact" ? String(command.payload?.verb ?? "") : command.type;
    if (!verb || !this.canUseVerb(actor, target, verb)) {
      this.reject(command, `${actor.id} cannot ${verb || command.type} ${target.id}`);
      return;
    }

    if (verb === "talk") executeTalk(this, command, actor, target);
    else if (verb === "attack" || verb === "chop") executeAttack(this, command, actor, target);
    else if (verb === "destroy") executeDestroy(this, command, actor, target);
    else if (verb === "pickup") executePickup(this, command, actor, target);
    else if (verb === "rest") executeRest(this, command, actor);
    else if (verb === "collect") {
      const completed = this.emit({
        type: "interaction_completed",
        sourceId: actor.id,
        targetId: target.id,
        depth: 0,
        priority: EVENT_PRIORITY.player,
        payload: { action: "collect", commandId: command.id },
      });
      this.applyEffects(target, "use:collect", completed, actor);
    } else this.reject(command, `unknown interaction: ${verb}`);
  }

  private processEvents(): void {
    let guard = 0;
    while (this.events.pending > 0 && guard < this.maxEventsPerTick) {
      const batch = this.events.drain(this.maxEventsPerTick);
      if (batch.length === 0) break;
      for (const event of batch) {
        guard += 1;
        reactToEvent(this, event, this.maxEventDepth);
      }
    }
  }

  private scheduleBehaviors(): void {
    for (const entity of this.entities.values()) {
      const command = planBehavior(entity, this.tickCount, this);
      if (command) this.submitCommand(command);
    }
  }

  private canUseVerb(actor: RuntimeEntity, target: RuntimeEntity, verb: string): boolean {
    const aliases = COMPATIBLE_ACTIONS[verb] ?? [verb];
    return offeredInteractions(actor, target).some((action) => aliases.includes(action.type));
  }

  private publishBroadcast(event: WorldSimEvent, origin: WorldPosition): void {
    const source = event.sourceId ? this.live(event.sourceId) : undefined;
    const target = event.targetId ? this.live(event.targetId) : undefined;
    const broadcast: WorldBroadcast = {
      id: `bc_${String((this.broadcastSeq += 1)).padStart(3, "0")}`,
      tick: this.tickCount,
      type: event.type,
      sourceId: event.sourceId,
      targetId: event.targetId,
      origin: { ...origin },
      radius: typeof event.payload?.radius === "number" ? event.payload.radius : BROADCAST_RADIUS[event.type] ?? 6,
      priority: event.priority,
      startedAtTick: this.tickCount,
      expiresAtTick: this.tickCount + (event.durationTicks ?? PUBLIC_EVENT_DURATION_TICKS[event.type] ?? 1),
      message: broadcastMessage(
        event.type,
        { source: source?.name, target: target?.name ?? event.targetId },
        event.payload,
      ),
      payload: event.payload,
    };
    this.publicEvents.publish(broadcast);
    this.tickBroadcasts.push(broadcast);
  }

  private flushBroadcasts(): void {
    if (this.tickBroadcasts.length === 0) return;
    const batch = [...this.tickBroadcasts].sort(
      (a, b) => a.priority - b.priority || a.tick - b.tick || a.id.localeCompare(b.id),
    );
    for (const listener of this.broadcastListeners) listener(batch);
  }

  private nextCommandId(): string {
    this.commandSeq += 1;
    return `cmd_${String(this.commandSeq).padStart(3, "0")}`;
  }

  private nextEventId(): string {
    this.eventSeq += 1;
    return `evt_${String(this.eventSeq).padStart(3, "0")}`;
  }
}
