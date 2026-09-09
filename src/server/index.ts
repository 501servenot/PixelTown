import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { isObserveDirection } from "../shared/agent";
import { isClientMessage, ServerMessage, WORLD_ID } from "../shared/protocol";
import { TICK_MS, WorldSimulation } from "../world";
import type { WorldBroadcast } from "../world/perception/observe";
import { CORS, createAgentGateway } from "./agent-gateway";
import { AgentKeyStore, parseAgentKeys } from "./auth";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const PORT = Number(process.env.PORT ?? 3001); // Agent gateway: /v1/agent, /ws/agent (scout + rover)
const HOST = process.env.HOST ?? "127.0.0.1";
const simulation = new WorldSimulation();
simulation.seedStarterChunk();
const keys = new AgentKeyStore(parseAgentKeys(process.env.AGENT_API_KEYS));
const gateway = createAgentGateway(simulation, keys);
const seats = new Map<WebSocket, string>();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    ...CORS,
  });
  response.end(JSON.stringify(body));
}

function readObservation(actorId: string, radius?: number, direction?: string) {
  return simulation.observe(actorId, {
    radius,
    direction: isObserveDirection(direction) ? direction : undefined,
    consumeSaid: false,
  });
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, CORS);
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, {
      ok: true,
      service: "pixeltown-server",
      worldId: WORLD_ID,
      tickMs: TICK_MS,
      tickHz: Math.round(1000 / TICK_MS),
      agentAuth: keys.size > 0,
    });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/sim/snapshot") {
    sendJson(response, 200, simulation.getSnapshot());
    return;
  }

  if (await gateway.handleHttp(request, response, url)) return;

  sendJson(response, 404, { error: "Not found" });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  });
});

function sendSocket(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
}

const wss = new WebSocketServer({ noServer: true });
const agentWss = new WebSocketServer({ noServer: true });
gateway.attach(agentWss);

server.on("upgrade", (request, socket, head) => {
  const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
  if (pathname === "/ws/agent") {
    agentWss.handleUpgrade(request, socket, head, (ws) => agentWss.emit("connection", ws, request));
    return;
  }
  if (pathname === "/ws") {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit("connection", ws, request));
    return;
  }
  socket.destroy();
});

wss.on("connection", (socket: WebSocket) => {
  socket.on("close", () => seats.delete(socket));
  socket.on("message", (raw) => {
    try {
      const parsed: unknown = JSON.parse(raw.toString());
      if (!isClientMessage(parsed)) {
        sendSocket(socket, { type: "command_result", payload: { ok: false, error: "unrecognized socket message" } });
        return;
      }

      if (parsed.type === "hello") {
        const credential = keys.lookup(parsed.apiKey);
        if (!credential) {
          sendSocket(socket, {
            type: "command_result",
            requestId: parsed.requestId,
            payload: { ok: false, error: "missing or invalid apiKey" },
          });
          return;
        }
        if (!simulation.canActorAct(credential.actorId)) {
          sendSocket(socket, {
            type: "command_result",
            requestId: parsed.requestId,
            payload: { ok: false, error: `${credential.actorId} is not an active player or agent` },
          });
          return;
        }
        seats.set(socket, credential.actorId);
        sendSocket(socket, {
          type: "observation",
          requestId: parsed.requestId,
          payload: readObservation(credential.actorId),
        });
        return;
      }

      const actorId = seats.get(socket);
      if (!actorId) {
        sendSocket(socket, {
          type: "command_result",
          requestId: parsed.requestId,
          payload: { ok: false, error: "hello with apiKey first" },
        });
        return;
      }

      if (parsed.type === "observe") {
        sendSocket(socket, {
          type: "observation",
          requestId: parsed.requestId,
          payload: readObservation(actorId, parsed.radius, parsed.direction),
        });
        return;
      }

      if (!simulation.canActorAct(actorId)) {
        sendSocket(socket, {
          type: "command_result",
          requestId: parsed.requestId,
          payload: { ok: false, error: `${actorId} is not an active player or agent` },
        });
        return;
      }

      const commandId = simulation.submitCommand({
        actorId,
        type: parsed.commandType,
        targetId: parsed.targetId,
        expectedVersion: parsed.expectedVersion,
        payload: parsed.payload,
      });
      sendSocket(socket, {
        type: "command_result",
        requestId: parsed.requestId,
        payload: { ok: true, commandId },
      });
    } catch (error) {
      sendSocket(socket, {
        type: "command_result",
        payload: { ok: false, error: error instanceof Error ? error.message : "Invalid message" },
      });
    }
  });
});

function hearersOf(broadcast: WorldBroadcast): Set<string> {
  return new Set(simulation.getNearbyObservers(broadcast.origin, broadcast.radius).map((entity) => entity.id));
}

simulation.subscribeBroadcast((broadcasts) => {
  for (const broadcast of broadcasts) {
    const hearers = hearersOf(broadcast);
    for (const socket of wss.clients) {
      const actorId = seats.get(socket);
      if (actorId && hearers.has(actorId) && socket.readyState === WebSocket.OPEN) {
        sendSocket(socket, { type: "broadcast", payload: broadcast });
      }
    }
  }
});

async function main(): Promise<void> {
  simulation.start();
  server.listen(PORT, HOST, () => {
    console.log(`PixelTown server listening on http://${HOST}:${PORT} (${Math.round(1000 / TICK_MS)} Hz)`);
    if (keys.size === 0) {
      console.warn("AGENT_API_KEYS is empty; /v1/agent and /ws/agent will reject requests");
    } else {
      console.log(`Agent gateway ready (${keys.size} key${keys.size === 1 ? "" : "s"})`);
    }
  });
}

async function shutdown(): Promise<void> {
  simulation.stop();
  wss.close();
  agentWss.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
