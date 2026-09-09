import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { EntityCatalog, loadEntityCatalog } from "./state/catalog";
import { placedPosition, type EntityDefinition } from "./domain/entity";
import { MAX_EVENT_DEPTH } from "./domain/event";
import { WorldSimulation } from "./simulation";

function starter(): WorldSimulation {
  const world = new WorldSimulation();
  world.seedStarterChunk();
  return world;
}

function relayNpc(id: string): EntityDefinition {
  return {
    id,
    version: 1,
    type: "npc",
    name: id,
    attributes: { health: 50, maxHealth: 50, energy: 10, speed: 1 },
    state: { status: "alive", activity: "idle", targetId: null },
    interaction: { enabled: true, range: 1, actions: [] },
    effects: [{ trigger: "alerted", type: "alert", radius: 3 }],
  };
}

describe("entity catalog", () => {
  it("loads npc / animal / object definitions from disk", () => {
    const catalog = loadEntityCatalog();
    assert.ok(catalog.get("agent.default"));
    assert.equal(catalog.get("agent.scout"), undefined);
    assert.equal(catalog.get("agent.rover"), undefined);
    assert.ok(catalog.get("npc.john"));
    assert.ok(catalog.get("animal.cat"));
    assert.ok(catalog.get("object.tree"));
    assert.equal(catalog.get("npc.john")?.type, "npc");
  });
});

