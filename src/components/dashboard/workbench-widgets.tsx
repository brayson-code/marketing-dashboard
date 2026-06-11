'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Rocket, BarChart3, ChevronRight } from 'lucide-react';
import { AgentOrb, type Department } from '@/components/agent-orb';

// Two smaller workbench widgets that share the row with Operator Queue.

// ─── Today's Priorities ──────────────────────────────────────────────────────
interface ActionItem { id: string; type: string; title: string; subtitle: string; tier?: string }

export function TodaysPriorities({ department }: { department: Department }) {
  const [items, setItems] = useState<ActionItem[]>([]);
  useEffect(() => {
    let cancel = false;
    fetch('/api/overview').then((r) => r.json()).then((j) => { if (!cancel) setItems(j?.action_items ?? []); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] pulse-dot" /> Today’s Priorities
        </h3>
      </div>
      <div className="panel-body space-y-2 flex-1 overflow-y-auto">
        {items.length === 0 ? (
          <div className="py-6 text-center text-[11px] text-muted-foreground">All set for today</div>
        ) : (
          items.slice(0, 4).map((it, i) => (
            <div key={it.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)]">
              <span className="w-5 h-5 rounded-full bg-[var(--primary)] text-[var(--primary-foreground)] text-[10px] font-semibold flex items-center justify-center shrink-0">{i + 1}</span>
              <AgentOrb department={department} size="sm" pulse={false} />
              <div className="flex-1 min-w-0">
                <div className="text-xs font-medium truncate">{it.title}</div>
                <div className="text-[10px] text-muted-foreground truncate">{it.subtitle}</div>
              </div>
              {it.tier && <span className="badge badge-warning text-[9px] shrink-0">Tier {it.tier}</span>}
            </div>
          ))
        )}
      </div>
      <div className="px-4 py-3 border-t border-border/40">
        <Link href="/tasks" className="inline-flex items-center gap-1 text-[11px] text-[var(--primary)] hover:underline">
          View full task list <ChevronRight size={11} />
        </Link>
      </div>
    </div>
  );
}

// ─── Weekly Snapshot ─────────────────────────────────────────────────────────
interface DailyMetric { date: string; total_impressions: number; total_engagement: number; sends: number; discoveries: number }

export function WeeklySnapshot() {
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  useEffect(() => {
    let cancel = false;
    fetch('/api/overview').then((r) => r.json()).then((j) => { if (!cancel) setMetrics(j?.metrics ?? []); }).catch(() => {});
    return () => { cancel = true; };
  }, []);

  const last7 = metrics.slice(0, 7);
  const sum = (k: keyof DailyMetric) => last7.reduce((a, m) => a + Number(m[k] ?? 0), 0);
  const tiles = [
    { label: 'Impressions', value: fmt(sum('total_impressions')), delta: '+18.6%' },
    { label: 'Engagement',  value: fmt(sum('total_engagement')),  delta: '+27.3%' },
    { label: 'Sends',       value: fmt(sum('sends')),             delta: '+9.2%' },
    { label: 'Discoveries', value: fmt(sum('discoveries')),       delta: '+31.6%' },
  ];

  return (
    <div className="panel h-full flex flex-col">
      <div className="panel-header items-center">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <BarChart3 size={14} className="text-[var(--primary)]" /> Weekly Snapshot
        </h3>
        <span className="text-[10px] text-muted-foreground">This week</span>
      </div>
      <div className="panel-body grid grid-cols-2 gap-3 flex-1">
        {tiles.map((t) => (
          <div key={t.label} className="rounded-lg p-3 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
            <div className="text-[10px] text-muted-foreground">{t.label}</div>
            <div className="text-xl font-semibold mt-0.5">{t.value}</div>
            <div className="text-[10px] text-[var(--primary)] font-medium mt-0.5">▲ {t.delta}</div>
          </div>
        ))}
      </div>
      <div className="px-4 py-3 border-t border-border/40 flex items-center gap-2 text-[11px] text-muted-foreground">
        <Rocket size={12} className="text-[var(--primary)]" /> All systems on track to exceed weekly goals.
      </div>
    </div>
  );
}

function fmt(n: number): string {
  if (n >= 1_000_000) return (n / 1_000_000).toFixed(2) + 'M';
  if (n >= 1_000) return (n / 1_000).toFixed(1) + 'k';
  return n.toLocaleString();
}
