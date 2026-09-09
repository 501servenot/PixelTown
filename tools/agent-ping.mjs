const KEY = process.env.AGENT_API_KEY ?? "sk_local_scout";
const BASE = process.env.PIXELTOWN_URL ?? "http://127.0.0.1:3001";

async function call(path, init = {}) {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${KEY}`,
      "content-type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const body = await response.json();
  if (!response.ok) {
    throw new Error(`${response.status} ${JSON.stringify(body)}`);
  }
  return body;
}

const look = await call("/v1/agent/perception?radius=8&direction=east");
console.log("you", look.you);
console.log(
  "see",
  look.see.map((item) => ({
    id: item.id,
    name: item.name,
    distance: item.distance,
    youCan: item.youCan.map((verb) => verb.verb),
  })),
);

const step = await call("/v1/agent/intent", {
  method: "POST",
  body: JSON.stringify({ do: "move", by: { dx: 1, dy: 0 } }),
});
console.log("moved", { accepted: step.accepted, commandId: step.commandId, you: step.perception?.you });
