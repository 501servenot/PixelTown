import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { isAgentAction, ServerMessage, WORLD_ID } from "../shared/protocol";
import { WorldRuntime } from "./runtime";

const PORT = Number(process.env.PORT ?? 3001);
const runtime = new WorldRuntime();

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk.toString();
    if (raw.length > 1_000_000) throw new Error("Request body is too large");
  }
  if (!raw) return {};
  const value: unknown = JSON.parse(raw);
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("JSON body must be an object");
  return value as Record<string, unknown>;
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", `http://${request.headers.host ?? "localhost"}`);
  if (request.method === "OPTIONS") {
    response.writeHead(204, {
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    });
    response.end();
    return;
  }

  if (request.method === "GET" && url.pathname === "/api/health") {
    sendJson(response, 200, { ok: true, service: "pixeltown-server", worldId: WORLD_ID });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/world/snapshot") {
    sendJson(response, 200, runtime.getSnapshot());
    return;
  }

  const observationMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/observation$/);
  if (request.method === "GET" && observationMatch) {
    try {
      sendJson(response, 200, runtime.observe(decodeURIComponent(observationMatch[1])));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "Agent not found" });
    }
    return;
  }

  const commandMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/command$/);
  if (request.method === "POST" && commandMatch) {
    try {
      const body = await readJson(request);
      if (!isAgentAction(body.action)) {
        sendJson(response, 400, { error: "action is not a valid AgentAction" });
        return;
      }
      sendJson(
        response,
        200,
        runtime.executeCommand(
          decodeURIComponent(commandMatch[1]),
          body.action,
          String(body.clientRequestId ?? ""),
          typeof body.expectedStateVersion === "number" ? body.expectedStateVersion : undefined,
        ),
      );
    } catch (error) {
      sendJson(response, 400, { error: error instanceof Error ? error.message : "Invalid request" });
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/run$/);
  if (request.method === "POST" && runMatch) {
    try {
      sendJson(response, 200, runtime.runAgentTurn(decodeURIComponent(runMatch[1])));
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "Agent not found" });
    }
    return;
  }

  sendJson(response, 404, { error: "Not found" });
}

const server = createServer((request, response) => {
  handle(request, response).catch((error) => {
    sendJson(response, 500, { error: error instanceof Error ? error.message : "Internal server error" });
  });
});

const wss = new WebSocketServer({ server, path: "/ws" });
wss.on("connection", (socket: WebSocket) => {
  socket.send(JSON.stringify({ type: "snapshot", payload: runtime.getSnapshot() } satisfies ServerMessage));
});

runtime.subscribe((snapshot) => {
  const message = JSON.stringify({ type: "snapshot", payload: snapshot } satisfies ServerMessage);
  for (const socket of wss.clients) {
    if (socket.readyState === WebSocket.OPEN) socket.send(message);
  }
});

runtime.start();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`PixelTown server listening on http://127.0.0.1:${PORT}`);
});

function shutdown(): void {
  runtime.stop();
  wss.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
