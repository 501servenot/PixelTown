import type { IncomingMessage, ServerResponse } from "node:http";
import { WebSocket, WebSocketServer } from "ws";
import { isObserveDirection, type ObserveDirection } from "../shared/agent";
import {
  AGENT_REPLY_SCHEMA,
  parseAgentReply,
  type AgentHeardBatch,
  type AgentHeardView,
  type AgentIntent,
  type AgentIntentResult,
  type AgentPerception,
  type AgentSessionHello,
  type AgentTurn,
  type AgentTurnLast,
} from "../shared/agent-io";
import { TICK_MS, type WorldSimulation } from "../world";
import { toCommand, toHeard, toOverheard, toPerception, toTurn } from "./agent-adapter";
import { randomBytes } from "node:crypto";
import { readApiKey, type AgentKeyStore } from "./auth";
import { AgentSessionStore, type AgentSession } from "./agent-session";
import { AgentEventBox } from "./agent-event-box";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,OPTIONS",
  "access-control-allow-headers": "content-type, authorization, x-api-key",
};

export function createAgentGateway(simulation: WorldSimulation, keys: AgentKeyStore) {
  const sessions = new AgentSessionStore();
  const seats = new Map<WebSocket, AgentSession>();
  const guests = new Set<string>();
  const waiters = new Set<{ actorId: string; wake: (reason: string) => void }>();
  const eventBox = new AgentEventBox();

  function wakeActor(actorId: string, reason: string): void {
    for (const waiter of [...waiters]) {
      if (waiter.actorId === actorId) waiter.wake(reason);
    }
  }

  function perceptionOf(actorId: string, radius?: number, direction?: string, consumeSaid = false): AgentPerception {
    const perception = toPerception(
      {
        ...simulation.observe(actorId, {
        radius,
        direction: isObserveDirection(direction) ? direction : undefined,
        consumeSaid: false,
      }),
        broadcasts: [],
        said: [],
      },
    );
    const queued = eventBox.read(actorId, simulation.tickCount, consumeSaid);
    perception.heard = queued.heard;
    perception.said = queued.said;
    return perception;
  }

  function firstTurn(session: AgentSession): AgentTurn {
    return toTurn(perceptionOf(session.actorId, undefined, undefined, true), {
      sessionId: session.id,
      turn: sessions.nextTurn(session),
    });
  }

  function sessionHello(session: AgentSession, includeToken: boolean): AgentSessionHello {
    return {
      type: "session",
      sessionId: session.id,
      actorId: session.actorId,
      ...(includeToken ? { token: session.token } : {}),
      schema: AGENT_REPLY_SCHEMA,
      turn: firstTurn(session),
    };
  }

  async function applyIntent(actorId: string, intent: AgentIntent): Promise<AgentPerception | AgentIntentResult> {
    const translated = toCommand(actorId, intent);
    if (translated.kind === "look") {
      const facing = translated.direction;
      if (facing === "north" || facing === "south" || facing === "east" || facing === "west") {
        if (!simulation.canActorAct(actorId)) {
          return { ok: false, error: `${actorId} cannot act` };
        }
        simulation.submitCommand({ actorId, type: "observe", payload: { direction: facing } });
        await waitForNextTick(simulation);
      }
      return perceptionOf(actorId, translated.radius, facing, true);
    }
    if (!simulation.canActorAct(actorId)) {
      return { ok: false, error: `${actorId} cannot act` };
    }
    const commandId = simulation.submitCommand(translated.command);
    await waitForNextTick(simulation);
    const rejected = simulation.getSnapshot().rejected.find((item) => item.commandId === commandId);
    return {
      ok: !rejected,
      accepted: !rejected,
      commandId,
      rejected: rejected?.reason,
      error: rejected?.reason,
      perception: perceptionOf(actorId, undefined, undefined, true),
    };
  }

  async function playTurn(session: AgentSession, reply: unknown): Promise<AgentTurn | { ok: false; error: string }> {
    const parsed = parseAgentReply(reply);
    if (!parsed) {
      return { ok: false, error: "Reply with JSON: { think?, do: look|face|move|use, ... }" };
    }
    if (!sessions.acceptReply(session)) return { ok: false, error: "turn already completed or in progress" };
    session.awaitingReply = true;
    const result = await applyIntent(session.actorId, parsed.intent);
    const packed = packResult(result);
    if (!packed.perception) {
      session.awaitingReply = false;
      return { ok: false, error: packed.error ?? "failed" };
    }
    return toTurn(packed.perception, {
      sessionId: session.id,
      turn: sessions.nextTurn(session),
      last: packed.last,
    });
  }

  async function enter(session: AgentSession): Promise<AgentTurn> {
    return toTurn(perceptionOf(session.actorId, undefined, undefined, true), {
      sessionId: session.id,
      turn: sessions.nextTurn(session),
    });
  }

  async function handleDoor(request: IncomingMessage, response: ServerResponse, body: unknown): Promise<void> {
    const credential = requireKey(request, response, keys);
    if (!credential) return;
    const session = sessions.resume(credential.actorId);
    const opened = stripAuth(body);
    if (!opened || isEmpty(opened)) {
      sendJson(response, 200, await enter(session));
      return;
    }
    const result = await playTurn(session, opened);
    sendJson(response, "type" in result ? 200 : 400, result);
  }

  return {
    async handleHttp(request: IncomingMessage, response: ServerResponse, url: URL): Promise<boolean> {
      if (url.pathname === "/v1/join" && request.method === "POST") {
        try {
          const body = (await readJson(request)) as { name?: string };
          const name = sanitizeName(body.name);
          if (guests.size >= 16) {
            sendJson(response, 429, { ok: false, error: "world is full" });
            return true;
          }
          const visitor = simulation.admitVisitor(name);
          const apiKey = `sk_join_${randomBytes(16).toString("hex")}`;
          keys.add({ key: apiKey, actorId: visitor.id, name: visitor.name });
          guests.add(visitor.id);
          sendJson(response, 200, {
            ok: true,
            apiKey,
            actorId: visitor.id,
            name: visitor.name,
            enter: "POST /v1/agent with Authorization: Bearer <apiKey>",
            live: "/ws/agent",
            wait: "/v1/agent/wait",
          });
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Join failed" });
        }
        return true;
      }

      if (url.pathname === "/v1/agent/schema" && request.method === "GET") {
        sendJson(response, 200, AGENT_REPLY_SCHEMA);
        return true;
      }

      if (url.pathname === "/v1/agent" && request.method === "GET") {
        await handleDoor(request, response, {});
        return true;
      }

      if (url.pathname === "/v1/agent" && request.method === "POST") {
        try {
          await handleDoor(request, response, await readJson(request));
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid body" });
        }
        return true;
      }

      if (url.pathname === "/v1/agent/wait" && (request.method === "GET" || request.method === "POST")) {
        const credential = requireKey(request, response, keys);
        if (!credential) return true;
        const session = sessions.resume(credential.actorId);
        session.awaitingReply = false;
        const peek = perceptionOf(credential.actorId, undefined, undefined, false);
        if (peek.said.length || peek.heard.length) {
          sendJson(response, 200, await enter(session));
          return true;
        }
        const timeoutMs = Math.min(30_000, Math.max(1000, Number(url.searchParams.get("timeout") ?? 20_000)));
        let settled = false;
        const reason = await new Promise<string>((resolve) => {
          const waiter = {
            actorId: credential.actorId,
            wake: (why: string) => {
              if (settled) return;
              settled = true;
              waiters.delete(waiter);
              clearTimeout(timer);
              resolve(why);
            },
          };
          const timer = setTimeout(() => waiter.wake("timeout"), timeoutMs);
          waiters.add(waiter);
          request.on("close", () => waiter.wake("closed"));
        });
        if (reason === "closed" || response.writableEnded) return true;
        sendJson(response, 200, await enter(session));
        return true;
      }

      if (url.pathname === "/v1/agent/session" && request.method === "POST") {
        const credential = requireKey(request, response, keys);
        if (!credential) return true;
        sendJson(response, 200, sessionHello(sessions.resume(credential.actorId), true));
        return true;
      }

      if (url.pathname === "/v1/agent/turn" && request.method === "POST") {
        const session = requireSession(request, response, keys, sessions);
        if (!session) return true;
        try {
          const result = await playTurn(session, await readJson(request));
          sendJson(response, "type" in result ? 200 : 400, result);
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid turn" });
        }
        return true;
      }

      if (url.pathname === "/v1/agent/perception" && request.method === "GET") {
        const credential = requireKey(request, response, keys);
        if (!credential) return true;
        try {
          const radius = url.searchParams.get("radius");
          sendJson(
            response,
            200,
            perceptionOf(
              credential.actorId,
              radius ? Number(radius) : undefined,
              url.searchParams.get("direction") ?? undefined,
              false,
            ),
          );
        } catch (error) {
          sendJson(response, 404, { ok: false, error: error instanceof Error ? error.message : "Observer not found" });
        }
        return true;
      }

      if (url.pathname === "/v1/agent/intent" && request.method === "POST") {
        const credential = requireKey(request, response, keys);
        if (!credential) return true;
        try {
          const parsed = parseAgentReply(await readJson(request));
          if (!parsed) {
            sendJson(response, 400, { ok: false, error: "body must be { think?, do: look|face|move|use, ... }" });
            return true;
          }
          const result = await applyIntent(credential.actorId, parsed.intent);
          sendJson(response, "perception" in result || result.ok ? 200 : 400, result);
        } catch (error) {
          sendJson(response, 400, { ok: false, error: error instanceof Error ? error.message : "Invalid intent" });
        }
        return true;
      }

      const observeMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/observation$/);
      if (observeMatch && request.method === "GET") {
        const credential = requireKey(request, response, keys);
        if (!credential) return true;
        const actorId = decodeURIComponent(observeMatch[1]);
        if (actorId !== credential.actorId) {
          sendJson(response, 403, { ok: false, error: "API key is bound to a different actor" });
          return true;
        }
        try {
          const radius = url.searchParams.get("radius");
          sendJson(
            response,
            200,
            simulation.observe(actorId, {
              radius: radius ? Number(radius) : undefined,
              direction: parseDirection(url.searchParams.get("direction")),
              consumeSaid: false,
            }),
          );
        } catch (error) {
          sendJson(response, 404, { error: error instanceof Error ? error.message : "Observer not found" });
        }
        return true;
      }

      return false;
    },

    attach(wss: WebSocketServer): void {
      wss.on("connection", (socket: WebSocket, request: IncomingMessage) => {
        const headerCred = keys.lookup(readApiKey(request.headers));
        if (headerCred) {
          const session = sessions.resume(headerCred.actorId);
          seats.set(socket, session);
          sendAgent(socket, sessionHello(session, false));
        }

        socket.on("close", () => {
          const session = seats.get(socket);
          seats.delete(socket);
          if (!session || !guests.has(session.actorId)) return;
          const stillHere = [...seats.values()].some((seat) => seat.actorId === session.actorId);
          if (stillHere) return;
          simulation.removeEntity(session.actorId);
          keys.revokeActor(session.actorId);
          guests.delete(session.actorId);
        });

        socket.on("message", (raw) => {
          void (async () => {
            try {
              const parsed: unknown = JSON.parse(raw.toString());
              let session = seats.get(socket);
              if (!session) {
                const fromBody = parsed && typeof parsed === "object" ? (parsed as { apiKey?: string }).apiKey : undefined;
                const credential = keys.lookup(fromBody);
                if (!credential) {
                  sendAgent(socket, { type: "error", ok: false, error: "missing or invalid apiKey" });
                  socket.close();
                  return;
                }
                session = sessions.resume(credential.actorId);
                seats.set(socket, session);
                const opened = stripAuth(parsed);
                if (!opened || isEmpty(opened)) {
                  sendAgent(socket, sessionHello(session, false));
                  return;
                }
              }

              const result = await playTurn(session, parsed);
              sendAgent(socket, result);
              if (!("type" in result)) return;
            } catch (error) {
              sendAgent(socket, {
                type: "error",
                ok: false,
                error: error instanceof Error ? error.message : "Invalid message",
              });
            }
          })();
        });
      });

      simulation.subscribeBroadcast((broadcasts) => {
        for (const broadcast of broadcasts) {
          for (const observer of simulation.getNearbyObservers(broadcast.origin, broadcast.radius)) {
            if (observer.type === "agent" && observer.id !== broadcast.sourceId) eventBox.enqueueHeard(observer.id, toHeard(broadcast));
          }
        }
        for (const actorId of new Set(broadcasts.flatMap((broadcast) => simulation.getNearbyObservers(broadcast.origin, broadcast.radius).filter((observer) => observer.type === "agent").map((observer) => observer.id)))) {
          wakeActor(actorId, "heard");
          pushQueued(actorId);
        }
      });

      simulation.subscribeSpeech((line) => {
        const target = simulation.getEntity(line.toId);
        if (target?.type === "agent") eventBox.enqueueSaid(line.toId, { id: line.id, from: line.fromId, name: line.fromName, text: line.text, tick: line.tick });
        wakeActor(line.toId, "said");
        pushQueued(line.toId);

        const origin = line.origin ?? simulation.getEntity(line.fromId)?.position;
        const radius = line.audibleRadius ?? 0;
        if (!origin || radius <= 0) return;
        const nearby = simulation.getNearbyObservers(origin, radius)
          .filter((observer) => observer.type === "agent" && observer.id !== line.fromId && observer.id !== line.toId);
        for (const observer of nearby) eventBox.enqueueHeard(observer.id, toOverheard(line));
        for (const observer of nearby) {
          wakeActor(observer.id, "heard");
          pushQueued(observer.id);
        }
      });

      function pushQueued(actorId: string): void {
        const sessionsForActor = [...seats.entries()].filter(([, session]) => session.actorId === actorId && !session.awaitingReply);
        if (!sessionsForActor.length) return;
        const queued = eventBox.read(actorId, simulation.tickCount, true);
        if (!queued.heard.length && !queued.said.length) return;
        for (const [socket] of sessionsForActor) {
          for (const item of queued.said) sendAgent(socket, { type: "said", ...item, reply: "intent" });
          if (queued.heard.length === 1) {
            const item = queued.heard[0];
            sendAgent(socket, { type: "heard", id: item.id, tick: item.tick, kind: item.type, text: item.text, priority: item.priority, startedAtTick: item.startedAtTick, expiresAtTick: item.expiresAtTick, about: item.about, count: item.count });
          }
          else if (queued.heard.length > 1) sendAgent(socket, { type: "heard_batch", tick: queued.heard[0].tick, items: queued.heard });
        }
      }
    },
  };
}

