/** Speech is routed privately and, for talk, to nearby listeners. It never enters the public broadcast log. */

export const MAX_TALK_CHARS = 280;
export const TALK_AUDIBLE_RADIUS = 3;
export const TALK_AUDIBLE_DURATION_TICKS = 20;

/** 一条私聊消息（said 通道的内容）：从某实体到指定接收者，不进公共广播日志。 */
export interface SpeechLine {
  id: string;
  tick: number;
  fromId: string;
  fromName: string;
  toId: string;
  text: string;
  /** Position at emission time; used for proximity fan-out without a later position race. */
  origin?: { x: number; y: number };
  /** Radius for transient overhearing. Undefined means direct-only (for scripted effects). */
  audibleRadius?: number;
}

/** 私聊队列：said 消息按接收者暂存、限量保留；observe 默认只 peek，consume 时才取走并清空。 */
export class SpeechInbox {
  private readonly byRecipient = new Map<string, SpeechLine[]>();
  constructor(private readonly limit = 16) {}

  push(line: SpeechLine): void {
    const list = this.byRecipient.get(line.toId) ?? [];
    list.push(line);
    if (list.length > this.limit) list.splice(0, list.length - this.limit);
    this.byRecipient.set(line.toId, list);
  }

  for(recipientId: string): SpeechLine[] {
    return (this.byRecipient.get(recipientId) ?? []).map((line) => ({ ...line }));
  }

  take(recipientId: string): SpeechLine[] {
    const list = this.for(recipientId);
    this.byRecipient.delete(recipientId);
    return list;
  }
}
