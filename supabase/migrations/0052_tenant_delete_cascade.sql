-- 0052_tenant_delete_cascade.sql — make every tenant-scoped table CASCADE on tenant delete.
--
-- 20 tables carried a `tenant_id` column with NO foreign key to tenants (only an index), so a
-- hard client decommission (DELETE /api/clients mode:'delete' → DELETE FROM tenants) would
-- ORPHAN their rows — including credential/secret tables: connections (OAuth tokens), key_audit,
-- mcp_servers, sms_messages. This migration adds the missing ON DELETE CASCADE FKs so deleting a
-- tenant removes ALL of its data atomically, with no leftovers.
--
-- Per table: (1) delete any pre-existing orphan rows (tenant_id pointing at a tenant that no
-- longer exists) so the new FK validates, then (2) add the cascade FK (idempotent via DROP
-- CONSTRAINT IF EXISTS). Additive + isolation-preserving: this only strengthens cleanup; it does
-- not change any RLS policy or tenant filter.

-- agentmail_inboxes
DELETE FROM public.agentmail_inboxes WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.agentmail_inboxes DROP CONSTRAINT IF EXISTS agentmail_inboxes_tenant_id_fkey;
ALTER TABLE public.agentmail_inboxes ADD CONSTRAINT agentmail_inboxes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- agentmail_messages
DELETE FROM public.agentmail_messages WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.agentmail_messages DROP CONSTRAINT IF EXISTS agentmail_messages_tenant_id_fkey;
ALTER TABLE public.agentmail_messages ADD CONSTRAINT agentmail_messages_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- competitor_reels
DELETE FROM public.competitor_reels WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.competitor_reels DROP CONSTRAINT IF EXISTS competitor_reels_tenant_id_fkey;
ALTER TABLE public.competitor_reels ADD CONSTRAINT competitor_reels_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- competitors
DELETE FROM public.competitors WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.competitors DROP CONSTRAINT IF EXISTS competitors_tenant_id_fkey;
ALTER TABLE public.competitors ADD CONSTRAINT competitors_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- connections
DELETE FROM public.connections WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.connections DROP CONSTRAINT IF EXISTS connections_tenant_id_fkey;
ALTER TABLE public.connections ADD CONSTRAINT connections_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- contacts
DELETE FROM public.contacts WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.contacts DROP CONSTRAINT IF EXISTS contacts_tenant_id_fkey;
ALTER TABLE public.contacts ADD CONSTRAINT contacts_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- gene_config
DELETE FROM public.gene_config WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.gene_config DROP CONSTRAINT IF EXISTS gene_config_tenant_id_fkey;
ALTER TABLE public.gene_config ADD CONSTRAINT gene_config_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- gene_events
DELETE FROM public.gene_events WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.gene_events DROP CONSTRAINT IF EXISTS gene_events_tenant_id_fkey;
ALTER TABLE public.gene_events ADD CONSTRAINT gene_events_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- generation_canvas
DELETE FROM public.generation_canvas WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.generation_canvas DROP CONSTRAINT IF EXISTS generation_canvas_tenant_id_fkey;
ALTER TABLE public.generation_canvas ADD CONSTRAINT generation_canvas_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- generation_jobs
DELETE FROM public.generation_jobs WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.generation_jobs DROP CONSTRAINT IF EXISTS generation_jobs_tenant_id_fkey;
ALTER TABLE public.generation_jobs ADD CONSTRAINT generation_jobs_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- key_audit
DELETE FROM public.key_audit WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.key_audit DROP CONSTRAINT IF EXISTS key_audit_tenant_id_fkey;
ALTER TABLE public.key_audit ADD CONSTRAINT key_audit_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- mcp_servers
DELETE FROM public.mcp_servers WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.mcp_servers DROP CONSTRAINT IF EXISTS mcp_servers_tenant_id_fkey;
ALTER TABLE public.mcp_servers ADD CONSTRAINT mcp_servers_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- mission_campaigns
DELETE FROM public.mission_campaigns WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.mission_campaigns DROP CONSTRAINT IF EXISTS mission_campaigns_tenant_id_fkey;
ALTER TABLE public.mission_campaigns ADD CONSTRAINT mission_campaigns_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- reel_ideas
DELETE FROM public.reel_ideas WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.reel_ideas DROP CONSTRAINT IF EXISTS reel_ideas_tenant_id_fkey;
ALTER TABLE public.reel_ideas ADD CONSTRAINT reel_ideas_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- reel_scans
DELETE FROM public.reel_scans WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.reel_scans DROP CONSTRAINT IF EXISTS reel_scans_tenant_id_fkey;
ALTER TABLE public.reel_scans ADD CONSTRAINT reel_scans_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- skill_library
DELETE FROM public.skill_library WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.skill_library DROP CONSTRAINT IF EXISTS skill_library_tenant_id_fkey;
ALTER TABLE public.skill_library ADD CONSTRAINT skill_library_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- sms_messages
DELETE FROM public.sms_messages WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.sms_messages DROP CONSTRAINT IF EXISTS sms_messages_tenant_id_fkey;
ALTER TABLE public.sms_messages ADD CONSTRAINT sms_messages_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- strategy_genes
DELETE FROM public.strategy_genes WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.strategy_genes DROP CONSTRAINT IF EXISTS strategy_genes_tenant_id_fkey;
ALTER TABLE public.strategy_genes ADD CONSTRAINT strategy_genes_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- tenant_assets
DELETE FROM public.tenant_assets WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.tenant_assets DROP CONSTRAINT IF EXISTS tenant_assets_tenant_id_fkey;
ALTER TABLE public.tenant_assets ADD CONSTRAINT tenant_assets_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;

-- time_savings_log
DELETE FROM public.time_savings_log WHERE tenant_id NOT IN (SELECT id FROM public.tenants);
ALTER TABLE public.time_savings_log DROP CONSTRAINT IF EXISTS time_savings_log_tenant_id_fkey;
ALTER TABLE public.time_savings_log ADD CONSTRAINT time_savings_log_tenant_id_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id) ON DELETE CASCADE;
