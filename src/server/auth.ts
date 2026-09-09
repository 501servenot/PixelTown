import { timingSafeEqual } from "node:crypto";

export interface AgentCredential {
  key: string;
  actorId: string;
  name: string;
}

export class AgentKeyStore {
  private readonly keys = new Map<string, AgentCredential>();

  constructor(entries: AgentCredential[] = []) {
    for (const entry of entries) this.keys.set(entry.key, entry);
  }

  get size(): number {
    return this.keys.size;
  }

  lookup(apiKey: string | undefined): AgentCredential | undefined {
    if (!apiKey) return undefined;
    for (const [key, credential] of this.keys) {
      if (safeEqual(key, apiKey)) return credential;
    }
    return undefined;
  }

  add(credential: AgentCredential): void {
    this.keys.set(credential.key, credential);
  }

  revokeActor(actorId: string): void {
    for (const [key, credential] of this.keys) {
      if (credential.actorId === actorId) this.keys.delete(key);
    }
  }
}

export function parseAgentKeys(raw: string | undefined): AgentCredential[] {
  const text = raw?.trim();
  if (!text) return [];
  if (text.startsWith("{")) {
    const parsed = JSON.parse(text) as Record<string, { actorId?: string; name?: string } | string>;
    return Object.entries(parsed).map(([key, value]) =>
      typeof value === "string"
        ? { key, actorId: value, name: key }
        : { key, actorId: String(value.actorId ?? ""), name: String(value.name ?? key) },
    ).filter((entry) => entry.key && entry.actorId);
  }
  return text
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [key, actorId, name] = part.split(":").map((item) => item.trim());
      return { key, actorId, name: name || actorId };
    })
    .filter((entry) => entry.key && entry.actorId);
}

export function readApiKey(headers: { get(name: string): string | null } | IncomingHeaders): string | undefined {
  const authorization = header(headers, "authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice(7).trim();
  return header(headers, "x-api-key")?.trim() || undefined;
}

type IncomingHeaders = { [key: string]: string | string[] | undefined };

function header(headers: { get(name: string): string | null } | IncomingHeaders, name: string): string | undefined {
  if ("get" in headers && typeof headers.get === "function") return headers.get(name) ?? undefined;
  const value = (headers as IncomingHeaders)[name] ?? (headers as IncomingHeaders)[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
