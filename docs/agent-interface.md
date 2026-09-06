# Agent 接口（MVP）

Agent 不直接读写数据库，也不能提交任意脚本。它只拿到服务端裁剪后的 `Observation`，再返回一个有限的 `AgentAction`。

本阶段 `agent-1` 在种子数据中直接处于入场状态；登录或游客身份确定后，再把入场做成独立的 session/`enter` 命令。

## 一次回合

```text
observe → plan（当前是确定性 planner） → validate → execute → event
```

服务端在 `validate` 阶段重新检查 Agent、目标实体、距离、能力和边界。客户端或模型传来的坐标不能跳过这些检查。

## 获取观察

```http
GET /api/agents/agent-1/observation
```

```json
{
  "observationVersion": 0,
  "worldId": "starter-town",
  "worldTime": 480,
  "agent": { "id": "agent-1", "position": { "x": 5, "y": 5 }, "energy": 100 },
  "nearbyEntities": [
    { "id": "quest-board", "kind": "quest", "name": "任务公告板", "position": { "x": 6, "y": 4 }, "capabilities": ["inspect", "greet"] }
  ],
  "availableActions": ["move", "inspect", "greet"],
  "recentEvents": []
}
```

`nearbyEntities` 是按距离裁剪的世界视图；完整世界快照只用于调试和画面同步。

## 执行动作

```http
POST /api/agents/agent-1/command
Content-Type: application/json
```

```json
{
  "clientRequestId": "a-request-id",
  "expectedStateVersion": 0,
  "action": { "type": "inspect", "entityId": "quest-board" }
}
```

当前动作只有四种：

- `move`: `north | south | east | west`
- `inspect`: 观察附近实体
- `greet`: 向附近实体打招呼
- `gather`: 从支持 `gather` 的资源实体采集一份资源

`clientRequestId` 用来做最小幂等保护；`expectedStateVersion` 用来拒绝基于过期观察做出的动作。后续接入队列时应继续保留这两个字段，并在数据库事件表上建立幂等约束。

## 让 Agent 自己运行一步

```http
POST /api/agents/agent-1/run
```

MVP 内置的是确定性 planner，目的是先把协议和运行时跑通。后续接入 LLM 时，只替换 planner，不改变 `Observation → AgentAction → validate → execute` 边界。

安全底线：模型输出是不可信输入；模型永远不能直接写位置、库存、实体状态或 SQL。任何新增动作都必须同时增加服务端校验、事件类型和测试。
