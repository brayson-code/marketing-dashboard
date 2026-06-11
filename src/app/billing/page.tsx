'use client';

import { useEffect, useState } from 'react';
import { Check, Sparkles, Loader2, Zap } from 'lucide-react';

interface Catalog { [k: string]: { label: string; rank: number; pages: { boardroom: boolean; kg: boolean; genes: boolean }; autonomy: string[]; connections_max: number; agents_max: number } }
interface Entitlements { plan: string; features: Catalog[string]; next: string | null; catalog: Catalog }

const HUMAN_AUTONOMY: Record<string, string> = { observe: 'Observe', propose: 'Propose', act_notify: 'Act + Notify', full_auto: 'Full Auto' };

// Kicks off Stripe Checkout for the current tenant. The server creates the
// session (tenant id rides along as client_reference_id) and returns the hosted
// URL; we just redirect. A 503 means STRIPE_SECRET_KEY/PRICE aren't set yet.
async function startCheckout(plan: string, setBusy: (v: boolean) => void) {
  setBusy(true);
  try {
    const res = await fetch('/api/stripe/checkout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ plan }),
    });
    const json = await res.json();
    if (res.ok && json.url) {
      window.location.href = json.url as string;
      return;
    }
    alert(json.error || 'Could not start checkout. Please try again.');
  } catch (e) {
    alert((e as Error).message);
  } finally {
    setBusy(false);
  }
}

const PRICE_LABELS: Record<string, string> = {
  lite: process.env.NEXT_PUBLIC_LITE_PRICE_LABEL || '$—',
  pro: process.env.NEXT_PUBLIC_PRO_PRICE_LABEL || '$—',
};

export default function BillingPage() {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch('/api/entitlements', { cache: 'no-store' }).then((r) => r.json()).then(setEnt).catch(() => setEnt(null));
  }, []);
  if (!ent) return <div className="p-6 text-sm text-muted-foreground"><Loader2 size={14} className="inline animate-spin mr-2" />Loading…</div>;

  // Show only the real paid tiers (skip legacy 'starter' which is just an alias for Lite,
  // and 'free' until we decide to actually sell it).
  const visiblePlans = ['lite', 'pro'].filter((p) => ent.catalog[p]);

  return (
    <div className="space-y-6 animate-in max-w-4xl">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Sparkles size={18} className="text-primary" /> Plans &amp; Billing
        </h1>
        <p className="text-xs text-muted-foreground">
          You are currently on <strong>{ent.catalog[ent.plan]?.label ?? ent.plan}</strong>.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-walkthrough="billing-plan">
        {visiblePlans.map((p) => {
          const f = ent.catalog[p];
          const isCurrent = ent.plan === p || (ent.plan === 'starter' && p === 'lite');
          const isPro = p === 'pro';
          return (
            <div key={p} className="panel relative overflow-hidden">
              {isPro && (
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-0"
                  style={{ background: 'radial-gradient(500px circle at 100% -10%, rgba(16,217,130,0.15), transparent 60%)' }}
                />
              )}
              <div className="relative p-6 space-y-5">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{f.label}</div>
                    <div className="text-2xl font-semibold">
                      {PRICE_LABELS[p] ?? '$—'}<span className="text-xs text-muted-foreground font-normal"> / mo</span>
                    </div>
                  </div>
                  {isCurrent && <span className="badge badge-success">Current plan</span>}
                  {isPro && !isCurrent && <span className="badge" style={{ background: 'var(--primary)', color: 'var(--primary-foreground)' }}>Recommended</span>}
                </div>

                <ul className="space-y-2 text-sm">
                  <Row enabled={f.agents_max === Infinity || f.agents_max >= 10} label={f.agents_max === Infinity ? 'Every agent' : `${f.agents_max} agents`} />
                  <Row enabled={f.connections_max === Infinity} label={f.connections_max === Infinity ? 'Unlimited connections' : `${f.connections_max} connection`} />
                  <Row enabled={f.autonomy.length >= 4} label={`Autonomy: ${f.autonomy.map((a) => HUMAN_AUTONOMY[a] ?? a).join(' · ')}`} />
                  <Row enabled={f.pages.boardroom} label="Boardroom" />
                  <Row enabled={f.pages.kg} label="Knowledge Graph" />
                  <Row enabled={f.pages.genes} label="Genes" />
                </ul>

                {isCurrent ? (
                  <button disabled className="btn btn-ghost btn-sm w-full">You’re on this plan</button>
                ) : isPro ? (
                  <button disabled={busy} onClick={() => startCheckout(p, setBusy)} className="btn btn-primary btn-sm w-full">
                    {busy ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />} Upgrade to {f.label}
                  </button>
                ) : (
                  <button disabled={busy} onClick={() => startCheckout(p, setBusy)} className="btn btn-ghost btn-sm w-full">Switch to {f.label}</button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-muted-foreground">
        Pricing is set per workspace, billed monthly. Stripe-hosted checkout — your card never touches our servers.
      </p>
    </div>
  );
}

function Row({ enabled, label }: { enabled: boolean; label: string }) {
  return (
    <li className={`flex items-center gap-2 ${enabled ? '' : 'opacity-40 line-through'}`}>
      <Check size={13} className={enabled ? 'text-[var(--primary)]' : 'text-muted-foreground'} />
      <span>{label}</span>
    </li>
  );
}
