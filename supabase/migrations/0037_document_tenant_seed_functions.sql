-- 0037 — Make the new-tenant seed functions auditable from the repo.
--
-- on_new_tenant_seed() + seed_org_chart() already exist in the live database
-- (applied out-of-band during the C-suite seeding work) but their bodies were
-- never committed — only 0030 referenced them. A load-test credit-safety review
-- flagged this: the guarantee that NEW tenants get their executive crons seeded
-- DISABLED (so no agent runs / no API spend without an explicit opt-in) could
-- not be verified from source. This migration is CREATE OR REPLACE of the exact
-- live definitions (dumped from production), so the behavior is now auditable
-- and reproducible. No behavior change.
--
-- Security-review note: this is the only thing a fresh client tenant gets
-- automatically — bundled agent definitions copied from HQ, and C-suite cron
-- rows that are enabled=false / next_run_at=NULL. Nothing runs, nothing spends,
-- until the owner explicitly activates it.

CREATE OR REPLACE FUNCTION public.seed_org_chart(target_tenant uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  hq_tenant uuid := 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';
BEGIN
  IF target_tenant = hq_tenant THEN RETURN; END IF;

  INSERT INTO public.agent_defs (
    tenant_id, id, name, role, role_title, department, is_executive,
    model, max_tokens, rate_per_hour, description,
    soul, agent_md, skills, spawnable, enabled, source
  )
  SELECT
    target_tenant, id, name, role, role_title, department, is_executive,
    model, max_tokens, rate_per_hour, description,
    soul, agent_md, skills, spawnable, enabled, source
  FROM public.agent_defs
  WHERE tenant_id = hq_tenant
  ON CONFLICT (tenant_id, id) DO NOTHING;

  -- Seed the C-suite crons DISABLED + dormant. New clients opt in explicitly
  -- (cost-safe) rather than inheriting HQ's enabled state.
  INSERT INTO public.cron_jobs (
    tenant_id, id, name, agent_id, enabled,
    schedule_expr, schedule_tz, payload, next_run_at
  )
  SELECT
    target_tenant, id, name, agent_id, false,
    schedule_expr, schedule_tz, payload, NULL
  FROM public.cron_jobs
  WHERE tenant_id = hq_tenant
    AND agent_id IN ('ai-ceo','ai-cmo','ai-coo','ai-cro','ai-cxo')
  ON CONFLICT (tenant_id, id) DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.on_new_tenant_seed()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public.seed_org_chart(NEW.id);
  RETURN NEW;
END;
$function$;
