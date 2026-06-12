'use client';

import { useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { Lock, Sparkles, Loader2 } from 'lucide-react';

interface Entitlements {
  plan: 'free' | 'lite' | 'pro' | 'starter';
  features: {
    pages: { boardroom: boolean; kg: boolean; genes: boolean };
  };
  next: string | null;
  catalog: Record<string, { label: string }>;
}

type FeatureKey = keyof Entitlements['features']['pages'];

/**
 * Wraps a Pro-only page. If the current tenant's plan doesn't include the
 * feature, we render a glass "Upgrade" card in place of the children. We keep
 * the route reachable from the nav so the CTA stays visible — better for
 * conversion than hiding the menu item entirely.
 */
export function UpgradeGate({ feature, title, children }: { feature: FeatureKey; title: string; children: ReactNode }) {
  const [ent, setEnt] = useState<Entitlements | null>(null);
  useEffect(() => {
    fetch('/api/entitlements', { cache: 'no-store' })
      .then((r) => r.json())
      .then(setEnt)
      .catch(() => setEnt(null));
  }, []);

  if (!ent) {
    return <div className="p-6 text-sm text-muted-foreground"><Loader2 size={14} className="inline animate-spin mr-2" />Loading…</div>;
  }
  if (ent.features.pages[feature]) return <>{children}</>;

  const nextLabel = ent.next ? (ent.catalog[ent.next]?.label ?? ent.next) : 'Pro';
  return (
    <div className="space-y-4 animate-in max-w-2xl mx-auto">
      <div className="panel relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0"
          style={{ background: 'radial-gradient(600px circle at 20% -10%, rgba(16,217,130,0.18), transparent 55%)' }}
        />
        <div className="relative p-8 space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-border/60 bg-[var(--surface-2)] px-3 py-1 text-[11px] font-medium text-muted-foreground">
            <Lock size={11} /> {title} · {nextLabel}-only
          </div>
          <h1 className="text-2xl font-semibold leading-tight tracking-tight">
            {title} is part of <span className="text-[var(--primary)]">{nextLabel}</span>.
          </h1>
          <p className="max-w-md text-sm leading-relaxed text-muted-foreground">
            Your workspace is on <strong>{ent.catalog[ent.plan]?.label ?? ent.plan}</strong>.
            Upgrade to unlock Boardroom, the Knowledge Graph, Genes, every agent, and all four autonomy modes.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/billing" className="btn btn-primary btn-sm">
              <Sparkles size={13} /> Upgrade to {nextLabel}
            </Link>
            <Link href="/billing" className="btn btn-ghost btn-sm">See plans</Link>
          </div>
        </div>
      </div>
    </div>
  );
}
