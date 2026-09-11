import type { AgentHeardView, AgentSaidView } from "../shared/agent-io";

/** 暂存箱里的一条内容：heard 公共事件或 said 私聊的二选一联合。 */
type BoxItem = { kind: "heard"; value: AgentHeardView } | { kind: "said"; value: AgentSaidView };
/** 从暂存箱读出的一批事件：heard 按优先级、said 按时间排序后的两列视图。 */
export interface AgentEventBoxRead { heard: AgentHeardView[]; said: AgentSaidView[] }

/** Agent 思考期间事件的暂存箱：heard/said 按 actor 缓存，等 Agent 拉取或 WS 空闲时推送；超长时丢弃最低优先级的 heard。 */
export class AgentEventBox {
  private readonly boxes = new Map<string, BoxItem[]>();
  constructor(private readonly limit = 32) {}
  enqueueHeard(actorId: string, value: AgentHeardView): void {
    const items = this.boxes.get(actorId) ?? [];
    const existing = items.find((item): item is Extract<BoxItem, { kind: "heard" }> => item.kind === "heard" && (item.value.id === value.id || (value.type !== "speech_overheard" && item.value.tick === value.tick && item.value.type === value.type && item.value.about === value.about)));
    if (existing) existing.value.count = (existing.value.count ?? 1) + 1;
    else items.push({ kind: "heard", value });
    this.trim(items);
    this.boxes.set(actorId, items);
  }
  enqueueSaid(actorId: string, value: AgentSaidView): void {
    const items = this.boxes.get(actorId) ?? [];
    if (!items.some((item) => item.kind === "said" && item.value.id === value.id)) items.push({ kind: "said", value });
    this.trim(items);
    this.boxes.set(actorId, items);
  }
  read(actorId: string, tick: number, consume: boolean): AgentEventBoxRead {
    const items = (this.boxes.get(actorId) ?? []).filter((item) => item.kind === "said" || item.value.expiresAtTick > tick);
    if (consume || !items.length) this.boxes.delete(actorId); else this.boxes.set(actorId, items);
    return {
      heard: items.filter((item): item is Extract<BoxItem, { kind: "heard" }> => item.kind === "heard").sort((a, b) => b.value.priority - a.value.priority || a.value.tick - b.value.tick).map((item) => item.value),
      said: items.filter((item): item is Extract<BoxItem, { kind: "said" }> => item.kind === "said").sort((a, b) => a.value.tick - b.value.tick).map((item) => item.value),
    };
  }
  private trim(items: BoxItem[]): void {
    // ponytail: bounded queue drops the lowest-priority heard item; durable replay needs persistence and ACKs.
    while (items.length > this.limit) {
      let index = items.findIndex((item) => item.kind === "heard");
      if (index < 0) index = 0;
      for (let i = index + 1; i < items.length; i += 1) {
        const current = items[i];
        const candidate = items[index];
        if (current.kind === "heard" && candidate.kind === "heard" && current.value.priority < candidate.value.priority) index = i;
      }
      items.splice(index, 1);
    }
  }
}
