import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentEventBox } from "./agent-event-box";

describe("agent event box", () => {
  it("summarizes repeated heard events and expires them", () => {
    const box = new AgentEventBox();
    const base = { id: "e1", tick: 2, type: "entity_shouted", text: "注意", priority: 1, startedAtTick: 2, expiresAtTick: 4, about: "a" };
    box.enqueueHeard("a", base);
    box.enqueueHeard("a", { ...base, id: "e2" });
    assert.equal(box.read("a", 3, false).heard[0].count, 2);
    assert.deepEqual(box.read("a", 4, false).heard, []);
  });
});
