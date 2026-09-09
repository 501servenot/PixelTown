import type { Chunk } from "../state/chunk";
import type { Command } from "../domain/command";
import type { RuntimeEntity, WorldPosition } from "../domain/entity";
import type { WorldSimEvent } from "../domain/event";
import type { SpeechLine } from "../perception/speech";

export interface SimClock {
  readonly tickCount: number;
  readonly maxEventDepth: number;
}

export interface SimView extends SimClock {
  readonly lastSeen: Map<string, WorldPosition>;
  live(id: string): RuntimeEntity | undefined;
  queryNearby(position: Pick<WorldPosition, "x" | "y">, radius: number): RuntimeEntity[];
}

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
  applyDamage(target: RuntimeEntity, damage: number, sourceId: string, destroy?: boolean): void;
  applyEffects(entity: RuntimeEntity, trigger: string, parent: WorldSimEvent): void;
}

export interface SpeechPort {
  readonly tickCount: number;
  nextSpeechId(): string;
  pushSpeech(line: SpeechLine): void;
}
