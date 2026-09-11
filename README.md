# PixelTown

服务端权威的格子世界。世界按 20Hz 自己走。Agent 只做两件事：看当前 `turn`，交一个结构化意图。改世界的人是 `WorldSimulation`。

当前没有登录、没有把每个 tick 写入数据库。进程重启后种子实体回到出生点。

## 启动

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。世界在 <http://127.0.0.1:3001>。

```bash
npm run typecheck
npm test
```

## 目录

```text
entities/                    实体定义（Scout、树、John…）
src/world/domain/            实体、Command、世界事件模型
src/world/state/             Chunk、空间索引、实体目录
src/world/perception/        Agent 观察、公共事件、私聊队列
src/world/systems/           move / talk / shout / combat / spawn / observe
src/shared/agent.ts          观察与广播的内部形状
src/shared/agent-io.ts       Agent 的 turn / intent
src/shared/protocol.ts       画面与调试口的 JSON
src/server/                  鉴权、/v1/agent、调试 /ws
src/client/                  React HUD
docs/agent.md                交给 Agent 的唯一文档
tools/                       agent-live、Kimi 宿主，不是世界内核
```

## 边界

```text
读 docs/agent.md + API Key
        ↓
POST /v1/agent   {}              进门，拿到 turn
POST /v1/agent   { think?, do }  每一轮都打这里
        ↓
auth 绑 actor → adapter 转 Command → WorldSimulation.tick
```

模型不要读全图 snapshot。`talk` 进入目标的 `said`；发言位置 3 格内的其他 Agent 会收到 `speech_overheard` 类型的 `heard`。

## API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/health` | 进程是否在、tick 频率 |
| `GET` | `/api/sim/snapshot` | 本机画面 / 调试，不要给模型 |
| `POST` | `/v1/join` | 访客领身体和 Key |
| `POST` | `/v1/agent` | 空 body=看；`{ do }`=行动 |
| `GET` | `/v1/agent/wait` | 长轮询，有 said/heard 或超时 |
| `WS` | `/ws/agent` | 给 Agent 推 turn / said / heard 或 heard_batch |
| `WS` | `/ws` | 本机画面调试口，hello 必须带 apiKey |

本地 Key 写在 `.env`：`AGENT_API_KEYS=sk_local_scout:agent_001,sk_local_rover:agent_002,sk_local_wren:agent_003,sk_local_player:player_001`。浏览器使用 `VITE_PLAYER_KEY=sk_local_player` 控制玩家。

## 本地三具身体

世界先 `npm run dev`。然后各开一个终端：

```bash
./tools/kimi-body.sh scout
./tools/kimi-body.sh rover
./tools/kimi-body.sh wren
```

或模板宿主（无模型）：`AGENT_API_KEY=sk_local_scout npm run agent:live`。不要和 Kimi 同时抢同一具身体。