describe("world simulation v0.1", () => {
  it("rejects stale actor versions and expired commands", () => {
    const world = starter();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { dx: 1, dy: 0 }, expectedActorVersion: 1 });
    world.tick();
    world.submitCommand({ actorId: "player_001", type: "move", payload: { dx: 1, dy: 0 }, expectedActorVersion: 1 });
    world.submitCommand({ actorId: "player_001", type: "move", payload: { dx: 1, dy: 0 }, expiresAtTick: world.tickCount });
    const snapshot = world.tick();
    assert.ok(snapshot.rejected.some((item) => item.reason.startsWith("stale actor version")));
    assert.ok(snapshot.rejected.some((item) => item.reason.startsWith("expired")));
  });

  it("admits a visitor agent with its own name", () => {
    const world = starter();
    const visitor = world.admitVisitor("Ada");
    assert.equal(visitor.type, "agent");
    assert.equal(visitor.name, "Ada");
    assert.equal(visitor.definitionId, "agent.default");
    assert.ok(world.getEntity(visitor.id));
  });

  it("creates player, npc and tree inside the same chunk", () => {
    const world = starter();
    const player = world.getEntity("player_001");
    const npc = world.getEntity("npc_001");
    const tree = world.getEntity("tree_001");
    assert.ok(player && npc && tree);
    assert.equal(player.position.chunkId, "chunk_1_1");
    assert.equal(npc.position.chunkId, "chunk_1_1");
    assert.equal(tree.position.chunkId, "chunk_1_1");
    assert.equal(world.getSnapshot().chunkCount, 1);
  });

  it("moves a player and writes a new position", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "move",
      payload: { x: 118, y: 85 },
    });
    const snapshot = world.tick();
    const player = world.getEntity("player_001");
    assert.equal(player?.position.x, 118);
    assert.equal(player?.position.y, 85);
    assert.equal(player?.position.chunkId, "chunk_1_1");
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_moved" && event.targetId === "player_001"));
  });

  it("reassigns an entity when it crosses a chunk boundary", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "move",
      payload: { x: 63, y: 85 },
    });
    world.tick();
    const player = world.getEntity("player_001");
    assert.equal(player?.position.chunkId, "chunk_0_1");
    assert.equal(world.getSnapshot().chunkCount, 2);
  });

  it("lets a player chop a tree and reduce its health", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      expectedVersion: 1,
      payload: { damage: 20 },
    });
    world.tick();
    const tree = world.getEntity("tree_001");
    assert.equal(tree?.attributes.health, 80);
    assert.equal(tree?.version, 2);
  });

  it("emits entity_damaged when a tree is hit", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      payload: { damage: 20 },
    });
    const snapshot = world.tick();
    const damaged = snapshot.recentEvents.find((event) => event.type === "entity_damaged");
    assert.ok(damaged);
    assert.equal(damaged.targetId, "tree_001");
    assert.equal(damaged.sourceId, "player_001");
    assert.equal(damaged.payload?.damage, 20);
  });

  it("alerts a nearby npc after the tree is damaged", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      payload: { damage: 20 },
    });
    const snapshot = world.tick();
    const npc = world.getEntity("npc_001");
    assert.equal(npc?.state.activity, "alert");
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_state_changed" && event.targetId === "npc_001"));
  });

  it("rejects a command that uses a stale entity version", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      payload: { damage: 10 },
    });
    world.tick();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      expectedVersion: 1,
      payload: { damage: 10 },
    });
    const snapshot = world.tick();
    assert.equal(world.getEntity("tree_001")?.attributes.health, 90);
    assert.ok(snapshot.rejected.some((item) => item.reason.includes("stale version")));
  });

  it("applies 100 sequential attacks without losing health or racing", () => {
    const world = starter();
    for (let i = 0; i < 100; i += 1) {
      world.submitCommand({
        id: `cmd_atk_${i}`,
        actorId: "player_001",
        type: "attack",
        targetId: "tree_001",
        payload: { damage: 1 },
        timestamp: i,
      });
    }
    const snapshot = world.tick();
    assert.equal(world.getEntity("tree_001"), undefined);
    const damages = snapshot.recentEvents.filter((event) => event.type === "entity_damaged");
    assert.equal(damages.length, 100);
    assert.equal(damages.at(-1)?.payload?.health, 0);
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_destroyed" && event.targetId === "tree_001"));
    assert.equal(snapshot.rejected.length, 0);
  });

  it("keeps event depth bounded when alerts cascade", () => {
    const catalog = new EntityCatalog();
    catalog.add({
      id: "player.default",
      version: 1,
      type: "player",
      name: "P",
      attributes: { health: 10, speed: 1 },
      state: { status: "alive", activity: "idle", targetId: null },
      interaction: {
        enabled: true,
        range: 3,
        actions: [{ type: "attack", targetTypes: ["object"] }],
      },
      effects: [],
    });
    catalog.add({
      id: "object.tree",
      version: 1,
      type: "object",
      name: "T",
      attributes: { health: 10, maxHealth: 10 },
      state: { status: "alive", activity: "idle", targetId: null },
      interaction: {
        enabled: true,
        range: 2,
        actions: [{ type: "chop", targetTypes: ["player"] }],
      },
      effects: [],
    });
    for (const id of ["npc.a", "npc.b", "npc.c", "npc.d"]) catalog.add(relayNpc(id));

    const world = new WorldSimulation({ catalog });
    world.spawn("player.default", "player_001", placedPosition(10, 10));
    world.spawn("object.tree", "tree_001", placedPosition(11, 10));
    world.spawn("npc.a", "npc_a", placedPosition(12, 10));
    world.spawn("npc.b", "npc_b", placedPosition(15, 10));
    world.spawn("npc.c", "npc_c", placedPosition(18, 10));
    world.spawn("npc.d", "npc_d", placedPosition(21, 10));

    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      payload: { damage: 10 },
    });
    const snapshot = world.tick();
    const depths = snapshot.recentEvents.map((event) => event.depth);
    assert.ok(Math.max(...depths) <= MAX_EVENT_DEPTH);
    assert.equal(world.getEntity("npc_a")?.state.activity, "alert");
    assert.equal(world.getEntity("npc_b")?.state.activity, "alert");
    assert.equal(world.getEntity("npc_c")?.state.activity, "alert");
    assert.equal(world.getEntity("npc_d")?.state.activity, "alert");
    assert.ok(snapshot.recentEvents.some((event) => event.type === "entity_state_changed" && event.depth >= 3));
  });

  it("talks to John and uses spatial query for nearby entities", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "talk",
      targetId: "npc_001",
      payload: { text: "你好，John" },
    });
    const snapshot = world.tick();
    assert.ok(snapshot.recentEvents.some((event) => event.type === "interaction_completed"));
    const nearby = world.getNearbyEntities({ x: 120, y: 85 }, 3);
    assert.ok(nearby.some((entity) => entity.id === "npc_001"));
    assert.ok(nearby.some((entity) => entity.id === "tree_001"));
  });
});
