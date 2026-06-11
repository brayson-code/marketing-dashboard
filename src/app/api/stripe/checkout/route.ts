import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { createClient } from '@/lib/supabase/server';
import { tenantId, DEFAULT_TENANT_ID, NO_TENANT_ID } from '@/lib/tenant';
import { getStripe, stripeConfigured, priceIdForPlan, type PaidPlan } from '@/lib/stripe';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Resolve the public origin behind the Vercel proxy. new URL(req.url).origin can
// be the internal deployment URL, so prefer the browser Origin header (the billing
// page POSTs same-origin), then the forwarded host, then the request URL.
function publicOrigin(req: Request): string {
  const h = req.headers;
  const origin = h.get('origin');
  if (origin) return origin;
  const host = h.get('x-forwarded-host') ?? h.get('host');
  if (host) return `${h.get('x-forwarded-proto') ?? 'https'}://${host}`;
  return new URL(req.url).origin;
}

// POST /api/stripe/checkout { plan: 'lite' | 'pro' } → a Stripe Checkout Session
// URL for the current tenant. The tenant id rides along as client_reference_id
// AND on the subscription metadata, so the webhook can grant the right plan to
// exactly this tenant on payment and downgrade it on cancel — no email guessing.
export async function POST(req: Request) {
  enterTenant(await resolveTenant());

  // Authenticate first (don't leak config state to anonymous callers).
  const supabase = await createClient();
  const { data } = await supabase.auth.getUser();
  const user = data.user;
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });

  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: 'Checkout is not configured yet.' },
      { status: 503 },
    );
  }

  // Never bill against the system/HQ tenant — if the user's JWT has no tenant
  // claim, we can't safely attribute the purchase.
  const tid = tenantId();
  if (!tid || tid === DEFAULT_TENANT_ID || tid === NO_TENANT_ID) {
    return NextResponse.json(
      { error: 'Your workspace is still being set up. Please refresh and try again.' },
      { status: 409 },
    );
  }

  try {
    const body = (await req.json().catch(() => ({}))) as { plan?: string };
    const plan: PaidPlan | null = body.plan === 'lite' || body.plan === 'pro' ? body.plan : null;
    if (!plan) return NextResponse.json({ error: 'Invalid plan' }, { status: 400 });

    const origin = publicOrigin(req);
    const session = await getStripe().checkout.sessions.create({
      mode: 'subscription',
      line_items: [{ price: priceIdForPlan(plan), quantity: 1 }],
      client_reference_id: tid,
      customer_email: user.email ?? undefined,
      metadata: { tenant_id: tid, plan },
      subscription_data: { metadata: { tenant_id: tid, plan } },
      allow_promotion_codes: true,
      success_url: `${origin}/billing?upgraded=1`,
      cancel_url: `${origin}/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (e) {
    console.error('[stripe/checkout]', e);
    return NextResponse.json({ error: 'Could not start checkout. Please try again.' }, { status: 500 });
  }
}
