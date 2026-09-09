import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { inView, type WorldBroadcast } from "./perception/observe";
import { WorldSimulation } from "./simulation";
import { placedPosition } from "./domain/entity";

function starter(): WorldSimulation {
  const world = new WorldSimulation();
  world.seedStarterChunk();
  return world;
}

describe("directional observe", () => {
  it("keeps a 90 degree cone in front of the observer", () => {
    const origin = { x: 10, y: 10 };
    assert.equal(inView(origin, { x: 13, y: 10 }, 8, "east"), true);
    assert.equal(inView(origin, { x: 12, y: 11 }, 8, "east"), true);
    assert.equal(inView(origin, { x: 10, y: 7 }, 8, "east"), false);
    assert.equal(inView(origin, { x: 7, y: 10 }, 8, "east"), false);
    assert.equal(inView(origin, { x: 10, y: 7 }, 8, "north"), true);
  });

  it("describes nearby entities and the verbs they actually offer", () => {
    const world = starter();
    const observation = world.observe("agent_001", { radius: 8, direction: "east" });
    assert.equal(observation.observerId, "agent_001");
    assert.equal(observation.direction, "east");
    const tree = observation.visible.find((entity) => entity.id === "tree_001");
    const john = observation.visible.find((entity) => entity.id === "npc_001");
    assert.ok(tree && john);
    assert.ok(tree.interactions.some((item) => item.type === "chop"));
    assert.equal(tree.interactions.find((item) => item.type === "chop")?.inRange, false);
    assert.ok(john.interactions.some((item) => item.type === "talk"));
    assert.ok(!tree.interactions.some((item) => item.type === "talk"));
  });

  it("does not list entities behind the facing cone", () => {
    const world = starter();
    const west = world.observe("agent_001", { radius: 8, direction: "west" });
    assert.equal(west.visible.some((entity) => entity.id === "tree_001"), false);
    assert.equal(west.visible.some((entity) => entity.id === "npc_001"), false);
  });

  it("rejects an interaction the target does not support", () => {
    const world = starter();
    world.submitCommand({ actorId: "agent_001", type: "move", payload: { x: 119, y: 85 } });
    world.tick();
    world.submitCommand({
      actorId: "agent_001",
      type: "interact",
      targetId: "tree_001",
      payload: { verb: "talk" },
    });
    const snapshot = world.tick();
    assert.ok(snapshot.rejected.some((item) => item.reason.includes("cannot talk")));
  });

  it("lets an agent chop a tree because the tree offers chop", () => {
    const world = starter();
    world.submitCommand({ actorId: "agent_001", type: "move", payload: { x: 119, y: 85 } });
    world.tick();
    world.submitCommand({
      actorId: "agent_001",
      type: "interact",
      targetId: "tree_001",
      payload: { verb: "chop", damage: 20 },
    });
    world.tick();
    assert.equal(world.getEntity("tree_001")?.attributes.health, 80);
  });

  it("broadcasts entity events to observers inside the radius", () => {
    const world = starter();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      payload: { damage: 15 },
    });
    world.tick();
    const agent = world.observe("agent_001", { radius: 8, direction: "all" });
    const player = world.observe("player_001", { radius: 8, direction: "all" });
    assert.ok(agent.broadcasts.some((item) => item.type === "entity_damaged" && item.targetId === "tree_001"));
    assert.ok(player.broadcasts.some((item) => item.message.includes("伤害")));
  });

  it("flushes public broadcasts once per tick and skips empty ticks", () => {
    const world = starter();
    const batches: WorldBroadcast[][] = [];
    world.subscribeBroadcast((batch) => batches.push(batch));

    world.tick();
    assert.equal(batches.length, 0);

    world.submitCommand({ actorId: "player_001", type: "attack", targetId: "tree_001", payload: { damage: 1 } });
    world.submitCommand({ actorId: "player_001", type: "attack", targetId: "tree_001", payload: { damage: 1 } });
    world.tick();
    assert.equal(batches.length, 1);
    assert.equal(batches[0]?.length, 2);
  });

  it("delivers talk text privately and does not broadcast it", () => {
    const world = starter();
    world.submitCommand({
      actorId: "agent_001",
      type: "talk",
      targetId: "player_001",
      payload: { text: "嘿，我是 Scout" },
    });
    world.tick();
    const player = world.observe("player_001", { radius: 8, direction: "all" });
    const bystander = world.observe("agent_001", { radius: 8, direction: "all" });
    assert.equal(player.said.length, 1);
    assert.equal(player.said[0]?.text, "嘿，我是 Scout");
    assert.equal(player.said[0]?.fromId, "agent_001");
    assert.equal(bystander.said.length, 0);
    assert.equal(player.broadcasts.some((item) => item.message.includes("嘿")), false);
    assert.equal(player.broadcasts.some((item) => item.type === "interaction_completed"), false);
    const again = world.observe("player_001", { radius: 8, direction: "all" });
    assert.equal(again.said.length, 1);
  });

  it("broadcasts a shout to every observer inside its larger radius", () => {
    const world = starter();
    world.spawn("agent.default", "agent_cross_chunk", placedPosition(135, 85));
    world.spawn("agent.default", "agent_far", placedPosition(150, 85));
    world.submitCommand({
      actorId: "agent_001",
      type: "shout",
      payload: { text: "大家注意，世界有动静" },
    });
    world.tick();
    const nearbyAgent = world.observe("agent_002", { radius: 1, direction: "all" });
    const nearbyPlayer = world.observe("player_001", { radius: 1, direction: "all" });
    const crossChunkAgent = world.observe("agent_cross_chunk", { radius: 1, direction: "all" });
    const farAgent = world.observe("agent_far", { radius: 1, direction: "all" });
    assert.ok(nearbyAgent.broadcasts.some((item) => item.type === "entity_shouted"));
    assert.ok(nearbyPlayer.broadcasts.some((item) => item.message.includes("大家注意")));
    assert.ok(crossChunkAgent.broadcasts.some((item) => item.type === "entity_shouted"));
    assert.equal(farAgent.broadcasts.some((item) => item.type === "entity_shouted"), false);
  });

  it("keeps public events only for their configured duration", () => {
    const world = starter();
    world.submitCommand({ actorId: "agent_001", type: "shout", payload: { text: "短暂呼喊" } });
    const started = world.tick();
    const broadcast = started.recentBroadcasts.find((item) => item.type === "entity_shouted");
    assert.equal(broadcast?.startedAtTick, 1);
    assert.equal(broadcast?.expiresAtTick, 21);

    for (let i = 0; i < 19; i += 1) world.tick();
    assert.equal(world.observe("agent_002", { direction: "all" }).broadcasts.some((item) => item.id === broadcast?.id), true);
    world.tick();
    assert.equal(world.observe("agent_002", { direction: "all" }).broadcasts.some((item) => item.id === broadcast?.id), false);
  });

  it("does not consume said on a plain observe", () => {
    const world = starter();
    world.submitCommand({
      actorId: "agent_001",
      type: "talk",
      targetId: "player_001",
      payload: { text: "先看一眼" },
    });
    world.tick();
    const peek = world.observe("player_001", { radius: 8, direction: "all" });
    const again = world.observe("player_001", { radius: 8, direction: "all" });
    assert.equal(peek.said.length, 1);
    assert.equal(again.said.length, 1);
    assert.equal(again.said[0]?.text, "先看一眼");
  });

  it("consumes said only when consumeSaid is true", () => {
    const world = starter();
    world.submitCommand({
      actorId: "agent_001",
      type: "talk",
      targetId: "player_001",
      payload: { text: "收走" },
    });
    world.tick();
    const taken = world.observe("player_001", { radius: 8, direction: "all", consumeSaid: true });
    const empty = world.observe("player_001", { radius: 8, direction: "all" });
    assert.equal(taken.said.length, 1);
    assert.equal(taken.said[0]?.text, "收走");
    assert.equal(empty.said.length, 0);
  });

  it("changes facing when observe is submitted with a cardinal direction", () => {
    const world = starter();
    assert.equal(world.getEntity("agent_001")?.state.facing, "east");
    world.submitCommand({ actorId: "agent_001", type: "observe", payload: { direction: "west" } });
    world.tick();
    const view = world.observe("agent_001");
    assert.equal(world.getEntity("agent_001")?.state.facing, "west");
    assert.equal(view.direction, "west");
    assert.equal(view.visible.some((entity) => entity.id === "agent_002"), true);
    assert.equal(view.visible.some((entity) => entity.id === "tree_001"), false);
  });

  it("rejects talk without text", () => {
    const world = starter();
    world.submitCommand({ actorId: "agent_001", type: "talk", targetId: "player_001" });
    const snapshot = world.tick();
    assert.ok(snapshot.rejected.some((item) => item.reason.includes("talk requires text")));
  });

  it("does not deliver a broadcast to an observer outside its radius", () => {
    const world = starter();
    world.submitCommand({
      actorId: "agent_001",
      type: "move",
      payload: { x: 0, y: 0 },
    });
    world.tick();
    world.submitCommand({
      actorId: "player_001",
      type: "attack",
      targetId: "tree_001",
      payload: { damage: 10 },
    });
    world.tick();
    const far = world.observe("agent_001", { radius: 8, direction: "all" });
    assert.equal(far.self.position.x, 0);
    assert.equal(
      far.broadcasts.some((item) => item.type === "entity_damaged" && item.targetId === "tree_001"),
      false,
    );
  });
});
