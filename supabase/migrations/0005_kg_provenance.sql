-- 0005_kg_provenance
-- Adds provenance to knowledge-graph facts so we can trace which agent recorded
-- a node/edge, filter the graph by source, and prune low-confidence noise.
alter table public.kg_entities  add column if not exists source_agent text;
alter table public.kg_entities  add column if not exists confidence real not null default 1.0;
alter table public.kg_relations add column if not exists source_agent text;
alter table public.kg_relations add column if not exists confidence real not null default 1.0;
create index if not exists idx_kg_entities_source on public.kg_entities(tenant_id, source_agent);
