import type { Chunk } from "../state/chunk";
import type { Command } from "../domain/command";
import type { RuntimeEntity, WorldPosition } from "../domain/entity";
import type { WorldSimEvent } from "../domain/event";
import type { SpeechLine } from "../perception/speech";

/** host 接口的最小切面：系统可读的世界时钟（当前 tick）与事件深度上限（maxEventDepth）。 */
export interface SimClock {
  readonly tickCount: number;
  readonly maxEventDepth: number;
}

/** 系统对世界的只读视图：读时钟、查活实体、按半径查邻近实体、读实体最近已知位置（lastSeen）。 */
export interface SimView extends SimClock {
  readonly lastSeen: Map<string, WorldPosition>;
  live(id: string): RuntimeEntity | undefined;
  queryNearby(position: Pick<WorldPosition, "x" | "y">, radius: number): RuntimeEntity[];
}

/** 系统与世界交互的 host 接口：系统之间不直接调用，一律经 SimStore 改状态、用 emit 发 WorldSimEvent 通信；由 WorldSimulation 实现。 */
export interface SimStore extends SimView {
  putEntity(entity: RuntimeEntity): void;
  dropEntity(entityId: string): void;
  chunk(id: string): Chunk;
  markDirty(id: string): void;
  emit(partial: Omit<WorldSimEvent, "id" | "timestamp"> & { id?: string; timestamp?: number }): WorldSimEvent;
  reject(command: Command, reason: string): void;
  spawn(definitionId: string, id: string, position: WorldPosition): RuntimeEntity;
  spawnLoot(definitionId: string, position: WorldPosition, parent: WorldSimEvent): void;
  removeEntity(entityId: string, sourceId?: string, parent?: WorldSimEvent): RuntimeEntity | undefined;
  applyDamage(target: RuntimeEntity, damage: number, sourceId: string, destroy?: boolean, damageType?: string): void;
  applyEffects(entity: RuntimeEntity, trigger: string, parent: WorldSimEvent, actor?: RuntimeEntity): void;
  liveAll(): RuntimeEntity[];
  nextSpeechId(): string;
  pushSpeech(line: SpeechLine): void;
}

/** 私聊（said）写入口：投递 SpeechLine 的最小接口；talk 系统只依赖它，不需要完整的 SimStore。 */
export interface SpeechPort {
  readonly tickCount: number;
  nextSpeechId(): string;
  pushSpeech(line: SpeechLine): void;
}
