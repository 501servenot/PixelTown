import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { WheelEvent as ReactWheelEvent } from "react";
import type {
  AgentAction,
  AgentDecision,
  Observation,
  ServerMessage,
  WorldEvent,
  WorldSnapshot,
} from "../shared/protocol";
import { AGENT_ID, timeSegmentForMinutes } from "../shared/protocol";
import { TownGame } from "./game/TownScene";

type TimeSegment = "auto" | "dawn" | "noon" | "dusk" | "night";

const TIME_SEGMENTS: ReadonlyArray<{ id: TimeSegment; label: string; hint: string }> = [
  { id: "auto", label: "自动", hint: "跟随世界时间" },
  { id: "dawn", label: "清晨", hint: "05:00–10:59" },
  { id: "noon", label: "正午", hint: "11:00–16:59" },
  { id: "dusk", label: "傍晚", hint: "17:00–19:59" },
  { id: "night", label: "夜间", hint: "20:00–04:59" },
];

const MAP_BACKGROUNDS: Record<Exclude<TimeSegment, "auto">, string> = {
  dawn: "#1e292e",
  noon: "#1c272c",
  dusk: "#3f2d34",
  night: "#182240",
};

const ZOOM_MIN = 0.55;
const ZOOM_MAX = 3.2;
const ZOOM_STEP = 0.1;

function clampZoom(value: number): number {
  if (!Number.isFinite(value)) return 1;
  return Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Number(value.toFixed(2))));
}

function timeSegmentLabel(segment: TimeSegment, worldTime: number): string {
  const selected = segment === "auto" ? timeSegmentForMinutes(worldTime) : segment;
  return TIME_SEGMENTS.find((item) => item.id === selected)?.label ?? "自动";
}

function formatTime(totalMinutes: number): string {
  const minutes = totalMinutes % (24 * 60);
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, headers: { "content-type": "application/json", ...(init?.headers ?? {}) } });
  const raw = await response.text();
  let body: unknown;
  if (raw.trim()) {
    try {
      body = JSON.parse(raw);
    } catch {
      if (!response.ok) throw new Error(`请求失败 (${response.status})`);
      throw new Error("服务器返回了无效响应");
    }
  }
  if (!response.ok) {
    const message = body && typeof body === "object" && "error" in body && typeof body.error === "string"
      ? body.error
      : `请求失败 (${response.status})`;
    throw new Error(message);
  }
  if (body === undefined) throw new Error("服务器返回空响应");
  return body as T;
}

function actionLabel(action: AgentAction): string {
  if (action.type === "move") return `移动 · ${action.direction}`;
  return `${action.type} · ${action.entityId}`;
}

