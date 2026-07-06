-- 0055_kg_fulltext
-- Makes the knowledge graph keyword-searchable for RAG-style persistent memory
-- retrieval (src/lib/kg-context.ts). Purely ADDITIVE: no data change, no RLS
-- change. Adds a GENERATED tsvector over name + kind + attributes so full-text
-- search is auto-maintained by Postgres on every write (the app never populates
-- or updates this column — it is STORED/GENERATED ALWAYS), plus a GIN index so
-- `search_tsv @@ websearch_to_tsquery(...)` lookups stay fast.
alter table public.kg_entities
  add column if not exists search_tsv tsvector
  generated always as (
    to_tsvector(
      'english',
      coalesce(name, '') || ' ' || coalesce(kind, '') || ' ' || coalesce(attributes::text, '')
    )
  ) stored;

-- GIN index backing the @@ full-text match + ts_rank_cd ordering in retrieval.
create index if not exists idx_kg_entities_search
  on public.kg_entities using gin (search_tsv);
