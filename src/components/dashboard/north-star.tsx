'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Star, Target, ArrowUpRight, Loader2, CalendarDays } from 'lucide-react';

interface Goal {
  id: string; title: string; status: string; due: string | null;
  success: string; evidence: string | null;
  owner_agent: string | null; priority: string; category: string | null;
  is_north_star: boolean; progress: number;
}

// The Overview's goal-focus row. One big North Star slot (the focal outcome
// the company is driving toward) + three smaller Top Priority cards (the
// parallel work feeding it). Each card links to /goals filtered to itself so
// "click for plan" lands you on the detail.
export function NorthStarSlot() {
  const [data, setData] = useState<{ north_star: Goal | null; priorities: Goal[]; all_count: number } | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      fetch('/api/goals/overview', { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (!cancel) setData(j); })
        .catch(() => { if (!cancel) setData({ north_star: null, priorities: [], all_count: 0 }); })
        .finally(() => { if (!cancel) setLoading(false); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  if (loading && !data) {
    return (
      <div className="panel p-6 flex items-center justify-center gap-2 text-small">
        <Loader2 size={14} className="animate-spin" /> Loading goals…
      </div>
    );
  }

  const ns = data?.north_star ?? null;
  const top = data?.priorities ?? [];

  // Nothing to show — surface a clean "add your first goal" CTA instead of an empty box.
  if (!ns && top.length === 0) {
    return (
      <Link
        href="/goals"
        className="panel p-6 flex items-center justify-between gap-3 group focus-ring rounded-xl"
        style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
      >
        <div className="flex items-center gap-3">
          <Star size={18} className="text-[var(--primary)]" />
          <div>
            <div className="text-h2">Set your North Star</div>
            <p className="text-small">The one outcome your AI team is driving toward this quarter.</p>
          </div>
        </div>
        <ArrowUpRight size={14} className="text-muted-foreground group-hover:text-foreground" style={{ transition: 'color var(--t-popover) var(--ease-out)' }} />
      </Link>
    );
  }

  return (
    <div className="grid grid-cols-1 lg:grid-cols-3 gap-3">
      {ns && <NorthStarCard goal={ns} />}
      {!ns && (
        // North Star empty but priorities exist — still offer the slot.
        <Link
          href="/goals"
          className="panel p-5 flex items-center gap-3 group focus-ring rounded-xl"
          style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
        >
          <Star size={18} className="text-[var(--primary)]" />
          <div className="flex-1">
            <div className="text-h2">Set your North Star</div>
            <p className="text-small">Pick one of your goals as the focal outcome.</p>
          </div>
          <ArrowUpRight size={14} className="text-muted-foreground" />
        </Link>
      )}

      {/* Top priorities — fill remaining columns. Renders fewer than 3 cards
          gracefully if you haven't set enough goals yet. */}
      <div className="lg:col-span-2 grid grid-cols-1 sm:grid-cols-3 gap-3">
        {top.map((g) => <PriorityCard key={g.id} goal={g} />)}
        {top.length < 3 && Array.from({ length: 3 - top.length }).map((_, i) => (
          <Link
            key={`empty-${i}`}
            href="/goals"
            className="panel p-4 flex items-center justify-center text-center group focus-ring rounded-xl"
            style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
          >
            <div className="space-y-1">
              <Target size={14} className="text-muted-foreground mx-auto" />
              <div className="text-[10px] text-muted-foreground">Add priority</div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function NorthStarCard({ goal }: { goal: Goal }) {
  return (
    <Link
      href={`/goals#${goal.id}`}
      className="panel relative overflow-hidden p-5 flex flex-col gap-3 group focus-ring rounded-xl"
      style={{ transition: 'border-color var(--t-popover) var(--ease-out)' }}
    >
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{ background: 'radial-gradient(420px circle at 0% -20%, color-mix(in srgb, var(--primary) 22%, transparent), transparent 55%)' }}
      />
      <div className="relative flex items-center gap-2">
        <Star size={14} className="text-[var(--primary)] fill-[var(--primary)]" />
        <span className="text-micro uppercase tracking-wider text-[var(--primary)] font-semibold">North Star</span>
        {goal.due && (
          <span className="ml-auto inline-flex items-center gap-1 text-micro text-muted-foreground">
            <CalendarDays size={11} /> due {formatDue(goal.due)}
          </span>
        )}
      </div>
      <div className="relative">
        <div className="text-h2 leading-snug">{goal.title}</div>
        {goal.evidence && <p className="text-small mt-1 line-clamp-2">{goal.evidence}</p>}
      </div>
      <div className="relative mt-auto space-y-1.5">
        <div className="flex items-center justify-between text-micro">
          <span className="text-muted-foreground">Progress</span>
          <span className="font-mono tabular-nums text-[var(--primary)]">{goal.progress}%</span>
        </div>
        <div className="h-1.5 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${goal.progress}%`, background: 'var(--primary)', boxShadow: '0 0 12px var(--primary)' }}
          />
        </div>
      </div>
    </Link>
  );
}

function PriorityCard({ goal }: { goal: Goal }) {
  const isP0 = goal.priority === 'P0';
  return (
    <Link
      href={`/goals#${goal.id}`}
      className="panel p-4 flex flex-col gap-2 group focus-ring rounded-xl"
      style={{ transition: 'background-color var(--t-popover) var(--ease-out)' }}
    >
      <div className="flex items-center gap-1.5 flex-wrap">
        <span
          className="inline-flex items-center px-1.5 py-0.5 rounded text-[9px] font-semibold tracking-wider"
          style={{
            background: isP0 ? 'color-mix(in srgb, var(--warning) 18%, transparent)' : 'color-mix(in srgb, var(--muted-foreground) 15%, transparent)',
            color: isP0 ? 'var(--warning)' : 'var(--muted-foreground)',
          }}
        >
          {goal.priority}
        </span>
        {goal.category && <span className="text-[10px] text-muted-foreground capitalize">{goal.category}</span>}
        {goal.due && <span className="text-[10px] text-muted-foreground ml-auto">{formatDue(goal.due)}</span>}
      </div>
      <div className="text-xs font-medium leading-snug line-clamp-2">{goal.title}</div>
      <div className="mt-auto space-y-1">
        <div className="flex items-center justify-between text-[10px]">
          <span className="text-muted-foreground capitalize">{goal.status.replace('_', ' ')}</span>
          <span className="font-mono tabular-nums">{goal.progress}%</span>
        </div>
        <div className="h-1 rounded-full overflow-hidden" style={{ background: 'color-mix(in srgb, var(--border) 60%, transparent)' }}>
          <div
            className="h-full rounded-full transition-[width] duration-500"
            style={{ width: `${goal.progress}%`, background: 'var(--primary)' }}
          />
        </div>
      </div>
    </Link>
  );
}

function formatDue(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}
