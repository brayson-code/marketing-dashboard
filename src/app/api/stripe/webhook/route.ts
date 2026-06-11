import { NextResponse } from 'next/server';
import type Stripe from 'stripe';
import type { Plan } from '@/lib/entitlements';
import {
  getStripe,
  grantPlanToTenant,
  tenantIdForEmail,
  queuePendingEntitlement,
  cancelPendingEntitlement,
  planForPriceId,
  effectivePlan,
  stripeEventSeen,
  markStripeEventProcessed,
} from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// POST /api/stripe/webhook — Stripe's source of truth for "who paid for what".
// This is the ONLY thing that writes tenants.plan from a purchase. It has no user
// session, so every grant targets an explicit tenant id resolved from the event:
//   1. subscription.metadata.tenant_id / checkout client_reference_id (logged-in)
//   2. the buyer's email → auth.users JWT claim                       (cold link)
//   3. no account yet → park a pending entitlement, redeemed on first sign-in
//
// The PLAN comes from the subscription's Price id (authoritative), not status —
// status only decides grant (active/trialing/past_due) vs downgrade-to-free.
//
// Signature is verified against STRIPE_WEBHOOK_SECRET over the RAW body — so we
// must read req.text(), never req.json(). Events are de-duped by id so Stripe's
// at-least-once retries can't double-process.
export async function POST(req: Request) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json({ error: 'STRIPE_WEBHOOK_SECRET not set' }, { status: 503 });
  }

  const sig = req.headers.get('stripe-signature');
  if (!sig) return NextResponse.json({ error: 'Missing stripe-signature' }, { status: 400 });

  let event: Stripe.Event;
  try {
    const raw = await req.text();
    event = getStripe().webhooks.constructEvent(raw, sig, secret);
  } catch (e) {
    // Bad signature or malformed payload — reject so Stripe shows it as failed.
    return NextResponse.json({ error: `Webhook signature failed: ${(e as Error).message}` }, { status: 400 });
  }

  try {
    // Retry dedupe: if we already finished this event, ack and stop.
    if (await stripeEventSeen(event.id)) {
      return NextResponse.json({ received: true, deduped: true });
    }

    switch (event.type) {
      case 'checkout.session.completed': {
        // Fast-path for the logged-in card flow: client_reference_id gives the
        // exact tenant. Only grant once the payment has actually cleared — async
        // methods fire this event with payment_status 'unpaid', and the
        // subscription.* events below are the authoritative grant anyway.
        const s = event.data.object as Stripe.Checkout.Session;
        if (s.payment_status !== 'paid') break;
        const sub = s.subscription
          ? await getStripe().subscriptions.retrieve(
              typeof s.subscription === 'string' ? s.subscription : s.subscription.id,
            )
          : null;
        const plan = planForPriceId(sub?.items.data[0]?.price?.id ?? null);
        if (plan) {
          const email = s.customer_details?.email ?? s.customer_email ?? null;
          await grantTo(s.client_reference_id ?? sub?.metadata?.tenant_id ?? null, email, plan);
        }
        break;
      }
      case 'customer.subscription.created':
      case 'customer.subscription.updated':
      case 'customer.subscription.deleted': {
        const sub = event.data.object as Stripe.Subscription;
        const plan = effectivePlan(sub.status, sub.items.data[0]?.price?.id ?? null);
        await grantFromSubscription(sub, plan);
        break;
      }
      default:
        break; // ignore invoice.*, payment_intent.*, etc.
    }

    await markStripeEventProcessed(event.id);
  } catch (e) {
    // Log details server-side; return a generic 500 so Stripe retries the event
    // (don't silently drop a paid grant, and don't leak internals to the caller).
    console.error('[stripe/webhook] processing failed', event.type, e);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}

/** Grant a known plan: explicit tenant first, then email, then park as pending. */
async function grantTo(tenantId: string | null, email: string | null, plan: Plan): Promise<void> {
  if (tenantId) {
    await grantPlanToTenant(tenantId, plan);
    return;
  }
  if (!email) return;
  const tid = await tenantIdForEmail(email);
  if (tid) {
    await grantPlanToTenant(tid, plan);
  } else if (plan !== 'free') {
    await queuePendingEntitlement(email, plan); // paid before signing up
  } else {
    await cancelPendingEntitlement(email); // canceled before ever signing up
  }
}

/** Grant/downgrade from a subscription event: metadata tenant first, then email. */
async function grantFromSubscription(sub: Stripe.Subscription, plan: Plan): Promise<void> {
  const metaTenant = sub.metadata?.tenant_id;
  if (metaTenant) {
    await grantPlanToTenant(metaTenant, plan);
    return;
  }
  // Payment-Link subscriptions carry no tenant metadata — fall back to the
  // customer's email.
  const customerId = typeof sub.customer === 'string' ? sub.customer : sub.customer?.id;
  if (!customerId) return;
  const customer = await getStripe().customers.retrieve(customerId);
  if (customer.deleted) return;
  await grantTo(null, customer.email, plan);
}
