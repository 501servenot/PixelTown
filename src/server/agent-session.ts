import { randomBytes } from "node:crypto";

export const SESSION_TTL_MS = 30 * 60 * 1000;

/** 一个 Agent 会话：绑定 actorId，记录回合号、过期时间与是否正等待 Agent 回复。 */
export interface AgentSession {
  id: string;
  token: string;
  actorId: string;
  turn: number;
  expiresAt: number;
  awaitingReply: boolean;
}

/** 会话存储：按 token 与 actorId 双索引管理 AgentSession；同一 actor 重连时关闭旧会话或原地续用。 */
export class AgentSessionStore {
  private readonly byToken = new Map<string, AgentSession>();
  private readonly byActor = new Map<string, AgentSession>();

  open(actorId: string): AgentSession {
    const existing = this.byActor.get(actorId);
    if (existing) this.close(existing);
    const session: AgentSession = {
      id: `sess_${randomBytes(8).toString("hex")}`,
      token: `pt_sess_${randomBytes(24).toString("base64url")}`,
      actorId,
      turn: 0,
      expiresAt: Date.now() + SESSION_TTL_MS,
      awaitingReply: false,
    };
    this.byToken.set(session.token, session);
    this.byActor.set(actorId, session);
    return session;
  }

  /** Same key / same body keeps one session. No token for the Agent to manage. */
  resume(actorId: string): AgentSession {
    const existing = this.alive(this.byActor.get(actorId));
    return existing ?? this.open(actorId);
  }

  lookup(token: string | undefined): AgentSession | undefined {
    if (!token?.startsWith("pt_sess_")) return undefined;
    return this.alive(this.byToken.get(token));
  }

  nextTurn(session: AgentSession): number {
    session.turn += 1;
    session.expiresAt = Date.now() + SESSION_TTL_MS;
    session.awaitingReply = true;
    return session.turn;
  }

  acceptReply(session: AgentSession): boolean {
    if (!session.awaitingReply) return false;
    session.awaitingReply = false;
    return true;
  }

  close(session: AgentSession): void {
    this.byToken.delete(session.token);
    if (this.byActor.get(session.actorId) === session) this.byActor.delete(session.actorId);
  }

  private alive(session: AgentSession | undefined): AgentSession | undefined {
    if (!session) return undefined;
    if (session.expiresAt <= Date.now()) {
      this.close(session);
      return undefined;
    }
    return session;
  }
}
