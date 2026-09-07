import { createServer, IncomingMessage, ServerResponse } from "node:http";
import { WebSocketServer, WebSocket } from "ws";
import { isAgentAction, ServerMessage, WORLD_ID } from "../shared/protocol";
import { WorldRuntime } from "./runtime";
import { createSupabaseRepository } from "./supabase";

if (typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

const PORT = Number(process.env.PORT ?? 3001);
const runtime = new WorldRuntime();
const persistence = createSupabaseRepository();

if (!persistence) {
  const configuredKey = [process.env.SUPABASE_SECRET_KEY, process.env.SUPABASE_SERVER_KEY, process.env.SUPABASE_SERVICE_ROLE_KEY]
    .find((value) => value?.trim());
  console.warn(
    configuredKey?.trim().startsWith("sb_publishable_")
      ? "[supabase] disabled: use a server-only sb_secret_... key, not the sb_publishable_... key"
      : "[supabase] disabled: fill SUPABASE_URL and SUPABASE_SECRET_KEY in .env",
  );
}

const persistenceStatus = (): unknown => persistence?.getStatus() ?? { enabled: false, state: "disabled" };

async function hydrateAndBootstrap(): Promise<void> {
  if (!persistence) return;
  const loaded = await persistence.load(WORLD_ID);
  if (loaded?.state) runtime.hydrate(loaded.state);
  if (loaded && !loaded.found && persistence.shouldBootstrap()) await persistence.persist(runtime.getSnapshot());
}

async function persistAfterCommand(): Promise<void> {
  if (persistence) await persistence.persist(runtime.getSnapshot());
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "access-control-allow-origin": "*",
    "cache-control": "no-store",
  });
  response.end(JSON.stringify(body));
}

function errorStatus(error: unknown, fallback: number): number {
  return error instanceof Error && error.message.startsWith("[supabase]") ? 503 : fallback;
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
    sendJson(response, 200, {
      ok: true,
      service: "pixeltown-server",
      worldId: WORLD_ID,
      persistence: persistenceStatus(),
    });
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
      const result = runtime.executeCommand(
        decodeURIComponent(commandMatch[1]),
        body.action,
        String(body.clientRequestId ?? ""),
        typeof body.expectedStateVersion === "number" ? body.expectedStateVersion : undefined,
      );
      if (result.ok) await persistAfterCommand();
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, errorStatus(error, 400), { error: error instanceof Error ? error.message : "Invalid request" });
    }
    return;
  }

  const runMatch = url.pathname.match(/^\/api\/agents\/([^/]+)\/run$/);
  if (request.method === "POST" && runMatch) {
    try {
      const result = runtime.runAgentTurn(decodeURIComponent(runMatch[1]));
      if (result.result.ok) await persistAfterCommand();
      sendJson(response, 200, result);
    } catch (error) {
      sendJson(response, errorStatus(error, 404), { error: error instanceof Error ? error.message : "Agent not found" });
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

async function main(): Promise<void> {
  await hydrateAndBootstrap();
  runtime.start();
  server.listen(PORT, "127.0.0.1", () => {
    console.log(`PixelTown server listening on http://127.0.0.1:${PORT}`);
  });
}

async function shutdown(): Promise<void> {
  runtime.stop();
  if (persistence) await persistence.persist(runtime.getSnapshot());
  wss.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
