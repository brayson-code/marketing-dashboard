'use client';

import { useEffect, useState } from 'react';
import { MailQuestion, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';

// One-click card to switch on the daily stale-lead follow-up sweep. It ships OFF
// (cost-safe), so nothing runs until you activate here. Mirrors the
// ActivateExecsBanner aesthetic; self-hides the moment the sweep is on.
export function ActivateStaleLeadsBanner() {
  const [checked, setChecked] = useState(false);
  const [active, setActive] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    fetch('/api/cron/activate-stale-leads', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j) => { if (!cancel) { if (j.enabled) setActive(true); setChecked(true); } })
      .catch(() => { if (!cancel) setChecked(true); });
    return () => { cancel = true; };
  }, []);

  const activate = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/cron/activate-stale-leads', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error || `Failed (${res.status})`);
      setActive(true);
    } catch (e) {
      setBusy(false);
      setError((e as Error).message);
    }
  };

  if (!checked || active) return null;
  const accent = 'var(--primary)';

  return (
    <div className="panel relative overflow-hidden p-5" data-live="true">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            `radial-gradient(520px circle at 100% -10%, color-mix(in srgb, ${accent} 20%, transparent), transparent 55%),` +
            `radial-gradient(360px circle at 0% 120%, color-mix(in srgb, var(--primary) 12%, transparent), transparent 55%)`,
        }}
      />
      <div aria-hidden className="pointer-events-none absolute inset-0 quick-win-shimmer"
        style={{ background: `linear-gradient(115deg, transparent 35%, color-mix(in srgb, ${accent} 14%, transparent) 50%, transparent 65%)`, mixBlendMode: 'plus-lighter' }} />

      <div className="relative space-y-4">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 grid place-items-center rounded-full shrink-0"
            style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}>
            <MailQuestion size={18} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-h2">Auto-follow-up on stale leads</h2>
              <span className="badge text-[10px]" style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)` }}>
                one click
              </span>
            </div>
            <p className="text-small">
              Once a day, an agent finds contacts who replied but haven&rsquo;t heard back and
              <strong> drafts a reply</strong> to each — straight into your approval queue. Nothing sends
              without you; it only ever drafts, and it runs on <strong>your</strong> Claude key.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={activate} disabled={busy} className="btn btn-primary glow-cta"
            style={{ transition: 'transform var(--t-press) var(--ease-out)' }}>
            {busy ? <><Loader2 size={13} className="animate-spin" /> Activating&hellip;</> : <><Sparkles size={13} /> Turn on daily follow-ups</>}
          </button>
          <span className="text-micro text-muted-foreground inline-flex items-center gap-1">
            <CheckCircle2 size={11} /> Drafts only — review &amp; approve each reply; pause anytime
          </span>
          {error && <span className="text-micro text-destructive">{error}</span>}
        </div>
      </div>
    </div>
  );
}
