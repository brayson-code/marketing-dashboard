// Stripe integration — the money path.
//
// Two ways a tenant ends up on a paid plan:
//   1. Logged-in upgrade (billing page) → POST /api/stripe/checkout creates a
//      Checkout Session with client_reference_id = the tenant id AND the plan on
//      subscription metadata. The webhook reads that back and grants exactly that
//      tenant the plan its Price maps to. No guessing.
//   2. Cold webinar traffic → a static Payment Link (STRIPE_PAYMENT_LINK_LITE/PRO)
//      pasted in chat. The buyer may not have an account yet, so the webhook
//      resolves their tenant by email; if no account exists yet we queue a
//      pending entitlement that is redeemed the moment they sign up.
//
// All writes go through the postgres pool (sql()) which bypasses RLS — the
// webhook has no user session, so it can't use the request-scoped tenant path.
// Every write here therefore targets an explicit tenant id.

import Stripe from 'stripe';
import { sql } from './db/client';
import type { Plan } from './entitlements';

let _stripe: Stripe | null = null;

/** Lazy Stripe client. Throws (caught by callers) if the secret key is absent. */
export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error('STRIPE_SECRET_KEY is not set.');
    _stripe = new Stripe(key);
  }
  return _stripe;
}

/** True when Stripe is configured enough to attempt checkout. */
export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

// The two paid tiers we sell, each backed by its own recurring Stripe Price.
export type PaidPlan = 'lite' | 'pro';
const PRICE_ENV: Record<PaidPlan, string> = {
  lite: 'STRIPE_PRICE_ID_LITE',
  pro: 'STRIPE_PRICE_ID_PRO',
};

/** The recurring Price id a given paid plan buys. */
export function priceIdForPlan(plan: PaidPlan): string {
  const id = process.env[PRICE_ENV[plan]];
  if (!id) throw new Error(`${PRICE_ENV[plan]} is not set.`);
  return id;
}

/** Reverse-map a Stripe Price id back to the plan it sells (authoritative). */
export function planForPriceId(priceId: string | null | undefined): PaidPlan | null {
  if (!priceId) return null;
  if (priceId === process.env.STRIPE_PRICE_ID_PRO) return 'pro';
  if (priceId === process.env.STRIPE_PRICE_ID_LITE) return 'lite';
  return null;
}

/** Static no-login Payment Link (for webinar chat) for a given plan, if set. */
export function paymentLinkUrl(plan: PaidPlan): string | null {
  return process.env[`STRIPE_PAYMENT_LINK_${plan.toUpperCase()}`] || null;
}

/**
 * The plan a tenant should hold given a subscription's status AND price.
 * Status decides grant-vs-revoke; the price decides WHICH paid tier. Both Lite
 * and Pro are paid now, so a canceled/unpaid sub drops to free (no paid features).
 */
export function effectivePlan(
  status: Stripe.Subscription.Status,
  priceId: string | null | undefined,
): Plan {
  const active = status === 'active' || status === 'trialing' || status === 'past_due';
  if (!active) return 'free';
  return planForPriceId(priceId) ?? 'free';
}

/** Set a tenant's plan. NOTE: public.tenants has no updated_at column. */
export async function grantPlanToTenant(tenantId: string, plan: Plan): Promise<void> {
  await sql()`UPDATE public.tenants SET plan = ${plan} WHERE id = ${tenantId}`;
}

/**
 * Resolve a tenant id from a buyer's email via auth.users' JWT claim
 * (raw_app_meta_data -> tenant_id). Prefers an account that actually HAS a claim,
 * most-recently-active first. Returns null when no such account exists yet.
 */
export async function tenantIdForEmail(email: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT raw_app_meta_data ->> 'tenant_id' AS tenant_id
    FROM auth.users
    WHERE lower(email) = lower(${email})
      AND raw_app_meta_data ->> 'tenant_id' IS NOT NULL
    ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC
    LIMIT 1
  `) as unknown as Array<{ tenant_id: string | null }>;
  return rows[0]?.tenant_id ?? null;
}

/**
 * Park a paid plan against an email that has no account yet (cold buyer pays
 * before signing up). Redeemed by redeemPendingEntitlement() on first sign-in.
 * On conflict we only refresh a row that hasn't been consumed yet — so a retried
 * webhook can never re-open an already-redeemed entitlement.
 */
export async function queuePendingEntitlement(email: string, plan: Plan): Promise<void> {
  await sql()`
    INSERT INTO public.pending_entitlements (email, plan)
    VALUES (lower(${email}), ${plan})
    ON CONFLICT (email) DO UPDATE
      SET plan = EXCLUDED.plan, created_at = now()
      WHERE public.pending_entitlements.consumed_at IS NULL
  `;
}

/** Drop an unredeemed pending entitlement (e.g. the cold buyer canceled before
 *  ever signing up). No-op once it's been consumed. */
export async function cancelPendingEntitlement(email: string): Promise<void> {
  await sql()`
    DELETE FROM public.pending_entitlements
    WHERE email = lower(${email}) AND consumed_at IS NULL
  `;
}

/**
 * If `email` has an unredeemed pending entitlement, grant it to `tenantId`.
 * Grant FIRST, then mark consumed — so a failure between the two re-grants the
 * SAME plan next time (idempotent) rather than consuming the row without granting.
 * Returns the granted plan, or null when there was nothing to redeem.
 */
export async function redeemPendingEntitlement(email: string, tenantId: string): Promise<Plan | null> {
  const rows = (await sql()`
    SELECT plan FROM public.pending_entitlements
    WHERE email = lower(${email}) AND consumed_at IS NULL
    LIMIT 1
  `) as unknown as Array<{ plan: string }>;
  const plan = rows[0]?.plan as Plan | undefined;
  if (!plan) return null;
  await grantPlanToTenant(tenantId, plan);
  await sql()`
    UPDATE public.pending_entitlements SET consumed_at = now()
    WHERE email = lower(${email}) AND consumed_at IS NULL
  `;
  return plan;
}

/** True if this Stripe event id was already processed (retry dedupe). */
export async function stripeEventSeen(eventId: string): Promise<boolean> {
  const rows = (await sql()`
    SELECT 1 FROM public.processed_stripe_events WHERE event_id = ${eventId} LIMIT 1
  `) as unknown as unknown[];
  return rows.length > 0;
}

/** Record a Stripe event id as processed (after successful handling). */
export async function markStripeEventProcessed(eventId: string): Promise<void> {
  await sql()`
    INSERT INTO public.processed_stripe_events (event_id) VALUES (${eventId})
    ON CONFLICT DO NOTHING
  `;
}
