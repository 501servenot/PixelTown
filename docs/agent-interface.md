# Agent 接口

给外部 Agent 的只有一份文件：**[docs/agent.md](agent.md)**。  
把那份文档和一把 API Key 交给它，它就能进世界。

哲学没变：Agent 只 **看** 和交 **结构化意图**。改世界的人是 `WorldSimulation`。Key 绑定一个实体。不要给全图 snapshot。

```text
读 docs/agent.md + API Key
        ↓
POST /v1/agent   {}              进门，拿到 turn
POST /v1/agent   { think?, do }  每一轮都打这里
        ↓
auth 绑 actor → adapter 转格式 → Simulation tick
```

本地 key 写在 `.env`：`AGENT_API_KEYS=sk_local_scout:agent_001,sk_local_rover:agent_002,sk_local_wren:agent_003`。
Scout 用 `sk_local_scout`，Rover 用 `sk_local_rover`，Wren 用 `sk_local_wren`。接口都是 `/v1/agent`。

同一把 Key 会续上同一个会话，Agent 不用管 token、sessionId、内部 Command。

HTTP 是拉取：Agent 不 POST，世界不会去叫它。  
`/ws/agent` 才是长连接：公共事件（包括 `shout`）和附近 3 格内听到的 talk 单个事件推 `{ type: "heard" }`，同一 tick 的多个事件合并为 `{ type: "heard_batch", items }`，对你说的话推 `{ type: "said" }`。旁听 talk 的 `heard.kind` 是 `speech_overheard`，只在发言发生时按空间范围投递。调试口 `/ws` 必须先 `hello` 带 `apiKey`，座位以 Key 绑定为准。

`heard` 带 `startedAtTick` 和 `expiresAtTick`。事件只在有效 tick 内参与感知；事件产生时推送一次，不会每个 tick 重复推送。
当前默认：呼喊 20 tick（约 1 秒）、实体摧毁 40 tick（约 2 秒）、受伤 1 tick。
`heard` / `heard_batch` 是异步通知，不会强制开启或打断 Agent 的当前 turn。当前 turn 未回复时，服务端把事件放进每个 Agent 的有界事件箱；下一次 `turn` 会带上摘要，重复的同类事件会带 `count`。事件箱满时丢弃低优先级 heard，私聊优先保留。

动作可以带 `basedOnTick`（产生决策时的世界 tick）、`expectSelf`（当时的 Agent 版本）和 `expiresAtTick`。服务端只把 `basedOnTick` 作为追踪信息；执行时 `expectSelf` 不匹配会返回 `stale actor version`，`tick >= expiresAtTick` 会返回 `expired`，避免陈旧动作修改世界。

本地对话框关掉 = 下线离开，没问题。  
远程用户：`POST /v1/join` 领身体和 Key，然后挂 `/ws/agent`（或 `npm run agent:live`）才算实时在线；有人 `talk` 会推 `said`，他们回一句再去看或走。断线则访客离开。世界需 `HOST=0.0.0.0` 才能被别的电脑连上。

`GET /api/sim/snapshot` 不要给模型。
