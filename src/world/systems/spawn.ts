import { instantiate, placedPosition, type RuntimeEntity, type WorldPosition } from "../domain/entity";
import { EVENT_PRIORITY, type WorldSimEvent } from "../domain/event";
import type { EntityCatalog } from "../state/catalog";
import type { SimStore } from "./host";

export function addEntity(host: SimStore, entity: RuntimeEntity): RuntimeEntity {
  if (host.live(entity.id)) throw new Error(`Entity already exists: ${entity.id}`);
  const placed = {
    ...entity,
    position: placedPosition(entity.position.x, entity.position.y),
  };
  host.putEntity(placed);
  host.lastSeen.set(placed.id, { ...placed.position });
  host.chunk(placed.position.chunkId).add(placed);
  host.markDirty(placed.id);
  host.emit({
    type: "entity_created",
    targetId: placed.id,
    depth: 0,
    priority: EVENT_PRIORITY.gameplay,
    payload: { type: placed.type, chunkId: placed.position.chunkId },
  });
  return placed;
}

export function spawnEntity(host: SimStore, catalog: EntityCatalog, definitionId: string, id: string, position: WorldPosition): RuntimeEntity {
  const definition = catalog.get(definitionId);
  if (!definition) throw new Error(`Unknown entity definition: ${definitionId}`);
  return addEntity(host, instantiate(definition, id, position));
}

export function removeEntity(host: SimStore, entityId: string, sourceId?: string, parent?: WorldSimEvent): RuntimeEntity | undefined {
  const entity = host.live(entityId);
  if (!entity) return undefined;
  host.lastSeen.set(entityId, { ...entity.position });
  host.chunk(entity.position.chunkId).remove(entityId);
  host.dropEntity(entityId);
  host.emit({
    type: "entity_removed",
    sourceId,
    targetId: entityId,
    parentEventId: parent?.id,
    depth: parent ? parent.depth + 1 : 0,
    priority: EVENT_PRIORITY.gameplay,
  });
  return entity;
}

export { executePickup } from "./contain";