export default function App() {
  const [snapshot, setSnapshot] = useState<WorldSnapshot>();
  const [observation, setObservation] = useState<Observation>();
  const [decision, setDecision] = useState<AgentDecision>();
  const [logs, setLogs] = useState<WorldEvent[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const gameHost = useRef<HTMLDivElement>(null);
  const game = useRef<TownGame | undefined>(undefined);
  const zoomRef = useRef(1);
  const [zoom, setZoom] = useState(1);
  const [timeSegment, setTimeSegment] = useState<TimeSegment>("auto");
  const [activeTool, setActiveTool] = useState<"agent" | "observation" | "events" | null>(null);

  const refreshObservation = useCallback(async () => {
    const next = await api<Observation>(`/api/agents/${AGENT_ID}/observation`);
    setObservation(next);
  }, []);

  const refreshAll = useCallback(async () => {
    const [nextSnapshot, nextObservation] = await Promise.all([
      api<WorldSnapshot>("/api/world/snapshot"),
      api<Observation>(`/api/agents/${AGENT_ID}/observation`),
    ]);
    setSnapshot(nextSnapshot);
    setObservation(nextObservation);
    setLogs(nextSnapshot.recentEvents);
  }, []);

  useEffect(() => {
    refreshAll()
      .then(() => setError(""))
      .catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "无法连接服务器"));
    // ponytail: connect directly in local dev; production can serve the socket behind the same origin.
    const socketUrl = import.meta.env.DEV
      ? "ws://127.0.0.1:3001/ws"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
    const socket = new WebSocket(socketUrl);
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ServerMessage;
      if (parsed.type === "snapshot") {
        const next = parsed.payload as WorldSnapshot;
        setSnapshot(next);
        setLogs(next.recentEvents);
      }
    };
    // HTTP polling is a small, reliable fallback for restrictive dev proxies and startup races.
    // The same endpoint can be replaced by room broadcasts when multiplayer arrives.
    const poll = window.setInterval(() => {
      refreshAll().then(() => setError("")).catch(() => undefined);
    }, 2000);
    socket.onerror = () => undefined;
    return () => {
      socket.close();
      window.clearInterval(poll);
    };
  }, [refreshAll]);

  useEffect(() => {
    if (!gameHost.current) return;
    game.current = new TownGame(gameHost.current);
    const initialZoom = clampZoom(game.current.getZoom());
    zoomRef.current = initialZoom;
    setZoom(initialZoom);
    return () => {
      game.current?.destroy();
      game.current = undefined;
    };
  }, []);

  useEffect(() => {
    if (snapshot) game.current?.setSnapshot(snapshot);
  }, [snapshot]);

  useEffect(() => {
    const resolved = timeSegment === "auto"
      ? timeSegmentForMinutes(snapshot?.worldTime ?? 480)
      : timeSegment;
    game.current?.setTimeOfDay(resolved);
  }, [snapshot?.worldTime, timeSegment]);

  const agent = snapshot?.agents.find((item) => item.id === AGENT_ID);
  const nearby = observation?.nearbyEntities ?? [];
  const inventory = useMemo(() => Object.entries(agent?.inventory ?? {}), [agent?.inventory]);

  async function runAgent(): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const turn = await api<{ observation: Observation; decision: AgentDecision; result: { message: string } }>(
        `/api/agents/${AGENT_ID}/run`,
        { method: "POST", body: "{}" },
      );
      setObservation(turn.observation);
      setDecision(turn.decision);
      await refreshAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Agent 运行失败");
    } finally {
      setBusy(false);
    }
  }

  async function sendAction(action: AgentAction): Promise<void> {
    setBusy(true);
    setError("");
    try {
      await api(`/api/agents/${AGENT_ID}/command`, {
        method: "POST",
        body: JSON.stringify({ action, clientRequestId: crypto.randomUUID() }),
      });
      await refreshAll();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "命令执行失败");
    } finally {
      setBusy(false);
    }
  }

  const inspectTarget = nearby.find((entity) => entity.kind === "quest") ?? nearby[0];

  function applyZoom(value: number): void {
    const requested = clampZoom(value);
    const next = clampZoom(game.current?.setZoom(requested) ?? requested);
    zoomRef.current = next;
    setZoom(next);
  }

  function fitMap(): void {
    const next = clampZoom(game.current?.fitMap() ?? 1);
    zoomRef.current = next;
    setZoom(next);
  }

  function handleMapWheel(event: ReactWheelEvent<HTMLDivElement>): void {
    event.preventDefault();
    applyZoom(zoomRef.current + (event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP));
  }

  function selectTimeSegment(segment: TimeSegment): void {
    setTimeSegment(segment);
  }

  const activeTimeSegment = timeSegment === "auto"
    ? timeSegmentForMinutes(snapshot?.worldTime ?? 480)
    : timeSegment;

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PIXELTOWN / MVP-01</p>
          <h1>像素小镇</h1>
          <p className="subtitle">区块化海洋平面 · 中央陆地城市 · 每栋楼与车辆都能点选查看。</p>
        </div>
        <div className="world-clock">
          <span className="live-dot" />
          <span>世界运行中</span>
          <strong>{formatTime(snapshot?.worldTime ?? 480)}</strong>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="hero-grid">
        <div className="game-card card">
          <div className="card-heading">
            <div>
              <span className="kicker">WORLD VIEW</span>
              <h2>光町世界</h2>
            </div>
            <span className="state-pill">state v{snapshot?.stateVersion ?? 0}</span>
          </div>
          <div className="map-toolbar" aria-label="地图显示控制">
            <div className="time-tabs" role="group" aria-label="光照时段">
              <span className="toolbar-label">光照</span>
              {TIME_SEGMENTS.map((item) => (
                <button
                  type="button"
                  className={timeSegment === item.id ? "active" : ""}
                  key={item.id}
                  title={item.hint}
                  aria-pressed={timeSegment === item.id}
                  onClick={() => selectTimeSegment(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            <div className="zoom-control" role="group" aria-label="地图缩放">
              <span className="toolbar-label">缩放</span>
              <button type="button" aria-label="缩小地图" onClick={() => applyZoom(zoom - ZOOM_STEP)} disabled={zoom <= ZOOM_MIN}>−</button>
              <output aria-live="polite">{Math.round(zoom * 100)}%</output>
              <button type="button" aria-label="放大地图" onClick={() => applyZoom(zoom + ZOOM_STEP)} disabled={zoom >= ZOOM_MAX}>＋</button>
              <button type="button" className="fit-button" onClick={fitMap}>适配</button>
            </div>
          </div>
          <div
            ref={gameHost}
            className="game-host"
            aria-label="像素小镇地图"
            style={{ backgroundColor: MAP_BACKGROUNDS[activeTimeSegment] }}
            onWheel={handleMapWheel}
          />
          <div className="map-caption">
            <span><i className="legend-dot agent" />Agent</span>
            <span><i className="legend-dot quest" />任务</span>
            <span><i className="legend-dot resource" />资源</span>
            <span className="caption-muted">
              无限区块 · 中央陆地 · {Math.round(zoom * 100)}% · {timeSegmentLabel(timeSegment, snapshot?.worldTime ?? 480)}
            </span>
          </div>
        </div>

          <aside className="tool-rail" aria-label="世界工具">
            <button type="button" className={activeTool === "agent" ? "active" : ""} onClick={() => setActiveTool(activeTool === "agent" ? null : "agent")} aria-label="打开 Agent 工具">A</button>
            <button type="button" onClick={() => document.getElementById("observation-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label="查看 Agent 观察">◉</button>
            <button type="button" onClick={() => document.getElementById("event-panel")?.scrollIntoView({ behavior: "smooth", block: "start" })} aria-label="查看世界事件">≡</button>
          </aside>
          <aside className={`agent-card card tool-drawer ${activeTool === "agent" ? "open" : ""}`}>
          <div className="card-heading">
            <div>
              <span className="kicker">AGENT CONSOLE</span>
              <h2>{agent?.name ?? "连接中…"}</h2>
            </div>
            <span className="agent-badge">A-01</span>
          </div>
          <div className="agent-status"><span className="status-dot" />{agent?.status ?? "idle"}<span className="status-sep">·</span>能量 {agent?.energy ?? 100}</div>
          <div className="stat-row"><span>位置</span><strong>({agent?.position.x ?? "-"}, {agent?.position.y ?? "-"})</strong></div>
          <div className="stat-row"><span>观察版本</span><strong>#{observation?.observationVersion ?? 0}</strong></div>
          <div className="inventory-box">
            <span className="kicker">INVENTORY</span>
            {inventory.length ? inventory.map(([name, count]) => <div className="inventory-item" key={name}><span>{name}</span><strong>×{count}</strong></div>) : <p className="empty">还没有物品</p>}
          </div>
          <button className="primary-button" onClick={runAgent} disabled={busy}>{busy ? "Agent 思考中…" : "▶ 运行 Agent 一步"}</button>
          <div className="button-row">
            <button onClick={() => sendAction({ type: "move", direction: "north" })} disabled={busy}>↑</button>
            <button onClick={() => sendAction({ type: "move", direction: "west" })} disabled={busy}>←</button>
            <button onClick={() => sendAction({ type: "move", direction: "south" })} disabled={busy}>↓</button>
            <button onClick={() => sendAction({ type: "move", direction: "east" })} disabled={busy}>→</button>
          </div>
          <div className="button-row secondary-actions">
            <button onClick={() => inspectTarget && sendAction({ type: "inspect", entityId: inspectTarget.id })} disabled={busy || !inspectTarget}>观察附近</button>
            <button onClick={() => refreshObservation().catch((reason) => setError(reason instanceof Error ? reason.message : "刷新失败"))} disabled={busy}>刷新观察</button>
          </div>
        </aside>
      </section>

      <section className="lower-grid">
        <div id="observation-panel" className="card observation-card">
          <div className="card-heading"><div><span className="kicker">OBSERVATION</span><h2>Agent 看到什么</h2></div><span className="json-tag">JSON</span></div>
          <p className="helper">服务端按距离裁剪世界信息；模型只会收到这份结构化观察。</p>
          <div className="entity-list">{nearby.map((entity) => <div className="entity-row" key={entity.id}><span className={`entity-icon ${entity.kind}`} /> <div><strong>{entity.name}</strong><small>{entity.description}</small></div><code>({entity.position.x},{entity.position.y})</code></div>)}{!nearby.length && <p className="empty">等待观察数据…</p>}</div>
          <div className="action-chips">{observation?.availableActions.map((action) => <span key={action}>{action}</span>)}</div>
        </div>
        <div id="event-panel" className="card log-card">
          <div className="card-heading"><div><span className="kicker">EVENT STREAM</span><h2>世界事件</h2></div><span className="live-label">LIVE</span></div>
          {decision && <div className="decision-box"><span className="kicker">LAST DECISION</span><strong>{actionLabel(decision.action)}</strong><p>{decision.rationale}</p></div>}
          <div className="event-list">{[...logs].reverse().map((event) => <div className="event-row" key={event.id}><span className="event-time">{formatTime(event.worldTime)}</span><span>{event.message}</span></div>)}{!logs.length && <p className="empty">世界还没有事件。</p>}</div>
        </div>
      </section>

      <footer><span>Prototype runtime · authoritative server simulation · memory state</span><span>HTTP + WebSocket · no login · no trading</span></footer>
    </main>
  );
}
