insert into game.worlds (id, name, map_version, metadata)
values ('starter-town', '晨雾小镇', 'starter-1', '{"width":14,"height":10,"orientation":"isometric"}')
on conflict (id) do update set name = excluded.name, metadata = excluded.metadata;

insert into game.entities (id, world_id, kind, name, x, y, capabilities, state)
values
  ('town-hall', 'starter-town', 'landmark', '镇公所', 5, 3, array['inspect','greet'], '{"open":true}'),
  ('quest-board', 'starter-town', 'quest', '任务公告板', 6, 4, array['inspect','greet'], '{"questId":"seed-search","reward":"friendship"}'),
  ('market-square', 'starter-town', 'landmark', '集市广场', 8, 5, array['inspect','greet'], '{"tradingEnabled":false}'),
  ('old-well', 'starter-town', 'landmark', '老水井', 3, 6, array['inspect','greet'], '{"waterLevel":"full"}'),
  ('forest-edge', 'starter-town', 'resource', '森林边缘', 10, 7, array['inspect','gather'], '{"resource":"seed","remaining":3}'),
  ('bakery', 'starter-town', 'landmark', '麦穗面包房', 2, 2, array['inspect','greet'], '{"open":false}')
on conflict (id) do update set state = excluded.state, x = excluded.x, y = excluded.y;

insert into game.agents (id, name, definition)
values ('agent-1', '小镇观察员', '{"planner":"deterministic-mvp","version":1}')
on conflict (id) do update set name = excluded.name;

insert into game.agent_runtime (agent_id, world_id, x, y, stats)
values ('agent-1', 'starter-town', 5, 5, '{"gathered":0}')
on conflict (agent_id) do update set world_id = excluded.world_id, x = excluded.x, y = excluded.y;
