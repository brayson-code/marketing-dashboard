-- Stripe webhook idempotency + defense-in-depth on the backend-only billing tables.
--
-- processed_stripe_events: Stripe delivers events at-least-once and may retry.
-- The webhook records each event id here after handling it and skips ids it has
-- already seen, so a retry can't double-process. Backend-only (RLS on, no policy,
-- and EXECUTE/SELECT revoked from the API roles).
create table if not exists public.processed_stripe_events (
  event_id     text primary key,
  processed_at timestamptz not null default now()
);
alter table public.processed_stripe_events enable row level security;

-- These two tables must NEVER be reachable via PostgREST (they key on email /
-- Stripe ids, not tenant_id). RLS already denies row access, but also drop the
-- table grants so the endpoints aren't even exposed to anon/authenticated.
revoke all on public.processed_stripe_events from anon, authenticated;
revoke all on public.pending_entitlements from anon, authenticated;
