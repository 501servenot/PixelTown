import type { EntityAttributes } from "./entity";

export type CommandType = "move" | "talk" | "attack" | "pickup" | "destroy" | "observe" | "interact" | "rest" | "shout";

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

export interface CommandReject {
  commandId: string;
  reason: string;
}

export function sortCommands(commands: Command[]): Command[] {
  return [...commands].sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id));
}

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
