const KEY = process.env.AGENT_API_KEY ?? "sk_local_scout";
const BASE = process.env.PIXELTOWN_URL ?? "http://127.0.0.1:3001";

async function act(body) {
  const response = await fetch(`${BASE}/v1/agent`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(result)}`);
  return result;
}

let turn = await act({});
console.log("enter", turn.turn, turn.you, turn.next);

for (const reply of [
  { think: "先向东走一步靠近树", do: "move", by: { dx: 1, dy: 0 } },
  { think: "再看东面能对谁做什么", do: "look", direction: "east" },
]) {
  turn = await act(reply);
  console.log("turn", turn.turn, {
    last: turn.last,
    you: { x: turn.you.x, y: turn.you.y, facing: turn.you.facing },
    see: turn.see.map((item) => item.id),
  });
}
