/**
 * Keep one body online: wander, and chat occasionally with the other agent.
 *
 *   AGENT_API_KEY=sk_local_scout node tools/agent-live.mjs
 *   AGENT_API_KEY=sk_local_rover node tools/agent-live.mjs
 */
import WebSocket from "ws";

const KEY = process.env.AGENT_API_KEY ?? "sk_local_scout";
const BASE = process.env.PIXELTOWN_URL ?? "http://127.0.0.1:3001";
const EXPLORE_MS = Number(process.env.AGENT_EXPLORE_MS ?? 8000);
const TALK_COOLDOWN_MS = Number(process.env.AGENT_TALK_COOLDOWN_MS ?? 45_000);
const WS_URL = `${BASE.replace(/^http/, "ws")}/ws/agent`;
const DIRS = ["east", "south", "west", "north"];
const STEP = { east: { dx: 1, dy: 0 }, south: { dx: 0, dy: 1 }, west: { dx: -1, dy: 0 }, north: { dx: 0, dy: -1 } };

let lastTurn = null;
let busy = false;
let lastTalkAt = 0;
let heading = "east";
let steps = 0;

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

async function post(body) {
  const response = await fetch(`${BASE}/v1/agent`, {
    method: "POST",
    headers: { authorization: `Bearer ${KEY}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(`${response.status} ${JSON.stringify(result)}`);
  lastTurn = result;
  return result;
}

function talkable(turn) {
  return (turn.see ?? []).find(
    (item) => item.kind === "agent" && item.youCan?.some((verb) => verb.verb === "talk" && verb.inRange),
  );
}

function remark(turn, buddy) {
  const landmark = (turn.see ?? []).find((item) => item.kind === "object" || item.kind === "npc" || item.kind === "item");
  if (landmark) return `${buddy.name}，那边有${landmark.name}。`;
  if (steps > 8) return `${buddy.name}，我们换个方向吧。`;
  return `${buddy.name}，我往${heading === "east" ? "东" : heading === "west" ? "西" : heading === "south" ? "南" : "北"}走。`;
}

function replyTo(line, turn) {
  const landmark = (turn.see ?? []).find((item) => item.kind === "object" || item.kind === "npc" || item.kind === "item");
  if (landmark) return `${line.name}，我看到${landmark.name}了。`;
  return `${line.name}，好，我跟上。`;
}

function shouldStartTalk(turn) {
  if (Date.now() - lastTalkAt < TALK_COOLDOWN_MS) return false;
  const me = turn.you?.id ?? "";
  const buddy = talkable(turn);
  if (!buddy) return false;
  return me < buddy.id;
}

function wanderIntent(turn) {
  const chop = turn.see?.find((item) => item.youCan?.some((verb) => verb.verb === "chop" && verb.inRange));
  if (chop) return { think: "树在范围内", do: "use", target: chop.id, verb: "chop", expect: chop.version };
  const pickup = turn.see?.find((item) => item.youCan?.some((verb) => verb.verb === "pickup" && verb.inRange));
  if (pickup) return { think: "地上有东西", do: "use", target: pickup.id, verb: "pickup", expect: pickup.version };
  if ((turn.see ?? []).filter((item) => item.kind !== "agent").length === 0 && steps % 5 === 4) {
    heading = DIRS[(DIRS.indexOf(heading) + 1) % 4];
    return { think: "前面空了，转弯", do: "look", direction: heading };
  }
  if (steps > 0 && steps % 6 === 0) {
    heading = DIRS[(DIRS.indexOf(heading) + (steps % 2 === 0 ? 1 : 3)) % 4];
  }
  return { think: "继续走", do: "move", by: STEP[heading] };
}

function decide(turn) {
  const said = turn.said ?? [];
  if (said.length && Date.now() - lastTalkAt >= 8_000) {
    const line = said[said.length - 1];
    return { think: "回同伴一句", do: "use", target: line.from, verb: "talk", text: replyTo(line, turn) };
  }
  if (shouldStartTalk(turn)) {
    const buddy = talkable(turn);
    return { think: "跟同伴说一声眼前的事", do: "use", target: buddy.id, verb: "talk", text: remark(turn, buddy) };
  }
  return wanderIntent(turn);
}

async function actFrom(turn, reason) {
  if (busy || !turn) return;
  busy = true;
  try {
    const intent = process.env.PIXELTOWN_LLM_URL ? await thinkWithLlm(turn) : decide(turn);
    const next = await post(intent);
    if (intent.do === "use" && intent.verb === "talk") lastTalkAt = Date.now();
    if (intent.do === "move") steps += 1;
    if (intent.do === "look" && DIRS.includes(intent.direction)) heading = intent.direction;
    log(reason, intent.do, intent.verb ?? intent.direction ?? intent.by, intent.text ?? "", next.you && `(${next.you.x},${next.you.y})`, next.last);
  } catch (error) {
    log("act failed", error instanceof Error ? error.message : error);
  } finally {
    busy = false;
  }
}

async function thinkWithLlm(turn) {
  const allowTalk = Date.now() - lastTalkAt >= TALK_COOLDOWN_MS;
  const response = await fetch(process.env.PIXELTOWN_LLM_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${process.env.PIXELTOWN_LLM_KEY ?? ""}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.PIXELTOWN_LLM_MODEL ?? "gpt-4o-mini",
      messages: [
        {
          role: "system",
          content: allowTalk
            ? "You are a PixelTown body. Reply with only JSON { think?, do }. Wander. Talk only if said is not empty or you see another agent, one short new sentence."
            : "You are a PixelTown body. Reply with only JSON { think?, do }. Do not talk. look, move, or use chop/pickup.",
        },
        { role: "user", content: JSON.stringify(turn) },
      ],
      response_format: { type: "json_object" },
    }),
  });
  const payload = await response.json();
  return JSON.parse(payload.choices?.[0]?.message?.content ?? "{}");
}

function connect() {
  const socket = new WebSocket(WS_URL, { headers: { authorization: `Bearer ${KEY}` } });
  socket.on("open", () => log("online", KEY, WS_URL));
  socket.on("close", () => {
    log("socket closed, reconnecting");
    setTimeout(connect, 2000);
  });
  socket.on("error", (error) => log("socket error", error.message));
  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    if (message.type === "session" || message.type === "turn") {
      lastTurn = message.turn ?? message;
      return;
    }
    if (message.type === "said" && Date.now() - lastTalkAt >= 8_000) {
      void (async () => {
        const turn = await post({ do: "look" });
        await actFrom(turn, "said");
      })();
    }
  });
}

async function exploreOnce(reason) {
  if (busy) return;
  const turn = await post({ do: "look", direction: heading });
  await actFrom(turn, reason);
}

connect();
void exploreOnce("hello");
setInterval(() => {
  void exploreOnce("explore");
}, EXPLORE_MS);

log("live host starting");
