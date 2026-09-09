import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { instantiate, placedPosition, type EntityDefinition } from "./domain/entity";
import { WorldSimulation } from "./simulation";
import { planBehavior } from "./systems/behavior";

function npc(actions: Array<{ type: string; enabled: boolean }>, tickRate = 2) {
  const definition: EntityDefinition = {
    id: "npc.test",
    version: 1,
    type: "npc",
    name: "Test NPC",
    attributes: { energy: 100, maxEnergy: 100 },
    state: { status: "alive", activity: "idle", targetId: null },
    behavior: { tickRate, actions },
    interaction: { enabled: false, range: 0, actions: [] },
    effects: [],
  };
  return instantiate(definition, "npc_test", placedPosition(10, 10));
}

describe("autonomous behavior", () => {
  it("plans deterministic adjacent wandering only when the timer is due", () => {
    const entity = npc([{ type: "wander", enabled: true }]);
    assert.equal(planBehavior(entity, 1), undefined);
    const command = planBehavior(entity, 2);
    assert.equal(command?.type, "move");
    assert.equal(command?.payload?.autonomous, true);
    assert.equal(Math.abs(Number(command?.payload?.dx)) + Math.abs(Number(command?.payload?.dy)), 1);
  });

  it("rests low-energy entities and ignores disabled behavior", () => {
    const entity = npc([
      { type: "wander", enabled: false },
      { type: "rest", enabled: true },
    ]);
    entity.attributes.energy = 10;
    assert.equal(planBehavior(entity, 2)?.type, "rest");
    entity.behavior.actions[1].enabled = false;
    assert.equal(planBehavior(entity, 4), undefined);
  });

  it("runs autonomous commands through the simulation tick", () => {
    const world = new WorldSimulation();
    world.seedStarterChunk();
    const before = world.getEntity("npc_001")?.position;
    world.tick();
    assert.deepEqual(world.getEntity("npc_001")?.position, before);
    const snapshot = world.tick();
    assert.notDeepEqual(world.getEntity("npc_001")?.position, before);
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_moved" && event.sourceId === "npc_001"));
  });
});
