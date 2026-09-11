import { useEffect, useMemo, useRef, useState } from "react";
import Phaser from "phaser";
import type { ClientMessage, ServerMessage, SimSnapshot } from "../shared/protocol";
import { TownScene } from "./game/TownScene";

const PLAYER_ID = "player_001";
const PLAYER_KEY = import.meta.env.VITE_PLAYER_KEY ?? "sk_local_player";
const MOVE_KEYS: Record<string, { dx: number; dy: number }> = {
  ArrowUp: { dx: 0, dy: -1 }, w: { dx: 0, dy: -1 },
  ArrowDown: { dx: 0, dy: 1 }, s: { dx: 0, dy: 1 },
  ArrowLeft: { dx: -1, dy: 0 }, a: { dx: -1, dy: 0 },
  ArrowRight: { dx: 1, dy: 0 }, d: { dx: 1, dy: 0 },
};

export default function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const [snapshot, setSnapshot] = useState<SimSnapshot>();
  const [chatTarget, setChatTarget] = useState<string>();
  const [chatText, setChatText] = useState("");
  const player = snapshot?.entities.find((entity) => entity.id === PLAYER_ID);
  const held = snapshot?.entities.find((entity) => entity.containedIn === PLAYER_ID);
  const targets = useMemo(() => (snapshot?.entities ?? [])
    .filter((entity) => entity.id !== PLAYER_ID && !entity.containedIn && (entity.type === "agent" || entity.type === "object" || entity.type === "npc" || entity.type === "item"))
    .map((entity) => ({
      entity,
      distance: player ? Math.abs(entity.position.x - player.position.x) + Math.abs(entity.position.y - player.position.y) : Infinity,
    }))
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 8), [snapshot, player]);
  const selectedTarget = targets.find((item) => item.entity.id === chatTarget)?.entity;
  const targetInRange = Boolean(selectedTarget && player &&
    Math.abs(selectedTarget.position.x - player.position.x) + Math.abs(selectedTarget.position.y - player.position.y) <= 3);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const scene = new TownScene();
    const game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: host,
      width: host.clientWidth || window.innerWidth,
      height: host.clientHeight || window.innerHeight,
      backgroundColor: "#ffffff",
      scene,
      scale: { mode: Phaser.Scale.RESIZE, autoCenter: Phaser.Scale.NO_CENTER },
      render: { antialias: false, pixelArt: true, roundPixels: true },
    });
    const socketUrl = import.meta.env.DEV
      ? "ws://127.0.0.1:3001/ws"
      : `${window.location.protocol === "https:" ? "wss:" : "ws:"}//${window.location.host}/ws`;
    const socket = new WebSocket(socketUrl);
    socketRef.current = socket;
    const applySnapshot = (next: SimSnapshot) => {
      setSnapshot(next);
      scene.setSnapshot(next);
    };
    fetch("/api/sim/snapshot").then((response) => response.json() as Promise<SimSnapshot>).then(applySnapshot).catch(() => undefined);
    socket.onmessage = (message) => {
      const parsed = JSON.parse(message.data) as ServerMessage;
      if (parsed.type === "sim_snapshot") applySnapshot(parsed.payload);
      if (parsed.type === "speech") scene.showSpeech(parsed.payload);
      if (parsed.type === "broadcast") scene.showBroadcast(parsed.payload);
    };
    socket.onopen = () => socket.send(JSON.stringify({
      type: "hello", requestId: crypto.randomUUID(), apiKey: PLAYER_KEY, actorId: PLAYER_ID,
    } satisfies ClientMessage));
    return () => { socketRef.current = null; socket.close(); game.destroy(true); };
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.target as HTMLElement)?.tagName === "INPUT") return;
      const move = MOVE_KEYS[event.key] ?? MOVE_KEYS[event.key.toLowerCase()];
      if (!move || !player) return;
      event.preventDefault();
      sendCommand("move", undefined, { x: player.position.x + move.dx, y: player.position.y + move.dy });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [player]);

  function sendCommand(commandType: "move" | "interact", targetId?: string, payload?: Record<string, number | string | boolean>) {
    const socket = socketRef.current;
    if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "command", actorId: PLAYER_ID, commandType, targetId, payload, requestId: crypto.randomUUID() }));
  }

  function sendChat(event: React.FormEvent) {
    event.preventDefault();
    const text = chatText.trim();
    if (!text || !selectedTarget || selectedTarget.type !== "agent" || !targetInRange) return;
    sendCommand("interact", selectedTarget.id, { verb: "talk", text });
    setChatText("");
  }

  return (
    <main className="world-root">
      <div ref={hostRef} className="world-host" />
      <section className="player-controls" aria-label="玩家控制">
        <div className="controls-title">PLAYER · {player?.name ?? "连接中"}</div>
        <div className="controls-hint">WASD / 方向键移动{held ? ` · 手持 ${held.name}` : ""} · 西边有传送门</div>
        <div className="target-list">
          {targets.map(({ entity, distance }) => (
            <div className="target-row" key={entity.id}>
              <button type="button" onClick={() => (entity.type === "agent" || entity.type === "npc") && setChatTarget(entity.id)} className={chatTarget === entity.id ? "selected" : ""}>
                {entity.name} · {distance <= 3 ? "可交互" : `${distance}格外`}
                {entity.statuses?.some((item) => item.name === "alert") ? " · 警戒" : ""}
              </button>
              {entity.definitionId === "object.tree" && <button type="button" onClick={() => distance <= 3 && sendCommand("interact", entity.id, { verb: "chop", damage: 20, damageType: "chop" })} disabled={distance > 3}>砍伐</button>}
              {entity.definitionId === "object.gacha" && <button type="button" onClick={() => distance <= 3 && sendCommand("interact", entity.id, { verb: "collect" })} disabled={distance > 3 || held?.definitionId !== "item.token"}>扭蛋</button>}
              {entity.definitionId === "npc.guard_bot" && <button type="button" onClick={() => distance <= 3 && sendCommand("interact", entity.id, { verb: "attack", damage: 20, damageType: "kinetic" })} disabled={distance > 3}>攻击</button>}
              {entity.type === "item" && <button type="button" onClick={() => distance <= 1 && sendCommand("interact", entity.id, { verb: "pickup" })} disabled={distance > 1}>拾取</button>}
            </div>
          ))}
        </div>
        {selectedTarget?.type === "agent" && (
          <form className="chat-form" onSubmit={sendChat}>
            <input value={chatText} onChange={(event) => setChatText(event.target.value)} placeholder={targetInRange ? `和 ${selectedTarget.name} 说话…` : "靠近 Agent 后才能聊天"} disabled={!targetInRange} />
            <button type="submit" disabled={!targetInRange || !chatText.trim()}>发送</button>
          </form>
        )}
      </section>
    </main>
  );
}
