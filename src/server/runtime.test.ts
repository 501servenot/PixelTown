import assert from "node:assert/strict";
import test from "node:test";
import { AGENT_ID } from "../shared/protocol";
import { WorldRuntime } from "./runtime";

test("world runtime exposes observations and validates commands", () => {
  const runtime = new WorldRuntime();
  const observation = runtime.observe(AGENT_ID);
  assert.equal(observation.agent.position.x, 5);
  assert.ok(observation.nearbyEntities.some((entity) => entity.id === "quest-board"));

  const inspected = runtime.executeCommand(AGENT_ID, { type: "inspect", entityId: "quest-board" });
  assert.equal(inspected.ok, true);
  assert.match(inspected.message, /任务公告板/);
  assert.equal(inspected.stateVersion, 1);

  const stale = runtime.executeCommand(AGENT_ID, { type: "move", direction: "east" }, undefined, 0);
  assert.equal(stale.ok, false);
  assert.match(stale.message, /重新观察/);

  const duplicate = runtime.executeCommand(
    AGENT_ID,
    { type: "move", direction: "east" },
    "request-1",
  );
  const replay = runtime.executeCommand(
    AGENT_ID,
    { type: "move", direction: "east" },
    "request-1",
  );
  assert.equal(duplicate.stateVersion, replay.stateVersion);

  const turn = runtime.runAgentTurn(AGENT_ID);
  assert.equal(turn.decision.agentId, AGENT_ID);
  assert.ok(turn.result.message.length > 0);
});
