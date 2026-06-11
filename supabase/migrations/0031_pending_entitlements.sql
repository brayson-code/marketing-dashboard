-- Pending entitlements: a paid plan parked against an email that has no account
-- yet (cold webinar buyer pays via a Payment Link before signing up). Redeemed
-- the first time that email signs in (see src/lib/stripe.ts redeemPendingEntitlement).
--
-- Keyed by email, NOT tenant_id, so it must never be client-readable (it would
-- leak who bought what). RLS is enabled with NO policy: the anon/authenticated
-- roles see zero rows; only the backend (postgres role, bypasses RLS) can read or
-- write it.

create table if not exists public.pending_entitlements (
  email       text primary key,
  plan        text not null,
  created_at  timestamptz not null default now(),
  consumed_at timestamptz
);

alter table public.pending_entitlements enable row level security;
-- intentionally no policy: backend-only access.
