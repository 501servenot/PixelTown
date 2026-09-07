-- Additive upgrade for the chunk-aware MVP repository.
-- Keep 001 unchanged: it may already have been applied to a project.
create schema if not exists game;

alter table if exists game.worlds
  add column if not exists chunk_size integer not null default 32;
alter table if exists game.worlds
  add column if not exists world_epoch bigint not null default 0;

alter table if exists game.entities
  add column if not exists chunk_x integer;
alter table if exists game.entities
  add column if not exists chunk_y integer;
alter table if exists game.entities
  add column if not exists entity_revision bigint not null default 0;
alter table if exists game.entities
  add column if not exists active boolean not null default true;

update game.entities e
set chunk_x = floor(e.x::numeric / greatest(coalesce(w.chunk_size, 32), 1))::integer,
    chunk_y = floor(e.y::numeric / greatest(coalesce(w.chunk_size, 32), 1))::integer
from game.worlds w
where e.world_id = w.id
  and (e.chunk_x is null or e.chunk_y is null);

do $$
begin
  if not exists (select 1 from game.entities where chunk_x is null) then
    alter table game.entities alter column chunk_x set not null;
  end if;
  if not exists (select 1 from game.entities where chunk_y is null) then
    alter table game.entities alter column chunk_y set not null;
  end if;
end
$$;

create index if not exists entities_world_chunk_idx
  on game.entities (world_id, chunk_x, chunk_y);

alter table if exists game.agents
  add column if not exists world_id text;

update game.agents a
set world_id = r.world_id
from game.agent_runtime r
where r.agent_id = a.id
  and a.world_id is null;

-- MVP has one world; use it for legacy agents that had no runtime row.
-- ponytail: keep this one-world backfill until account/world ownership is introduced.
update game.agents a
set world_id = (select id from game.worlds limit 1)
where a.world_id is null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'agents_world_id_fkey'
      and conrelid = 'game.agents'::regclass
  ) then
    alter table game.agents
      add constraint agents_world_id_fkey
      foreign key (world_id) references game.worlds(id) on delete cascade;
  end if;
end
$$;

create index if not exists agents_world_idx on game.agents (world_id);

alter table if exists game.agent_runtime
  add column if not exists chunk_x integer;
alter table if exists game.agent_runtime
  add column if not exists chunk_y integer;
alter table if exists game.agent_runtime
  add column if not exists state_revision bigint not null default 0;
alter table if exists game.agent_runtime
  add column if not exists status text not null default 'idle';

do $$
begin
  -- 001 called this column state_version; a manually-created current schema may not.
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'game'
      and table_name = 'agent_runtime'
      and column_name = 'state_version'
  ) then
    execute 'update game.agent_runtime set state_revision = state_version where state_version is not null';
  end if;
end
$$;

update game.agent_runtime r
set status = case when a.status in ('thinking', 'moving') then a.status else 'idle' end
from game.agents a
where a.id = r.agent_id;

update game.agent_runtime r
set chunk_x = floor(r.x::numeric / greatest(coalesce(w.chunk_size, 32), 1))::integer,
    chunk_y = floor(r.y::numeric / greatest(coalesce(w.chunk_size, 32), 1))::integer
from game.worlds w
where r.world_id = w.id
  and (r.chunk_x is null or r.chunk_y is null);

do $$
begin
  if not exists (select 1 from game.agent_runtime where chunk_x is null) then
    alter table game.agent_runtime alter column chunk_x set not null;
  end if;
  if not exists (select 1 from game.agent_runtime where chunk_y is null) then
    alter table game.agent_runtime alter column chunk_y set not null;
  end if;
end
$$;

create index if not exists agent_runtime_world_chunk_idx
  on game.agent_runtime (world_id, chunk_x, chunk_y);

create table if not exists game.world_chunks (
  world_id text not null references game.worlds(id) on delete cascade,
  chunk_x integer not null,
  chunk_y integer not null,
  current_revision bigint not null default 0,
  last_checkpoint_revision bigint not null default 0,
  entity_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (world_id, chunk_x, chunk_y)
);

alter table game.world_chunks
  add column if not exists current_revision bigint not null default 0;
alter table game.world_chunks
  add column if not exists last_checkpoint_revision bigint not null default 0;
alter table game.world_chunks
  add column if not exists entity_count integer not null default 0;

alter table game.world_chunks enable row level security;
revoke all on schema game from anon, authenticated;
revoke all on all tables in schema game from anon, authenticated;

-- The server uses the secret/service role only. Keep game out of browser access.
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant usage on schema game to service_role';
    execute 'grant select, insert, update, delete on all tables in schema game to service_role';
    execute 'grant usage, select on all sequences in schema game to service_role';
  end if;
end
$$;
