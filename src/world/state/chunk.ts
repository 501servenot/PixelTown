import { CommandQueue } from "../domain/command";
import type { RuntimeEntity, WorldPosition } from "../domain/entity";
import { SpatialIndex } from "./spatial";

export class Chunk {
  readonly id: string;
  readonly commands = new CommandQueue();
  readonly spatial = new SpatialIndex();
  private readonly entities = new Map<string, RuntimeEntity>();
  private readonly publicEventIds = new Set<string>();

  constructor(id: string) {
    this.id = id;
  }

  get size(): number {
    return this.entities.size;
  }

  add(entity: RuntimeEntity): void {
    this.entities.set(entity.id, entity);
    this.spatial.insert(entity);
  }

  remove(entityId: string): RuntimeEntity | undefined {
    const entity = this.entities.get(entityId);
    if (!entity) return undefined;
    this.entities.delete(entityId);
    this.spatial.remove(entityId);
    return entity;
  }

  get(entityId: string): RuntimeEntity | undefined {
    return this.entities.get(entityId);
  }

  has(entityId: string): boolean {
    return this.entities.has(entityId);
  }

  list(): RuntimeEntity[] {
    return [...this.entities.values()];
  }

  addPublicEvent(eventId: string): void {
    this.publicEventIds.add(eventId);
  }

  removePublicEvent(eventId: string): void {
    this.publicEventIds.delete(eventId);
  }

  publicEvents(): string[] {
    return [...this.publicEventIds];
  }

  relocate(entity: RuntimeEntity, next: WorldPosition): void {
    entity.position = next;
    this.spatial.move(entity.id, next);
  }
}
