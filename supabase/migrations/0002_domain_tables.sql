-- 0002_domain_tables
-- Ports all business/domain tables from db.ts, plus audit_log (audit.ts) and
-- cron_templates (cron-templates.ts). Every table gets tenant_id + RLS.
-- Type normalization: DATETIME / unix-int timestamps -> timestamptz; JSON text -> jsonb;
-- AUTOINCREMENT -> bigint identity; REAL -> double precision; boolean flags -> boolean.
-- Per-tenant uniqueness applied (e.g. kg_entities unique(tenant_id,kind,name)).
-- NOT ported: seed_registry, session_sync (local/Hermes plumbing);
--             users, sessions, google_login_requests (replaced by Supabase Auth in Phase 3).

create table public.content_posts (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text not null, format text not null, pillar integer,
  text_preview text, full_content text, status text not null default 'draft',
  scheduled_for timestamptz, published_at timestamptz, created_at timestamptz not null default now(),
  impressions integer default 0, likes integer default 0, replies integer default 0,
  reposts integer default 0, saves integer default 0, engagement_rate double precision default 0
);
create index idx_content_status on public.content_posts(tenant_id, status);
create index idx_content_platform on public.content_posts(tenant_id, platform);

create table public.leads (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  first_name text, last_name text, title text, company text, company_size text,
  industry_segment text, source text, email text, linkedin_url text,
  status text not null default 'new', score integer, tier text,
  last_touch_at timestamptz, next_action_at timestamptz, sequence_name text,
  reply_type text, notes text, pause_outreach boolean default false,
  created_at timestamptz not null default now()
);
create index idx_leads_status on public.leads(tenant_id, status);
create index idx_leads_tier on public.leads(tenant_id, tier);

create table public.sequences (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  lead_id text references public.leads(id),
  sequence_name text, step integer, subject text, body text, status text, tier text,
  scheduled_for timestamptz, sent_at timestamptz, created_at timestamptz not null default now()
);
create index idx_sequences_status on public.sequences(tenant_id, status);
create index idx_sequences_lead on public.sequences(lead_id);

create table public.suppression (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  email text not null, type text, added_at timestamptz not null default now(),
  primary key (tenant_id, email)
);

create table public.engagements (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  platform text, action_type text, target_url text, target_username text,
  our_text text, status text, created_at timestamptz not null default now()
);
create index idx_engagements_platform on public.engagements(tenant_id, platform);

create table public.signals (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date text, type text, username text, tweet_url text, summary text,
  relevance text, action_taken text, likes integer, impressions integer,
  created_at timestamptz not null default now()
);
create index idx_signals_type on public.signals(tenant_id, type);

create table public.experiments (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  week integer, hypothesis text, action text, metric text, win_threshold text,
  status text, results text, winner text, margin text, decision text,
  learning text, next_action text, proposed_at timestamptz, completed_at timestamptz
);
create index idx_experiments_status on public.experiments(tenant_id, status);

create table public.learnings (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  learning text, validated_week integer, confidence text, applied_to text,
  created_at timestamptz not null default now()
);

create table public.daily_metrics (
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  date text not null,
  x_posts integer default 0, x_threads integer default 0, linkedin_drafts integer default 0,
  x_replies integer default 0, x_quote_tweets integer default 0, x_follows integer default 0,
  linkedin_comments integer default 0, discoveries integer default 0, enrichments integer default 0,
  sends integer default 0, replies_triaged integer default 0, opt_outs integer default 0,
  bounces integer default 0, total_impressions integer default 0, total_engagement integer default 0,
  primary key (tenant_id, date)
);

create table public.activity_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ts timestamptz default now(), action text, detail text, result text
);
create index idx_activity_action on public.activity_log(tenant_id, action);
create index idx_activity_ts on public.activity_log(tenant_id, ts);

create table public.notifications (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type text not null, severity text not null default 'info',
  title text, message text not null, data jsonb, read boolean not null default false,
  created_at timestamptz not null default now()
);
create index idx_notifications_read on public.notifications(tenant_id, read);

create table public.messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  conversation_id text not null, from_agent text not null, to_agent text,
  content text not null, message_type text not null default 'text',
  metadata jsonb, read_at timestamptz, created_at timestamptz not null default now()
);
create index idx_messages_conversation on public.messages(conversation_id, created_at);

create table public.boardroom_messages (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  direction text not null check (direction in ('in','out')),
  sender text not null, recipient text, text text not null,
  loop_message_id text, status text, metadata jsonb, created_at timestamptz not null default now()
);
create index idx_boardroom_created on public.boardroom_messages(tenant_id, created_at);
create index idx_boardroom_loop_id on public.boardroom_messages(loop_message_id);

create table public.agent_tasks (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  agent_id text not null, parent_id bigint references public.agent_tasks(id),
  status text not null check (status in ('running','done','error','cancelled')),
  task text not null, result text, error text, input_tokens integer, output_tokens integer,
  started_at timestamptz not null default now(), completed_at timestamptz, metadata jsonb
);
create index idx_agent_tasks_status on public.agent_tasks(tenant_id, status, started_at);
create index idx_agent_tasks_agent on public.agent_tasks(agent_id, started_at);

create table public.kg_entities (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  kind text not null, name text not null, attributes jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, kind, name)
);
create index idx_kg_entities_kind on public.kg_entities(tenant_id, kind);

create table public.kg_relations (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  from_id bigint not null references public.kg_entities(id) on delete cascade,
  to_id bigint not null references public.kg_entities(id) on delete cascade,
  label text not null, attributes jsonb, created_at timestamptz not null default now(),
  unique (from_id, to_id, label)
);
create index idx_kg_relations_from on public.kg_relations(from_id, label);
create index idx_kg_relations_to on public.kg_relations(to_id, label);

create table public.client_integrations (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  provider text not null, label text,
  status text not null check (status in ('not_configured','configured','expired','error')) default 'not_configured',
  config jsonb, secret_encrypted text, scopes text, expires_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  last_error text, unique (tenant_id, provider)
);

create table public.agent_drafts (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  type text not null, title text not null, payload text not null,
  status text not null check (status in ('pending','approved','rejected','published','sent','confirmed','expired')) default 'pending',
  created_by text, created_at timestamptz not null default now(),
  reviewed_at timestamptz, executed_at timestamptz, execution_note text, metadata jsonb
);
create index idx_drafts_status on public.agent_drafts(tenant_id, status, created_at);

create table public.audit_log (
  id bigint generated always as identity primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  ts timestamptz default now(), actor_id uuid, actor_username text,
  action text not null, target text, detail text
);
create index idx_audit_ts on public.audit_log(tenant_id, ts);

create table public.cron_templates (
  id text primary key,
  tenant_id uuid not null references public.tenants(id) on delete cascade,
  name text not null, description text, job_json jsonb not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique (tenant_id, name)
);

-- Enable RLS + uniform tenant-isolation policy + tenant_id index on every new table.
do $$
declare t text;
begin
  foreach t in array array[
    'content_posts','leads','sequences','suppression','engagements','signals','experiments',
    'learnings','daily_metrics','activity_log','notifications','messages','boardroom_messages',
    'agent_tasks','kg_entities','kg_relations','client_integrations','agent_drafts','audit_log','cron_templates'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format($p$create policy %I on public.%I for all using (tenant_id in (select public.current_user_tenant_ids())) with check (tenant_id in (select public.current_user_tenant_ids()))$p$, t || '_tenant', t);
    execute format('create index if not exists %I on public.%I(tenant_id)', 'idx_' || t || '_tenant', t);
  end loop;
end $$;
