import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { EntityDefinition, EntityType } from "../domain/entity";

const ENTITY_TYPES: EntityType[] = ["player", "agent", "npc", "animal", "building", "item", "resource", "object"];

export class EntityCatalog {
  private readonly definitions = new Map<string, EntityDefinition>();

  get size(): number {
    return this.definitions.size;
  }

  loadDirectory(root: string): void {
    for (const type of ENTITY_TYPES) {
      const folder = join(root, type);
      try {
        if (!statSync(folder).isDirectory()) continue;
      } catch {
        continue;
      }
      for (const file of readdirSync(folder)) {
        if (!file.endsWith(".json")) continue;
        const definition = JSON.parse(readFileSync(join(folder, file), "utf8")) as EntityDefinition;
        this.add(definition);
      }
    }
  }

  add(definition: EntityDefinition): void {
    if (!definition.id) throw new Error("Entity definition is missing id");
    if (!definition.state.facing) definition.state = { ...definition.state, facing: "east" };
    if (!ENTITY_TYPES.includes(definition.type)) throw new Error(`Unknown entity type: ${definition.type}`);
    this.definitions.set(definition.id, structuredClone(definition));
  }

  get(id: string): EntityDefinition | undefined {
    const definition = this.definitions.get(id);
    return definition ? structuredClone(definition) : undefined;
  }

  list(): EntityDefinition[] {
    return [...this.definitions.values()].map((definition) => structuredClone(definition));
  }
}

export function loadEntityCatalog(root = join(process.cwd(), "entities")): EntityCatalog {
  const catalog = new EntityCatalog();
  catalog.loadDirectory(root);
  return catalog;
}
