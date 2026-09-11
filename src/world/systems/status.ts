import { hasStatus, type RuntimeEntity, type StatusInstance } from "../domain/entity";
import type { SimStore } from "./host";

export function applyStatus(entity: RuntimeEntity, name: string, duration: number): StatusInstance {
  const existing = entity.statuses.find((item) => item.name === name);
  if (existing) {
    existing.remaining = Math.max(existing.remaining, duration);
    return existing;
  }
  const next = { name, remaining: duration };
  entity.statuses.push(next);
  return next;
}

export function removeStatus(entity: RuntimeEntity, name: string): void {
  entity.statuses = entity.statuses.filter((item) => item.name !== name);
}

export function tickStatuses(host: SimStore): void {
  for (const entity of host.liveAll()) {
    if (entity.statuses.length === 0) continue;
    let changed = false;
    entity.statuses = entity.statuses.filter((item) => {
      item.remaining -= 1;
      changed = true;
      return item.remaining > 0;
    });
    if (changed) {
      entity.version += 1;
      host.markDirty(entity.id);
    }
  }
}

export { hasStatus };
