import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { WorldSimulation } from "../world";
import { isAgentIntent, parseAgentReply } from "../shared/agent-io";
import { toCommand, toPerception, toTurn } from "./agent-adapter";

function starter(): WorldSimulation {
  const world = new WorldSimulation();
  world.seedStarterChunk();
  return world;
}

describe("agent adapter", () => {
  it("turns a world observation into Agent perception", () => {
    const world = starter();
    const view = toPerception(world.observe("agent_001", { radius: 8, direction: "east" }));
    assert.equal(view.ok, true);
    assert.equal(view.you.id, "agent_001");
    assert.equal(view.you.x, 118);
    assert.equal(view.you.facing, "east");
    const tree = view.see.find((entity) => entity.id === "tree_001");
    assert.ok(tree);
    assert.ok(tree.youCan.some((item) => item.verb === "chop" && item.inRange === false));
    assert.deepEqual(view.canDo, ["look", "face", "move", "shout", "use"]);
    assert.deepEqual(view.said, []);
  });

  it("translates Agent intents into world commands", () => {
    assert.deepEqual(toCommand("agent_001", { do: "look", direction: "east" }), {
      kind: "look",
      radius: undefined,
      direction: "east",
    });
    assert.deepEqual(toCommand("agent_001", { do: "face", direction: "west" }), {
      kind: "act",
      command: { actorId: "agent_001", type: "observe", payload: { direction: "west" } },
    });
    assert.deepEqual(toCommand("agent_001", { do: "move", by: { dx: 1, dy: 0 } }), {
      kind: "act",
      command: { actorId: "agent_001", type: "move", payload: { dx: 1, dy: 0 } },
    });
    assert.deepEqual(toCommand("agent_001", { do: "shout", text: "大家注意" }), {
      kind: "act",
      command: { actorId: "agent_001", type: "shout", payload: { text: "大家注意" } },
    });
    assert.deepEqual(toCommand("agent_001", { do: "use", target: "tree_001", verb: "chop", expect: 2 }), {
      kind: "act",
      command: {
        actorId: "agent_001",
        type: "interact",
        targetId: "tree_001",
        expectedVersion: 2,
        payload: { verb: "chop" },
      },
    });
    assert.deepEqual(toCommand("agent_001", { do: "use", target: "player_001", verb: "talk", text: "你好" }), {
      kind: "act",
      command: {
        actorId: "agent_001",
        type: "interact",
        targetId: "player_001",
        expectedVersion: undefined,
        payload: { verb: "talk", text: "你好" },
      },
    });
  });

  it("accepts only the four Agent verbs", () => {
    assert.equal(isAgentIntent({ do: "look" }), true);
    assert.equal(isAgentIntent({ do: "move", to: { x: 119, y: 85 } }), true);
    assert.equal(isAgentIntent({ do: "shout", text: "大家注意" }), true);
    assert.equal(isAgentIntent({ do: "attack", target: "tree_001" }), false);
    assert.equal(isAgentIntent({ type: "command", commandType: "move" }), false);
  });

  it("passes action freshness metadata to the world command", () => {
    assert.deepEqual(toCommand("agent_001", { do: "move", by: { dx: 1, dy: 0 }, basedOnTick: 9, expectSelf: 3, expiresAtTick: 12 }), {
      kind: "act",
      command: { actorId: "agent_001", type: "move", payload: { dx: 1, dy: 0 }, basedOnTick: 9, expectedActorVersion: 3, expiresAtTick: 12 },
    });
  });

  it("parses structured Agent replies including think and fenced JSON", () => {
    const moved = parseAgentReply({ think: "走近树", do: "move", by: { dx: 1, dy: 0 } });
    assert.equal(moved?.think, "走近树");
    assert.deepEqual(moved?.intent, { do: "move", by: { dx: 1, dy: 0 } });
    const fenced = parseAgentReply('```json\n{"do":"look","direction":"east"}\n```');
    assert.deepEqual(fenced?.intent, { do: "look", direction: "east" });
    assert.equal(parseAgentReply({ do: "attack", target: "tree_001" }), undefined);
  });

  it("wraps perception as a numbered turn", () => {
    const world = starter();
    const turn = toTurn(toPerception(world.observe("agent_001")), {
      sessionId: "sess_1",
      turn: 1,
      last: { accepted: true },
    });
    assert.equal(turn.type, "turn");
    assert.equal(turn.reply, "intent");
    assert.equal(turn.turn, 1);
    assert.equal(turn.you.id, "agent_001");
    assert.equal(turn.priority, "idle");
  });
});
