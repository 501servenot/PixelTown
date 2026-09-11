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

  it("does not lock wander to one compass point when tickRate is 4", () => {
    const entity = npc([{ type: "wander", enabled: true }], 4);
    entity.id = "guard_001";
    const dirs = new Set<string>();
    for (let tick = 4; tick <= 80; tick += 4) {
      const command = planBehavior(entity, tick);
      dirs.add(`${command?.payload?.dx},${command?.payload?.dy}`);
    }
    assert.ok(dirs.size >= 3, `wander only used ${[...dirs].join(" ")}`);
  });

  it("walks a short burst then stands still before the next leg", () => {
    const entity = npc([{ type: "wander", enabled: true }], 2);
    entity.attributes.wanderSteps = 2;
    entity.attributes.wanderPause = 6;
    const first = planBehavior(entity, 2);
    const second = planBehavior(entity, 4);
    assert.equal(first?.type, "move");
    assert.deepEqual(second?.payload, first?.payload);
    assert.equal(planBehavior(entity, 6), undefined);
    assert.equal(planBehavior(entity, 8), undefined);
    assert.equal(planBehavior(entity, 10), undefined);
    const next = planBehavior(entity, 12);
    assert.equal(next?.type, "move");
  });

  it("turns a leashed wanderer back toward home", () => {
    const entity = npc([{ type: "wander", enabled: true }], 2);
    entity.attributes.wanderRadius = 3;
    entity.attributes.homeX = 10;
    entity.attributes.homeY = 10;
    entity.position = placedPosition(10, 2);
    assert.deepEqual(planBehavior(entity, 2)?.payload, { dx: 0, dy: 1, autonomous: true });
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
