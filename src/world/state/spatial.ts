import { SPATIAL_CELL_SIZE, type RuntimeEntity, type WorldPosition } from "../domain/entity";

function cellKey(cx: number, cy: number): string {
  return `${cx},${cy}`;
}

function cellOf(position: Pick<WorldPosition, "x" | "y">): { cx: number; cy: number } {
  return {
    cx: Math.floor(position.x / SPATIAL_CELL_SIZE),
    cy: Math.floor(position.y / SPATIAL_CELL_SIZE),
  };
}

/** chunk 内部的网格索引：邻近查询只扫描半径实际覆盖到的格子，而不是遍历 chunk 里的每个实体。 */
export class SpatialIndex {
  private readonly cells = new Map<string, Set<string>>();
  private readonly locations = new Map<string, string>();

  insert(entity: RuntimeEntity): void {
    this.move(entity.id, entity.position);
  }

  move(entityId: string, position: WorldPosition): void {
    this.remove(entityId);
    const { cx, cy } = cellOf(position);
    const key = cellKey(cx, cy);
    let bucket = this.cells.get(key);
    if (!bucket) {
      bucket = new Set();
      this.cells.set(key, bucket);
    }
    bucket.add(entityId);
    this.locations.set(entityId, key);
  }

  remove(entityId: string): void {
    const key = this.locations.get(entityId);
    if (!key) return;
    const bucket = this.cells.get(key);
    bucket?.delete(entityId);
    if (bucket && bucket.size === 0) this.cells.delete(key);
    this.locations.delete(entityId);
  }

  candidates(position: Pick<WorldPosition, "x" | "y">, radius: number): string[] {
    const { cx, cy } = cellOf(position);
    const span = Math.max(1, Math.ceil(radius / SPATIAL_CELL_SIZE));
    const ids: string[] = [];
    for (let dy = -span; dy <= span; dy += 1) {
      for (let dx = -span; dx <= span; dx += 1) {
        const bucket = this.cells.get(cellKey(cx + dx, cy + dy));
        if (bucket) ids.push(...bucket);
      }
    }
    return ids;
  }
}
