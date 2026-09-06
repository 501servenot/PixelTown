# 像素小镇（PixelTown）MVP

这是一个能跑起来的垂直切片：固定 14×10 等距小镇、一个已经入场的 Agent、结构化观察、有限动作、服务端权威运行时，以及一个 Phaser 画面。当前刻意不包含登录、交易、LLM 调用和用户上传；入场生命周期先用种子数据代替。

演示时每个服务端 tick（1 秒）推进 1 个游戏分钟；这是为了让世界时钟可见，不代表最终时间规则。

## 启动

```bash
npm install
npm run dev
```

打开 <http://127.0.0.1:5173>。服务端 API 在 <http://127.0.0.1:3001>。

也可以单独运行：

```bash
npm run typecheck
npm test
npm run build
```

## 目录

```text
src/shared/protocol.ts       Agent/世界 JSON 契约
src/server/runtime.ts        权威世界状态、校验、tick、事件
src/server/planner.ts        可替换的确定性 Agent planner
src/server/index.ts          HTTP + WebSocket 网关
src/client/game/TownScene.ts Phaser 等距视图（程序化像素占位美术）
src/client/App.tsx           React HUD、Agent 控制台、事件流
supabase/migrations/         可直接导入 Supabase 的 durable schema
supabase/seed.sql             starter-town 种子数据
docs/agent-interface.md       Agent 接口说明和示例
```

## 当前 API

| 方法 | 路径 | 用途 |
| --- | --- | --- |
| `GET` | `/api/world/snapshot` | 画面同步/调试用完整快照 |
| `GET` | `/api/agents/:id/observation` | 给 Agent 的距离裁剪观察 |
| `POST` | `/api/agents/:id/command` | 执行一个经过校验的动作 |
| `POST` | `/api/agents/:id/run` | 运行一次 observe → planner → command |
| `WS` | `/ws` | 推送世界快照变化 |

## 运行时边界

```text
浏览器（React + Phaser）
          │ HTTP / WebSocket
          ▼
Node.js 权威 Game Server
  ├─ 内存：tick、坐标、碰撞/AOI、短期事件
  ├─ Agent planner/LLM adapter：只产生有限 AgentAction
  └─ Supabase Postgres：持久状态、事件、Agent run（下一步接入）
```

模型只看 `Observation`，只返回 `AgentAction`。服务端再次校验距离、能力、边界和幂等键，再改变状态并产生事件。这是后续接入真实 LLM、多人和用户 Agent 的关键缝隙。

### 状态分层

| 层 | 内容 | 存放位置 |
| --- | --- | --- |
| Hot | tick、坐标、碰撞、AOI、短期事件 | 权威 Game Server 内存 |
| Durable | 世界/实体定义、Agent 配置、运行时位置、事件、回合记录 | Supabase Postgres |
| Asset | tileset、sprite、地图和审核状态 | Supabase Storage + `game.assets` |
| Presence（以后） | 在线人数、房间路由、短期广播 | Redis/Realtime（按需要） |

不要把每个 tick 写进 Postgres；命令完成或定期快照时再持久化。服务重启时用最近快照加事件恢复。

### 数据表对应关系

- `game.worlds`：世界和地图版本。
- `game.entities`：可观察、可交互实体；坐标是关系字段，扩展属性放 `jsonb`。
- `game.agents` + `game.agent_runtime`：Agent 定义与当前生活状态。
- `game.snapshots`：世界最近的可恢复快照。
- `game.events`：审计/重放用的事实事件。
- `game.agent_runs`：每次 observe/decision/command/result，带可选幂等键，方便调试和重试。
- `game.assets`：内置美术和未来 UGC 的对象键、哈希、审核状态。

当前没有 `auth.users` 外键、钱包、订单或交易流水表，避免在登录和经济规则未确定前锁定模型。

## Supabase 怎么用

可以用。这里把 Supabase 当作 **PostgreSQL + Storage**：`supabase/migrations/001_world_runtime.sql` 已设计世界、实体、Agent、运行时状态、事件、Agent 回合和资源元数据表；`seed.sql` 提供初始数据。

MVP 先用内存运行时，避免把每个 tick 写进数据库。接入 Supabase 时由服务端使用受限的 server-side 数据库连接持久化事件和快照；浏览器不拿 service/secret key，也不直接修改 `game` schema。

Realtime 以后可用于聊天、在线状态和低频通知；它不替代权威 tick、AOI、碰撞和房间所有权。Edge Functions 适合短请求/Webhook，不适合常驻世界循环。

## 为什么先选这套技术

- **React + TypeScript + Vite**：快速搭 HUD 和工具面板，类型能约束协议。
- **Phaser**：现成的 2D 场景、输入、相机、精灵和 Tilemap；当前用程序化图形，后续可换 Tiled/tileset。
- **Node.js + TypeScript**：和前端共享协议；MVP 用 Node `http` + `ws`，需求变复杂再换 Fastify/Colyseus。
- **Supabase Postgres/Storage**：降低早期运维成本；持久化和资源托管准备好，但不把数据库当实时循环。

## 下一阶段顺序

1. 接入 Supabase server-side repository：命令事务、事件 outbox、启动时恢复快照。
2. 把确定性 planner 换成 provider-neutral 的 LLM adapter，并记录 prompt/模型版本和预算。
3. 增加房间/AOI 和第二个 Agent；只有出现跨进程需求时再加 Redis/NATS。
4. 加游客身份/登录、UGC quarantine → 审核 → public Storage；交易系统最后做。

出现以下信号再升级基础设施：

- 单进程房间 CPU/内存达到上限：按小镇区域拆 authoritative rooms，并用 Colyseus/自建 WebSocket room 路由。
- 需要跨进程事件：先加 Redis（瞬时广播），需要可靠重放时再加 NATS JetStream；两者都不承载最终经济账本。
- Agent 数量上升：把 planner/LLM 调用移到独立 worker，用队列、幂等键、重试上限和死信处理；不要让 LLM 驱动每帧循环。
- 开放用户上传：Storage 私有 quarantine → 类型/大小/恶意扫描 → 审核 → public bucket/CDN，浏览器只拿短期签名 URL。

现在最重要的验证问题是：Agent 的观察字段和动作是否足够表达你想要的“小镇生活”。先改协议和规则，再扩基础设施。
