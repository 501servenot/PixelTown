insert into game.worlds (id, name, map_version, metadata)
values ('starter-town', '晨雾小镇', 'starter-1', '{"width":22,"height":14,"orientation":"isometric"}')
on conflict (id) do update set name = excluded.name, metadata = excluded.metadata;

insert into game.entities (id, world_id, kind, name, x, y, chunk_x, chunk_y, capabilities, state)
values
  ('town-hall', 'starter-town', 'landmark', '镇公所', 5, 3, 0, 0, array['inspect','greet'], '{"open":true}'),
  ('quest-board', 'starter-town', 'quest', '任务公告板', 6, 4, 0, 0, array['inspect','greet'], '{"questId":"seed-search","reward":"friendship"}'),
  ('market-square', 'starter-town', 'landmark', '集市广场', 8, 5, 0, 0, array['inspect','greet'], '{"tradingEnabled":false}'),
  ('old-well', 'starter-town', 'landmark', '老水井', 3, 6, 0, 0, array['inspect','greet'], '{"waterLevel":"full"}'),
  ('forest-edge', 'starter-town', 'resource', '森林边缘', 10, 7, 0, 0, array['inspect','gather'], '{"resource":"seed","remaining":3}'),
  ('bakery', 'starter-town', 'landmark', '麦穗面包房', 2, 2, 0, 0, array['inspect','greet'], '{"open":false}')
on conflict (id) do update set state = excluded.state, x = excluded.x, y = excluded.y,
  chunk_x = excluded.chunk_x, chunk_y = excluded.chunk_y;

insert into game.agents (id, world_id, name, definition)
values ('agent-1', 'starter-town', '小镇观察员', '{"planner":"deterministic-mvp","version":1}')
on conflict (id) do update set world_id = excluded.world_id, name = excluded.name;

insert into game.agent_runtime (agent_id, world_id, x, y, chunk_x, chunk_y, stats)
values ('agent-1', 'starter-town', 5, 5, 0, 0, '{"gathered":0}')
on conflict (agent_id) do update set world_id = excluded.world_id, x = excluded.x, y = excluded.y,
  chunk_x = excluded.chunk_x, chunk_y = excluded.chunk_y;

insert into game.world_chunks (world_id, chunk_x, chunk_y, current_revision, entity_count)
values ('starter-town', 0, 0, 0, 6)
on conflict (world_id, chunk_x, chunk_y) do update set entity_count = excluded.entity_count;
