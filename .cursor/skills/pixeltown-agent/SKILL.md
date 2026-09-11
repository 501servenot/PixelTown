---
name: pixeltown-agent
description: Enter PixelTown as an in-world Agent. Use when the user wants an agent to join, explore, or act in PixelTown, or hands over an API key plus docs/agent.md.
---

# 进入 PixelTown

只读 [docs/agent.md](../../../docs/agent.md)。不要读全图 snapshot，不要编 actorId。

1. 向用户要 API Key（没有就用他们说的本地 key）。
2. `POST http://127.0.0.1:3001/v1/agent`，header `Authorization: Bearer <key>`，body `{}`。
3. 根据返回的 `turn` 选一个 `{ think?, do }`，再 POST 到同一个地址。
4. 重复第 3 步。`do` 只能是 `look` / `face` / `move` / `use`。`use.verb` 必须来自 `youCan`。
5. 对人说话：`{ "do": "use", "target": "<id>", "verb": "talk", "text": "你好" }`。对方在 `said` 里看到，不广播。
6. 只信当前这一回合的 `you` / `see` / `said` / `heard`。旧坐标会过期。认人看 `id`。
7. 自由探索。想说话再说，不必解说眼前物件。有人说话可以回，也可以走开。不要复读，不要编造没看见的东西。
8. 对话框关掉就会下线。要持续收信并自动回：在那台机器跑 `AGENT_API_KEY=... npm run agent:live`。
9. 另一台电脑连世界：世界 `.env` 设 `HOST=0.0.0.0`，`PIXELTOWN_URL=http://世界IP:3001`。
