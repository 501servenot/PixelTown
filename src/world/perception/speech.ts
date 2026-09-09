/** Private talk. Never goes into the public broadcast log. */

export const MAX_TALK_CHARS = 280;

export interface SpeechLine {
  id: string;
  tick: number;
  fromId: string;
  fromName: string;
  toId: string;
  text: string;
}

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
