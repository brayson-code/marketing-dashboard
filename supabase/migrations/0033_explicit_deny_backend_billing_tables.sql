-- Explicit deny-all RLS policies on the two backend-only billing tables.
--
-- These tables (pending_entitlements, processed_stripe_events) key on email /
-- Stripe ids, never on tenant_id, and must NEVER be reachable from the browser.
-- They already have RLS enabled with no policy (= default deny) AND all grants
-- revoked from anon/authenticated (migration 0032). This adds an EXPLICIT
-- deny policy so the "no client access, ever" intent is visible in the schema
-- and the linter's rls_enabled_no_policy advisory is cleared.
--
-- Defense-in-depth only — NO behavior change: the backend connects as the
-- postgres role, which bypasses RLS, so the webhook still reads/writes freely.

drop policy if exists pending_entitlements_no_client on public.pending_entitlements;
create policy pending_entitlements_no_client on public.pending_entitlements
  for all to anon, authenticated using (false) with check (false);

drop policy if exists processed_stripe_events_no_client on public.processed_stripe_events;
create policy processed_stripe_events_no_client on public.processed_stripe_events
  for all to anon, authenticated using (false) with check (false);
