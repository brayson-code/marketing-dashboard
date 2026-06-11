'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Sparkles, CheckCircle2, Circle, Trophy, X, AlertCircle } from 'lucide-react';

interface Milestone {
  key: string;
  label: string;
  description: string;
  cta_label: string;
  cta_href: string;
  done: boolean;
  done_at: string | null;
}

interface ActivationState {
  started: boolean;
  started_at: string | null;
  deadline_at: string | null;
  seconds_remaining: number | null;
  milestones: Milestone[];
  completed_count: number;
  total: number;
  activated: boolean;
  quick_mission_id: string | null;
}

// 72-hour activation card on Overview. Drives the user toward their first
// publish in three days. Two visible elements: the clock + the checklist. The
// clock uses dept-warning amber when <12hr left, dept-destructive when overdue,
// and the panel celebrates when activated. Polls /api/activation/state every
// 20s so a freshly-approved draft flips a row without a page reload.
export function QuickWinCountdown() {
  const [state, setState] = useState<ActivationState | null>(null);
  const [dismissed, setDismissed] = useState(false);

  // Restore dismiss state from localStorage so completing-and-dismissing sticks.
  useEffect(() => {
    try {
      if (localStorage.getItem('activation.dismissed') === '1') setDismissed(true);
    } catch { /* blocked */ }
  }, []);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      fetch('/api/activation/state', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (!cancel && !j.error) setState(j); })
        .catch(() => {});
    };
    load();
    const t = setInterval(load, 20_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  // Re-tick the countdown every second so the timer feels alive without
  // re-fetching. We only need to bump a render counter.
  const [, setTick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  if (!state || !state.started || dismissed) return null;

  const { milestones, completed_count: done, total, deadline_at, activated, quick_mission_id } = state;
  const pct = Math.round((done / total) * 100);

  // Derive a live countdown from deadline rather than state.seconds_remaining
  // (which goes stale between polls).
  const deadlineMs = deadline_at ? new Date(deadline_at).getTime() : null;
  const remainingSec = deadlineMs ? Math.floor((deadlineMs - Date.now()) / 1000) : 0;
  const overdue = remainingSec < 0;
  const urgent = !overdue && remainingSec < 12 * 3600;
  // Panel-wide accent — primary by default, warning amber when <12hr, destructive
  // when overdue. The headline COUNTDOWN itself locks to brand green except
  // when overdue (urgency still reads); see `countdownColor` below.
  const accent = activated ? 'var(--primary)' : overdue ? 'var(--destructive)' : urgent ? 'var(--warning)' : 'var(--primary)';
  // Re-theme the card's --primary to the accent ONLY when it differs (urgent /
  // overdue). Setting --primary: var(--primary) is a self-reference → invalid →
  // it blanks out the primary buttons. Skip the override when accent is primary.
  const primaryOverride: React.CSSProperties = accent === 'var(--primary)' ? {} : { ['--primary' as string]: accent };
  const countdownColor = overdue ? 'var(--destructive)' : 'var(--dept-leadership)';

  const nextStep = milestones.find((m) => !m.done);

  const dismiss = () => {
    setDismissed(true);
    try { localStorage.setItem('activation.dismissed', '1'); } catch { /* blocked */ }
  };

  return (
    <div
      className="panel relative overflow-hidden p-5"
      data-live={activated || urgent ? 'true' : undefined}
      style={primaryOverride}
    >
      {/* Layered backdrop — primary radial at the top-right, plus a soft tri-color
          wash from the department palette cycling underneath. Reads as "this is
          a celebratory moment" without becoming a gradient soup. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            `radial-gradient(520px circle at 100% -10%, color-mix(in srgb, ${accent} ${activated ? 32 : urgent ? 26 : 22}%, transparent), transparent 55%),` +
            `radial-gradient(380px circle at 0% 110%, color-mix(in srgb, var(--dept-marketing) 14%, transparent), transparent 55%),` +
            `radial-gradient(300px circle at 60% 120%, color-mix(in srgb, var(--dept-revenue) 10%, transparent), transparent 55%)`,
        }}
      />
      {/* Slow shimmer sweep across the panel — only when not overdue (we don't
          want sparkle while we're behind schedule). */}
      {!overdue && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 quick-win-shimmer"
          style={{
            background: `linear-gradient(115deg, transparent 35%, color-mix(in srgb, ${accent} 14%, transparent) 50%, transparent 65%)`,
            mixBlendMode: 'plus-lighter',
          }}
        />
      )}
      <div className="relative space-y-4">
        <div className="flex items-start gap-3">
          <div
            className="h-10 w-10 grid place-items-center rounded-full shrink-0"
            style={{ background: `color-mix(in srgb, ${accent} 16%, transparent)`, color: accent, border: `1px solid color-mix(in srgb, ${accent} 35%, transparent)` }}
          >
            {activated ? <Trophy size={18} /> : <Sparkles size={18} />}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-h2">
                {activated ? "You're activated." : overdue ? 'Quick win — overdue' : 'Get your first quick win'}
              </h2>
              {!activated && (
                <span
                  className="badge text-[10px]"
                  style={{
                    background: `color-mix(in srgb, ${accent} 16%, transparent)`,
                    color: accent,
                    border: `1px solid color-mix(in srgb, ${accent} 32%, transparent)`,
                  }}
                >
                  {overdue ? 'past 72h' : 'in 72 hours'}
                </span>
              )}
            </div>
            <p className="text-small">
              {activated
                ? 'You shipped your first draft. The flywheel is spinning — keep going.'
                : overdue
                ? 'You can still finish — KeyPlayers can hop on a 15-min call to unblock you.'
                : "We've launched a first mission for you. Approve a draft and publish it within 72 hours."}
            </p>
          </div>
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            className="p-1 rounded text-muted-foreground hover:text-foreground"
            style={{ transition: 'color var(--t-popover) var(--ease-out)' }}
          >
            <X size={14} />
          </button>
        </div>

        {/* Countdown + progress strip — timer locked to brand green (escalates to
            destructive red only when overdue); ~20% larger than text-display so
            the clock reads as the focal element of the panel. */}
        <div className="grid grid-cols-1 sm:grid-cols-[240px_1fr] gap-4 items-center">
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {activated ? 'Time to first win' : overdue ? 'Overdue by' : 'Time remaining'}
            </div>
            <div
              className="tabular-nums leading-none font-semibold tracking-tight"
              style={{
                color: countdownColor,
                fontSize: '2.25rem',
                textShadow: !overdue ? `0 0 24px color-mix(in srgb, ${countdownColor} 55%, transparent)` : undefined,
              }}
            >
              {formatCountdown(Math.abs(remainingSec))}
            </div>
            <div className="text-[10px] text-muted-foreground">
              {activated ? formatRelativeStarted(state.started_at) : overdue ? 'every hour counts' : 'tick · tock'}
            </div>
          </div>
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-micro">
              <span className="text-muted-foreground">{done} of {total} done</span>
              <span className="font-mono tabular-nums" style={{ color: accent }}>{pct}%</span>
            </div>
            <div className="h-2 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
              <div
                className="h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, background: accent, boxShadow: `0 0 14px ${accent}` }}
              />
            </div>
          </div>
        </div>

        {/* Milestone checklist — each step takes one department color from the
            org-chart palette so the strip reads as a colorful progress bar
            rather than five identical chips. */}
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {milestones.map((m, i) => {
            const c = `var(${MILESTONE_COLOR_VARS[i % MILESTONE_COLOR_VARS.length]})`;
            return (
              <Link
                key={m.key}
                href={m.cta_href}
                className="rounded-lg p-2.5 flex items-start gap-2 group focus-ring"
                style={{
                  border: `1px solid color-mix(in srgb, ${c} ${m.done ? 55 : 28}%, transparent)`,
                  background: `color-mix(in srgb, ${c} ${m.done ? 14 : 7}%, var(--surface-2))`,
                  transition: 'background-color var(--t-popover) var(--ease-out), border-color var(--t-popover) var(--ease-out)',
                }}
                title={m.description}
              >
                {m.done
                  ? <CheckCircle2 size={14} className="shrink-0 mt-0.5" style={{ color: c, filter: `drop-shadow(0 0 4px ${c})` }} />
                  : <Circle size={14} className="shrink-0 mt-0.5" style={{ color: c, opacity: 0.6 }} />}
                <div className="min-w-0 flex-1">
                  <div className={`text-[11px] font-medium leading-snug ${m.done ? 'line-through opacity-60' : ''}`}>{m.label}</div>
                  {!m.done && <div className="text-[10px] mt-0.5" style={{ color: c, opacity: 0.85 }}>{m.cta_label} →</div>}
                </div>
              </Link>
            );
          })}
        </div>

        {/* CTA strip — the most useful next action surfaces here. */}
        {!activated && nextStep && (
          <div className="flex items-center justify-between gap-3 pt-1">
            <div className="text-small min-w-0 flex-1">
              <span className="text-muted-foreground">Next:</span>{' '}
              <span className="font-medium">{nextStep.description}</span>
            </div>
            <Link
              href={nextStep.cta_href}
              className="btn btn-primary"
              style={{ ...primaryOverride, transition: 'transform var(--t-press) var(--ease-out)' }}
            >
              <Sparkles size={12} /> {nextStep.cta_label}
            </Link>
          </div>
        )}

        {/* When activated, point them at the mission that did it. */}
        {activated && quick_mission_id && (
          <Link href={`/missions`} className="btn btn-primary self-start" style={primaryOverride}>
            <Trophy size={12} /> Open the mission that won it
          </Link>
        )}

        {/* Overdue rescue — surface the "talk to a human" path so the user
            doesn't quietly churn on us. */}
        {overdue && !activated && (
          <div className="flex items-center gap-2 text-small p-2.5 rounded-lg border border-[color-mix(in_srgb,var(--destructive)_30%,transparent)] bg-[color-mix(in_srgb,var(--destructive)_8%,transparent)]">
            <AlertCircle size={14} className="text-[var(--destructive)] shrink-0" />
            <span>Stuck? Book a 15-minute onboarding call with KeyPlayers.</span>
            <a href="mailto:brayson@keyplayershq.com?subject=KeyCommand%20onboarding%20help" className="ml-auto btn btn-secondary !text-[11px]">Book a call</a>
          </div>
        )}
      </div>
    </div>
  );
}

// Five milestone colors cycled from the department palette. Order matches the
// natural progression of activation — leadership → marketing → revenue →
// operations → client_experience — so the strip ends warm (amber) like a finish line.
const MILESTONE_COLOR_VARS = [
  '--dept-leadership',
  '--dept-marketing',
  '--dept-revenue',
  '--dept-operations',
  '--dept-client-experience',
];

function formatCountdown(totalSec: number): string {
  // Always show HH:MM:SS for the activation window — even at 72h that's "72:00:00".
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

function formatRelativeStarted(iso: string | null): string {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (Number.isNaN(t)) return '';
  const hrs = Math.max(0, (Date.now() - t) / 3600_000);
  if (hrs < 1)  return `${Math.round(hrs * 60)} min`;
  if (hrs < 72) return `${hrs.toFixed(1)} hrs`;
  return `${Math.round(hrs / 24)} days`;
}
