'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Telescope, Sparkles, Loader2, CheckCircle2 } from 'lucide-react';

// The cron job we seed — identical to the Cron board's built-in "competitor-watch"
// starter, so the daily sweep is created with one click from here instead of
// hand-editing JSON on /cron. kind:'watchlist' makes the dispatcher run
// runWatchlistDue() (not spawn a single agent off `message`).
const WATCH_JOB = {
  id: 'competitor-watch',
  name: 'Competitor watchlist (daily)',
  agentId: 'reel-analyst',
  enabled: true,
  schedule: { expr: '0 9 * * *', tz: 'America/New_York' },
  payload: {
    kind: 'watchlist',
    message: "Sweep the competitor watchlist: fetch each due competitor's recent reels and analyze the top new performer(s).",
    saveToKb: false,
  },
  skill: 'research',
};

type Job = { id?: string; name?: string; payload?: { kind?: string } };

function alreadySeeded(jobs: Job[]): boolean {
  return jobs.some(
    (j) => j.id === 'competitor-watch' || j.payload?.kind === 'watchlist' || /watchlist/i.test(j.name ?? ''),
  );
}

// Flashy one-click CTA to put competitor research on autopilot. Mirrors the
// QuickWinCountdown aesthetic (layered radials + shimmer + glow). Renders nothing
// once the daily watch job exists — so it disappears the moment it's seeded.
export function WatchSeedBanner() {
  const router = useRouter();
  const [checked, setChecked] = useState(false);
  const [seeded, setSeeded] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // On mount, ask the cron board whether the watch job already exists.
  useEffect(() => {
    let cancel = false;
    fetch('/api/cron/jobs', { cache: 'no-store' })
      .then((r) => r.json())
      .then((j) => {
        if (cancel) return;
        if (Array.isArray(j.jobs) && alreadySeeded(j.jobs)) setSeeded(true);
        setChecked(true);
      })
      .catch(() => { if (!cancel) setChecked(true); });
    return () => { cancel = true; };
  }, []);

  const seed = async () => {
    setSeeding(true);
    setError(null);
    try {
      const res = await fetch('/api/cron/jobs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ job: WATCH_JOB }),
      });
      const j = await res.json().catch(() => ({}));
      // 409 = it already exists; treat as success (idempotent activation).
      if (!res.ok && res.status !== 409) throw new Error(j.error || `Failed (${res.status})`);
      setSeeded(true);
      // End view: drop the user on the Cron board to see the live job.
      router.push('/cron');
    } catch (e) {
      setSeeding(false);
      setError((e as Error).message);
    }
  };

  // Hide until we know the state, and forever once seeded — so it "removes
  // itself" the moment the job is created.
  if (!checked || seeded) return null;

  const accent = 'var(--primary)';

  return (
    <div className="panel relative overflow-hidden p-5" data-live="true">
      {/* Layered backdrop — primary radial top-right + a soft tri-color dept wash. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            `radial-gradient(520px circle at 100% -10%, color-mix(in srgb, ${accent} 24%, transparent), transparent 55%),` +
            `radial-gradient(380px circle at 0% 110%, color-mix(in srgb, var(--dept-marketing) 14%, transparent), transparent 55%),` +
            `radial-gradient(300px circle at 60% 120%, color-mix(in srgb, var(--dept-revenue) 10%, transparent), transparent 55%)`,
        }}
      />
      {/* Slow shimmer sweep — shared with the activation countdown. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 quick-win-shimmer"
        style={{
          background: `linear-gradient(115deg, transparent 35%, color-mix(in srgb, ${accent} 14%, transparent) 50%, transparent 65%)`,
          mixBlendMode: 'plus-lighter',
        }}
      />
      <div className="relative grid grid-cols-1 sm:grid-cols-[200px_1fr] gap-5 items-center">
        {/* Focal element — the daily sweep time, glowing like the countdown clock. */}
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-wider text-muted-foreground">Daily sweep at</div>
          <div
            className="tabular-nums leading-none font-semibold tracking-tight"
            style={{ color: 'var(--dept-leadership)', fontSize: '2.25rem', textShadow: `0 0 24px color-mix(in srgb, var(--dept-leadership) 55%, transparent)` }}
          >
            9:00<span className="text-base font-medium ml-1 align-top">AM</span>
          </div>
          <div className="text-[10px] text-muted-foreground flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full pulse-dot" style={{ background: accent }} /> every morning, automatically
          </div>
        </div>

        <div className="space-y-3 min-w-0">
          <div className="flex items-start gap-3">
            <div
              className="h-10 w-10 grid place-items-center rounded-full shrink-0"
              style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}
            >
              <Telescope size={18} />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-h2">Put competitor research on autopilot</h2>
                <span
                  className="badge text-[10px]"
                  style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)` }}
                >
                  one click
                </span>
              </div>
              <p className="text-small">
                Seed a daily watchlist sweep — every morning KeyCommand pulls your competitors&rsquo; new reels and tears
                down what&rsquo;s winning, so the intel&rsquo;s ready before you are.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 flex-wrap">
            <button
              type="button"
              onClick={seed}
              disabled={seeding}
              className="btn btn-primary glow-cta"
              style={{ transition: 'transform var(--t-press) var(--ease-out)' }}
            >
              {seeding ? <><Loader2 size={13} className="animate-spin" /> Activating&hellip;</> : <><Sparkles size={13} /> Activate daily watch</>}
            </button>
            <span className="text-micro text-muted-foreground inline-flex items-center gap-1">
              <CheckCircle2 size={11} /> Creates the job on your Cron board — edit or pause it anytime
            </span>
            {error && <span className="text-micro text-destructive">{error}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
