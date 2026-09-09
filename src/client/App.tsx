import { useEffect, useMemo, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, SimCommandType, SimSnapshot } from "../shared/protocol";

const PLAYER_ID = "player_001";
const PLAYER_KEY = import.meta.env.VITE_PLAYER_KEY ?? "sk_local_player";
const TICK_HZ = 20;

export default function App() {
  const [snapshot, setSnapshot] = useState<SimSnapshot>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [selectedId, setSelectedId] = useState<string>("player_001");
  const socketRef = useRef<WebSocket | undefined>(undefined);
  const pendingRef = useRef(new Map<string, (message: ServerMessage) => void>());

  useEffect(() => {
    const socketUrl = import.meta.env.DEV
      ? "ws://127.0.0.1:3001/ws"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ServerMessage;
      if (parsed.requestId) pendingRef.current.get(parsed.requestId)?.(parsed);
      if (parsed.type === "sim_snapshot") setSnapshot(parsed.payload);
    };
    socket.onopen = () => {
      setError("");
      const requestId = crypto.randomUUID();
      pendingRef.current.set(requestId, (incoming) => {
        if (incoming.type === "command_result" && !incoming.payload.ok) {
          setError(incoming.payload.error ?? "调试口握手失败");
        }
      });
      socket.send(JSON.stringify({ type: "hello", requestId, apiKey: PLAYER_KEY, actorId: PLAYER_ID }));
      fetch("/api/sim/snapshot")
        .then((response) => response.json())
        .then((next: SimSnapshot) => setSnapshot(next))
        .catch(() => undefined);
    };
    socket.onerror = () => setError("无法连接世界");
    const poll = window.setInterval(() => {
      fetch("/api/sim/snapshot")
        .then((response) => response.json())
        .then((next: SimSnapshot) => setSnapshot(next))
        .catch(() => undefined);
    }, 500);
    return () => {
      socketRef.current = undefined;
      socket.close();
      window.clearInterval(poll);
    };
  }, []);

  const player = snapshot?.entities.find((entity) => entity.id === PLAYER_ID);
  const selected = snapshot?.entities.find((entity) => entity.id === selectedId) ?? player;
  const events = snapshot?.recentEvents ?? [];

  const nearby = useMemo(() => {
    if (!player || !snapshot) return [];
    return snapshot.entities.filter((entity) => {
      if (entity.id === player.id) return false;
      return Math.abs(entity.position.x - player.position.x) + Math.abs(entity.position.y - player.position.y) <= 3;
    });
  }, [player, snapshot]);

  function sendSocket(message: ClientMessage): Promise<ServerMessage> {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new Error("世界连接已断开"));
    }
    const requestId = message.requestId ?? crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        pendingRef.current.delete(requestId);
        reject(new Error("世界没有回应这次行动"));
      }, 2000);
      pendingRef.current.set(requestId, (incoming) => {
        window.clearTimeout(timer);
        pendingRef.current.delete(requestId);
        resolve(incoming);
      });
      socket.send(JSON.stringify({ ...message, requestId }));
    });
  }

  async function sendCommand(
    commandType: SimCommandType,
    extra: { targetId?: string; payload?: Record<string, number | string | boolean> } = {},
  ): Promise<void> {
    setBusy(true);
    setError("");
    try {
      const incoming = await sendSocket({
        type: "command",
        actorId: PLAYER_ID,
        commandType,
        targetId: extra.targetId,
        payload: extra.payload,
      });
      if (incoming.type !== "command_result") throw new Error("世界没有返回行动结果");
      if (!incoming.payload.ok) throw new Error(incoming.payload.error ?? "命令被拒绝");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "命令执行失败");
    } finally {
      setBusy(false);
    }
  }

  function move(dx: number, dy: number): void {
    if (!player) return;
    void sendCommand("move", { payload: { x: player.position.x + dx, y: player.position.y + dy } });
  }

  return (
    <main className="shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">PIXELTOWN / WORLD CORE</p>
          <h1>像素小镇</h1>
          <p className="subtitle">Chunk 权威模拟 · Command 走 WebSocket · {TICK_HZ} Hz tick</p>
        </div>
        <div className="world-clock">
          <span className="live-dot" />
          <span>世界运行中</span>
          <strong>tick {snapshot?.tick ?? 0}</strong>
        </div>
      </header>

      {error && <div className="error-banner">{error}</div>}

      <section className="hero-grid">
        <div className="game-card card">
          <div className="card-heading">
            <div>
              <span className="kicker">CHUNK</span>
              <h2>{player?.position.chunkId ?? "等待快照"}</h2>
            </div>
            <span className="state-pill">
              {snapshot?.entityCount ?? 0} entities · {snapshot?.chunkCount ?? 0} chunks
            </span>
          </div>
          <div className="entity-list">
            {snapshot?.entities.map((entity) => (
              <button
                type="button"
                className="entity-row"
                key={entity.id}
                onClick={() => setSelectedId(entity.id)}
                aria-pressed={selected?.id === entity.id}
              >
                <span className={`entity-icon ${entity.type === "player" ? "agent" : entity.type === "object" ? "resource" : "quest"}`} />
                <div>
                  <strong>{entity.name}</strong>
                  <small>
                    {entity.type} · {entity.state.activity} · v{entity.version}
                  </small>
                </div>
                <code>
                  ({entity.position.x},{entity.position.y}) {entity.position.chunkId}
                </code>
              </button>
            ))}
            {!snapshot && <p className="empty">正在接入世界…</p>}
          </div>
          {selected && (
            <aside className="entity-inspect" style={{ position: "relative", top: 16, left: 0, pointerEvents: "auto" }}>
              <p className="entity-inspect-kicker">{selected.type} · {selected.name}</p>
              <p className="entity-inspect-summary">{selected.description || `${selected.id}`}</p>
              <ul>
                <li>位置 ({selected.position.x}, {selected.position.y}) · {selected.position.chunkId}</li>
                <li>状态 {selected.state.status} / {selected.state.activity}</li>
                <li>生命 {String(selected.attributes.health ?? "-")} / {String(selected.attributes.maxHealth ?? "-")}</li>
                {selected.state.targetId && <li>目标 {selected.state.targetId}</li>}
              </ul>
            </aside>
          )}
        </div>

        <aside className="agent-card card tool-drawer open" style={{ position: "relative", width: "auto" }}>
          <div className="card-heading">
            <div>
              <span className="kicker">PLAYER</span>
              <h2>{player?.name ?? "Player"}</h2>
            </div>
            <span className="agent-badge">{PLAYER_ID}</span>
          </div>
          <div className="agent-status">
            <span className="status-dot" />
            {player?.state.activity ?? "offline"}
            <span className="status-sep">·</span>
            能量 {String(player?.attributes.energy ?? "-")}
          </div>
          <div className="stat-row">
            <span>位置</span>
            <strong>({player?.position.x ?? "-"}, {player?.position.y ?? "-"})</strong>
          </div>
          <div className="button-row">
            <button type="button" onClick={() => move(0, -1)} disabled={busy}>↑</button>
            <button type="button" onClick={() => move(-1, 0)} disabled={busy}>←</button>
            <button type="button" onClick={() => move(0, 1)} disabled={busy}>↓</button>
            <button type="button" onClick={() => move(1, 0)} disabled={busy}>→</button>
          </div>
          <div className="button-row secondary-actions">
            <button type="button" onClick={() => void sendCommand("talk", { targetId: "npc_001" })} disabled={busy}>
              和 John 说话
            </button>
            <button type="button" onClick={() => void sendCommand("attack", { targetId: "tree_001", payload: { damage: 20 } })} disabled={busy}>
              砍树
            </button>
          </div>
        </aside>
      </section>

      <section className="lower-grid">
        <div id="observation-panel" className="card observation-card">
          <div className="card-heading">
            <div>
              <span className="kicker">NEARBY</span>
              <h2>附近 3 格</h2>
            </div>
          </div>
          <div className="entity-list">
            {nearby.map((entity) => (
              <div className="entity-row" key={entity.id}>
                <span className="entity-icon quest" />
                <div>
                  <strong>{entity.name}</strong>
                  <small>{entity.state.activity} · hp {String(entity.attributes.health ?? "-")}</small>
                </div>
                <code>({entity.position.x},{entity.position.y})</code>
              </div>
            ))}
            {!nearby.length && <p className="empty">附近没有其他实体</p>}
          </div>
        </div>
        <div id="event-panel" className="card log-card">
          <div className="card-heading">
            <div>
              <span className="kicker">EVENT STREAM</span>
              <h2>世界事件</h2>
            </div>
            <span className="live-label">LIVE</span>
          </div>
          <div className="event-list">
            {[...events].reverse().map((event) => (
              <div className="event-row" key={event.id}>
                <span className="event-time">d{event.depth}</span>
                <span>
                  {event.type}
                  {event.targetId ? ` → ${event.targetId}` : ""}
                </span>
              </div>
            ))}
            {!events.length && <p className="empty">这个 tick 还没有事件。</p>}
          </div>
          {snapshot?.rejected.length ? (
            <p className="helper">{snapshot.rejected.map((item) => item.reason).join("；")}</p>
          ) : null}
        </div>
      </section>

      <footer>
        <span>WorldSimulation · {TICK_HZ} Hz · memory state</span>
        <span>WebSocket commands · no login · no trading</span>
      </footer>
    </main>
  );
}
