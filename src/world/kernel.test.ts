import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { loadEntityCatalog } from "./state/catalog";
import { WorldSimulation } from "./simulation";

function playable(): WorldSimulation {
  const world = new WorldSimulation();
  world.seedPlayableWorld();
  return world;
}

describe("kernel v2.1 m1", () => {
  it("keeps said on a plain observe and applies alert status when the guard is hit", () => {
    const world = playable();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 119, y: 87 } });
    world.tick();
    world.submitCommand({
      actorId: "player_001",
      type: "interact",
      targetId: "guard_001",
      payload: { verb: "attack", damage: 20, damageType: "kinetic" },
    });
    world.tick();
    const guard = world.getEntity("guard_001");
    assert.equal(guard?.attributes.homeX, 119);
    assert.equal(guard?.attributes.homeY, 88);
    assert.ok(guard?.statuses.some((item) => item.name === "alert"));
    assert.equal(guard?.attributes.health, 280);
    assert.ok(world.getSnapshot().recentBroadcasts.some((item) => item.type === "entity_emitted"));
  });

  it("picks up a token then spends it at the gacha for a prize", () => {
    const world = playable();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 111, y: 86 } });
    world.tick();
    world.submitCommand({ actorId: "player_001", type: "interact", targetId: "token_001", payload: { verb: "pickup" } });
    world.tick();
    assert.equal(world.getEntity("token_001")?.containedIn, "player_001");
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 112, y: 86 } });
    world.tick();
    world.submitCommand({ actorId: "player_001", type: "interact", targetId: "gacha_001", payload: { verb: "collect" } });
    world.tick();
    assert.equal(world.getEntity("token_001"), undefined);
    const prize = world.getSnapshot().entities.find((entity) => entity.definitionId.startsWith("item.capsule_"));
    assert.ok(prize);
  });

  it("fires enter when stepping onto the road", () => {
    const world = playable();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 115, y: 88 } });
    const snapshot = world.tick();
    assert.deepEqual(world.getEntity("player_001")?.position, { x: 115, y: 88, chunkId: "chunk_1_1" });
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_emitted" && event.sourceId === "road_001"));
  });

  it("emits a distress alarm when the guard is destroyed", () => {
    const world = playable();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 119, y: 87 } });
    world.tick();
    world.submitCommand({
      actorId: "player_001",
      type: "interact",
      targetId: "guard_001",
      payload: { verb: "attack", damage: 300, damageType: "kinetic" },
    });
    const snapshot = world.tick();
    assert.equal(world.getEntity("guard_001"), undefined);
    assert.ok(snapshot.recentBroadcasts.some((item) => item.type === "entity_emitted" && String(item.payload?.text ?? "").includes("求援")));
    assert.ok(snapshot.entities.some((entity) => entity.definitionId === "item.scrap_metal"));
  });

  it("teleports a player from one portal to the paired exit", () => {
    const world = playable();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 110, y: 85 } });
    const snapshot = world.tick();
    assert.deepEqual(world.getEntity("player_001")?.position, { x: 211, y: 85, chunkId: "chunk_3_1" });
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_moved" && event.payload?.via === "portal"));
    assert.ok(snapshot.recentBroadcasts.some((item) => item.type === "entity_emitted" && String(item.payload?.text ?? "").includes("传送门")));
    world.submitCommand({ actorId: "player_001", type: "move", payload: { x: 210, y: 85 } });
    world.tick();
    assert.deepEqual(world.getEntity("player_001")?.position, { x: 111, y: 85, chunkId: "chunk_1_1" });
  });

  it("keeps the guard inside its wander radius across bursts", () => {
    const world = playable();
    for (let i = 0; i < 400; i += 1) world.tick();
    const guard = world.getEntity("guard_001");
    assert.ok(guard);
    const away = Math.abs(guard.position.x - 119) + Math.abs(guard.position.y - 88);
    assert.ok(away <= 6, `guard drifted to ${guard.position.x},${guard.position.y}`);
  });

  it("loads every catalog recipe on the schema v2 envelope", () => {
    for (const definition of loadEntityCatalog().list()) {
      assert.equal(definition.version, 2, definition.id);
      assert.ok(definition.material, definition.id);
      assert.ok(definition.render, definition.id);
      assert.ok(definition.collider, definition.id);
      assert.ok(Array.isArray(definition.tags), definition.id);
      assert.ok(definition.state, definition.id);
      assert.ok(definition.behavior, definition.id);
      assert.ok(definition.interaction, definition.id);
      assert.ok(Array.isArray(definition.effects), definition.id);
    }
  });
});
