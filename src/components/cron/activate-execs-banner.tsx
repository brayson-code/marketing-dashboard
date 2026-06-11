'use client';

import { useEffect, useState } from 'react';
import { Crown, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';

const EXECS = [
  { role: 'CEO', label: 'Strategy' },
  { role: 'CMO', label: 'Marketing' },
  { role: 'COO', label: 'Ops' },
  { role: 'CRO', label: 'Revenue' },
  { role: 'CXO', label: 'Clients' },
];

// One-click card to switch on all five seeded C-suite crons at once — they ship
// DISABLED + dormant (cost-safe), so nothing runs until you activate here. Mirrors
// the competitors WatchSeedBanner aesthetic. Self-hides the moment the execs are on.
// data-walkthrough="enable-execs" anchors the setup walkthrough to this card.
export function ActivateExecsBanner() {
  const [checked, setChecked] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch('/api/cron/activate-execs', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: 0 }))
      .then((j) => { if (!cancel) { if ((j.enabled ?? 0) > 0) setActive(true); setChecked(true); } })
      .catch(() => { if (!cancel) setChecked(true); });
    return () => { cancel = true; };
  }, []);

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cron/activate-execs', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
      setActive(true);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  };

  if (!checked || active) return null;
  const accent = 'var(--dept-leadership, var(--primary))';

  return (
    <div className="panel relative overflow-hidden p-5" data-walkthrough="enable-execs" data-live="true">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            `radial-gradient(520px circle at 100% -10%, color-mix(in srgb, ${accent} 22%, transparent), transparent 55%),` +
            `radial-gradient(360px circle at 0% 120%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 55%)`,
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 quick-win-shimmer"
        style={{ background: `linear-gradient(115deg, transparent 35%, color-mix(in srgb, ${accent} 14%, transparent) 50%, transparent 65%)`, mixBlendMode: 'plus-lighter' }} />

      <div className="relative space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 grid place-items-center rounded-full shrink-0"
            style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}>
            <Crown size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-h2">Turn on your AI executive team</h2>
              <span className="badge text-[10px]" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)` }}>
                one click
              </span>
            </div>
            <p className="text-small">
              Your five C-suite agents are set up but paused. Activate them to start working on a schedule —
              each runs on your connected Claude key, so they only ever spend <strong>your</strong> credits, and you can
              pause any of them anytime.
            </p>
          </div>
        </div>

        {/* The five execs */}
        <div className="flex flex-wrap gap-2">
          {EXECS.map((e) => (
            <div key={e.role} className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5"
              style={{ background: `color-mix(in srgb, ${accent} 8%, transparent)`, border: `1px solid color-mix(in srgb, ${accent} 20%, transparent)` }}>
              <span className="text-xs font-semibold" style={{ color: accent }}>AI {e.role}</span>
              <span className="text-[10px] text-muted-foreground">{e.label}</span>
            </div>
          ))}
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={activate} disabled={busy} className="btn btn-primary glow-cta"
            style={{ transition: 'transform var(--t-press) var(--ease-out)' }}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> Activating&hellip;</> : <><Sparkles size={13} /> Activate all 5 executives</>}
          </button>
          <span className="text-micro text-muted-foreground inline-flex items-center gap-1">
            <CheckCircle2 size={11} /> Schedules them on your Cron board — pause or edit any anytime
          </span>
          {error && <span className="text-micro text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
