-- PixelTown durable state. The authoritative tick, collision and AOI logic stays in the game server.
create extension if not exists pgcrypto;
create schema if not exists game;

create table if not exists game.worlds (
  id text primary key,
  name text not null,
  map_version text not null default 'starter-1',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game.entities (
  id text primary key,
  world_id text not null references game.worlds(id) on delete cascade,
  kind text not null check (kind in ('landmark', 'resource', 'quest')),
  name text not null,
  x integer not null check (x >= 0),
  y integer not null check (y >= 0),
  capabilities text[] not null default '{}',
  state jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game.agents (
  id text primary key,
  -- Nullable until login/ownership is introduced. Do not treat this as authorization.
  owner_user_id uuid,
  name text not null,
  definition jsonb not null default '{}'::jsonb,
  status text not null default 'idle' check (status in ('idle', 'thinking', 'moving', 'paused')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists game.agent_runtime (
  agent_id text primary key references game.agents(id) on delete cascade,
  world_id text not null references game.worlds(id) on delete cascade,
  x integer not null check (x >= 0),
  y integer not null check (y >= 0),
  state_version bigint not null default 0,
  next_wake_at timestamptz,
  memory jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists game.snapshots (
  world_id text primary key references game.worlds(id) on delete cascade,
  state_version bigint not null,
  state jsonb not null,
  created_at timestamptz not null default now()
);

create table if not exists game.events (
  event_id uuid primary key default gen_random_uuid(),
  world_id text not null references game.worlds(id) on delete cascade,
  agent_id text references game.agents(id) on delete set null,
  entity_id text references game.entities(id) on delete set null,
  event_type text not null,
  payload jsonb not null default '{}'::jsonb,
  state_version bigint not null,
  occurred_at timestamptz not null default now()
);
create index if not exists events_world_time_idx on game.events(world_id, occurred_at desc);
create index if not exists events_agent_time_idx on game.events(agent_id, occurred_at desc);

create table if not exists game.agent_runs (
  run_id uuid primary key default gen_random_uuid(),
  agent_id text not null references game.agents(id) on delete cascade,
  client_request_id text,
  observation jsonb not null,
  decision jsonb not null,
  command jsonb not null,
  result jsonb not null,
  status text not null check (status in ('succeeded', 'rejected', 'failed')),
  model_provider text,
  model_version text,
  created_at timestamptz not null default now(),
  unique (agent_id, client_request_id)
);
create index if not exists agent_runs_agent_time_idx on game.agent_runs(agent_id, created_at desc);

create table if not exists game.assets (
  id uuid primary key default gen_random_uuid(),
  world_id text references game.worlds(id) on delete set null,
  -- Nullable until user identity is introduced; not an authorization field yet.
  owner_user_id uuid,
  object_key text not null unique,
  kind text not null check (kind in ('tileset', 'sprite', 'map', 'audio', 'other')),
  content_hash text not null,
  visibility text not null default 'private' check (visibility in ('private', 'public')),
  moderation_status text not null default 'approved' check (moderation_status in ('quarantine', 'approved', 'rejected')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- No browser-facing access in the no-login MVP. The server uses a restricted
-- server-side role/connection; never put a service/secret key in the client.
alter table game.worlds enable row level security;
alter table game.entities enable row level security;
alter table game.agents enable row level security;
alter table game.agent_runtime enable row level security;
alter table game.snapshots enable row level security;
alter table game.events enable row level security;
alter table game.agent_runs enable row level security;
alter table game.assets enable row level security;

revoke all on schema game from anon, authenticated;
revoke all on all tables in schema game from anon, authenticated;
