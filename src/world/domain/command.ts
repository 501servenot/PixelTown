import type { EntityAttributes } from "./entity";

/** 实体可提交给世界的意图类型词表；NPC 的 behavior 产出与玩家同类型，走同一管道、无特权。 */
export type CommandType = "move" | "talk" | "attack" | "pickup" | "destroy" | "observe" | "interact" | "rest" | "shout";

/** 实体（玩家/Agent/NPC）提交给世界的意图；带乐观校验版本与过期 tick，经 WorldSimulation 校验后才执行。 */
export interface Command {
  id: string;
  actorId: string;
  type: CommandType;
  targetId?: string;
  expectedVersion?: number;
  expectedActorVersion?: number;
  basedOnTick?: number;
  expiresAtTick?: number;
  payload?: EntityAttributes;
  timestamp: number;
}

/** 命令被拒绝的记录：命令 ID 加原因；随快照返回给提交方。 */
export interface CommandReject {
  commandId: string;
  reason: string;
}

export function sortCommands(commands: Command[]): Command[] {
  return [...commands].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

/** 命令缓冲队列：tick 时按时间戳排序后整体取出；WorldSimulation 全局持有一个，每个 chunk 各持有一个用于分发。 */
export class CommandQueue {
  private readonly items: Command[] = [];

  get size(): number {
    return this.items.length;
  }

  enqueue(command: Command): void {
    this.items.push(command);
  }

  drain(): Command[] {
    const next = sortCommands(this.items);
    this.items.length = 0;
    return next;
  }
}