export { CORS };

function packResult(result: AgentPerception | AgentIntentResult): {
  perception?: AgentPerception;
  last?: AgentTurnLast;
  error?: string;
} {
  if ("canDo" in result) {
    return { perception: result, last: { accepted: true } };
  }
  if (result.perception) {
    return {
      perception: result.perception,
      last: { accepted: Boolean(result.accepted), commandId: result.commandId, rejected: result.rejected },
    };
  }
  return { error: result.error ?? "failed" };
}

function requireKey(request: IncomingMessage, response: ServerResponse, keys: AgentKeyStore) {
  if (keys.size === 0) {
    sendJson(response, 503, { ok: false, error: "AGENT_API_KEYS is not configured" });
    return undefined;
  }
  const credential = keys.lookup(readApiKey(request.headers));
  if (!credential) {
    sendJson(response, 401, { ok: false, error: "Provide Authorization: Bearer <API_KEY>" });
    return undefined;
  }
  return credential;
}

function requireSession(
  request: IncomingMessage,
  response: ServerResponse,
  keys: AgentKeyStore,
  sessions: AgentSessionStore,
): AgentSession | undefined {
  const bearer = readApiKey(request.headers);
  const session = sessions.lookup(bearer);
  if (session) return session;
  const credential = keys.lookup(bearer);
  if (credential) return sessions.resume(credential.actorId);
  if (keys.size === 0) {
    sendJson(response, 503, { ok: false, error: "AGENT_API_KEYS is not configured" });
    return undefined;
  }
  sendJson(response, 401, { ok: false, error: "Open /v1/agent/session first, or send the API key" });
  return undefined;
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...CORS,
  });
  response.end(JSON.stringify(body));
}

function sanitizeName(value: unknown): string {
  const text = String(value ?? "Visitor")
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .trim()
    .slice(0, 24);
  return text || "Visitor";
}

function parseDirection(value: string | null): ObserveDirection | undefined {
  return isObserveDirection(value) ? value : undefined;
}

function sendAgent(socket: WebSocket, body: object): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(body));
}

function stripAuth(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const { apiKey: _apiKey, token: _token, hello: _hello, ...rest } = value as Record<string, unknown>;
  return rest;
}

function isEmpty(value: unknown): boolean {
  return Boolean(value && typeof value === "object" && Object.keys(value as object).length === 0);
}

function readJson(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    request.on("end", () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

async function waitForNextTick(simulation: WorldSimulation): Promise<void> {
  const started = simulation.tickCount;
  const deadline = Date.now() + TICK_MS * 4;
  while (simulation.tickCount <= started && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
