import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { AgentKeyStore, parseAgentKeys, readApiKey } from "./auth";
import { AgentSessionStore } from "./agent-session";

describe("agent API keys", () => {
  it("parses key:actorId lists", () => {
    const entries = parseAgentKeys("sk_local_scout:agent_001, sk_local_player:player_001:Player");
    assert.deepEqual(entries, [
      { key: "sk_local_scout", actorId: "agent_001", name: "agent_001" },
      { key: "sk_local_player", actorId: "player_001", name: "Player" },
    ]);
  });

  it("parses JSON maps", () => {
    const entries = parseAgentKeys(JSON.stringify({ sk_a: { actorId: "agent_001", name: "Scout" } }));
    assert.deepEqual(entries, [{ key: "sk_a", actorId: "agent_001", name: "Scout" }]);
  });

  it("binds a key to one actor and rejects the rest", () => {
    const store = new AgentKeyStore(parseAgentKeys("sk_local_scout:agent_001"));
    assert.equal(store.lookup("sk_local_scout")?.actorId, "agent_001");
    assert.equal(store.lookup("sk_wrong"), undefined);
    assert.equal(store.lookup(""), undefined);
  });

  it("reads Bearer and X-API-Key", () => {
    assert.equal(readApiKey({ get: (name) => (name === "authorization" ? "Bearer sk_abc" : null) }), "sk_abc");
    assert.equal(readApiKey({ "x-api-key": "sk_abc" }), "sk_abc");
  });

  it("issues a session token bound to one actor", () => {
    const store = new AgentSessionStore();
    const session = store.open("agent_001");
    assert.equal(session.actorId, "agent_001");
    assert.equal(store.lookup(session.token)?.id, session.id);
    assert.equal(store.nextTurn(session), 1);
    assert.equal(store.nextTurn(session), 2);
    assert.equal(store.lookup("sk_local_scout"), undefined);
    store.close(session);
    assert.equal(store.lookup(session.token), undefined);
  });

  it("can issue and revoke a joined visitor key", () => {
    const store = new AgentKeyStore();
    store.add({ key: "sk_join_test", actorId: "agent_guest_1", name: "Ada" });
    assert.equal(store.lookup("sk_join_test")?.name, "Ada");
    store.revokeActor("agent_guest_1");
    assert.equal(store.lookup("sk_join_test"), undefined);
  });

  it("resumes the same session for the same actor", () => {
    const store = new AgentSessionStore();
    const first = store.resume("agent_001");
    store.nextTurn(first);
    const again = store.resume("agent_001");
    assert.equal(again.id, first.id);
    assert.equal(again.turn, 1);
  });
});
