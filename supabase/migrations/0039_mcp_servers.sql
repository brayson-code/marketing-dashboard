-- MCP HUB — remote MCP servers a tenant connects so its agents can call those
-- servers' tools via the Anthropic Messages API MCP connector (server-side
-- discovery + execution, like web_search). One row per connected server.
--
-- `auth_token` holds the ENCRYPTED bearer token (AES-256-GCM, same secret
-- encryption as client_integrations; see src/lib/mcp-store.ts) — it is NEVER
-- the plaintext. Nullable because many MCP servers are unauthenticated.
--
-- `enabled` defaults FALSE: a freshly-added server is dormant until the owner
-- flips it on, so the agent calls stay byte-identical to today until at least
-- one server is enabled. RLS mirrors the standard tenant policy (the backend
-- postgres role bypasses it and scopes by tenantId() in app code).

create table if not exists public.mcp_servers (
  id bigint generated always as identity primary key,
  tenant_id uuid not null,
  name text not null,
  url text not null,
  auth_token text,
  enabled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists mcp_servers_tenant_idx on public.mcp_servers (tenant_id, created_at desc);
create index if not exists mcp_servers_tenant_enabled_idx on public.mcp_servers (tenant_id, enabled);

alter table public.mcp_servers enable row level security;
drop policy if exists mcp_servers_rw on public.mcp_servers;
create policy mcp_servers_rw on public.mcp_servers for all
  using (tenant_id in (select public.current_user_tenant_ids()))
  with check (tenant_id in (select public.current_user_tenant_ids()));
