'use client';

import { useMemo, useState } from 'react';
import {
  Users, User, UserRound, Sparkles, Network, MessageSquare, Crown, type LucideIcon,
} from 'lucide-react';
import { PILLAR_LABEL } from '@/lib/org-graph';

// Agent Hierarchy — the chain of command, drawn as an org chart.
//
// THE SHAPE IS THE PRODUCT THESIS. The reference this is modelled on goes
// Operator → Conductor (super agent) → departments. Ours inserts the Executive
// Assistant between the founder and the AI, because that is precisely what KeyPlayers
// sells: a human in the founder's corner, with the AI underneath them rather than
// instead of them. Don't collapse that row to save space.
//
// Connectors are CSS pseudo-elements, not SVG: the hierarchy is a simple tree, so plain
// flex children with a 1px stub reflow for free at any width — no measurement, no layout
// effects, nothing to resync when the roster changes.

export interface ChartAgent {
  id: string;
  name: string;
  department?: string | null;
  is_executive?: boolean;
  role?: string;
}

// The department hues already exist as design tokens — the same ones the Second Brain
// graph uses — so the two surfaces read as one system.
const DEPT_COLOR: Record<string, string> = {
  leadership: 'var(--dept-leadership)',
  marketing: 'var(--dept-marketing)',
  revenue: 'var(--dept-revenue)',
  operations: 'var(--dept-operations)',
  client_experience: 'var(--dept-client-experience)',
  unassigned: 'var(--muted-foreground)',
};

function Card({
  icon: Icon, title, subtitle, color, wide = false,
}: {
  icon: LucideIcon; title: string; subtitle?: string; color?: string; wide?: boolean;
}) {
  return (
    <div
      className="rounded-xl px-4 py-3 text-center"
      style={{
        minWidth: wide ? 240 : 150,
        background: 'var(--card)',
        border: `1px solid ${color ? `color-mix(in srgb, ${color} 45%, transparent)` : 'var(--border)'}`,
        boxShadow: color ? `0 0 18px color-mix(in srgb, ${color} 13%, transparent)` : undefined,
      }}
    >
      <Icon size={18} className="mx-auto mb-1" style={{ color: color ?? 'var(--foreground)' }} />
      <p className="text-sm font-semibold truncate">{title}</p>
      {subtitle && (
        <p className="text-[10px] uppercase tracking-wider mt-0.5" style={{ color: 'var(--muted-foreground)' }}>
          {subtitle}
        </p>
      )}
    </div>
  );
}

/** The 1px vertical stub joining a node to the rail above it. */
function Stub({ h = 22 }: { h?: number }) {
  return <div style={{ width: 1, height: h, background: 'var(--border)' }} />;
}

export function OrgChart({
  founderName,
  assistantName,
  assistantRole,
  agents,
}: {
  founderName: string;
  assistantName?: string;
  assistantRole?: string;
  agents: ChartAgent[];
}) {
  const [dept, setDept] = useState<string | null>(null);

  const byDept = useMemo(() => {
    const m = new Map<string, ChartAgent[]>();
    for (const a of agents) {
      const k = a.department || 'unassigned';
      const list = m.get(k);
      if (list) list.push(a); else m.set(k, [a]);
    }
    for (const [, list] of m) list.sort((x, y) => {
      // Executives lead their column — the department head reads first.
      if (!!y.is_executive !== !!x.is_executive) return y.is_executive ? 1 : -1;
      return x.name.localeCompare(y.name);
    });
    return m;
  }, [agents]);

  const depts = useMemo(() => [...byDept.keys()].sort(), [byDept]);

  return (
    <div className="space-y-5">
      {/* Department filter. Filtering DIMS rather than hides — the shape of the org has
          to survive the filter, otherwise you can't see what you excluded. */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          className={`btn btn-sm ${dept === null ? 'btn-primary' : 'btn-ghost'}`}
          onClick={() => setDept(null)}
        >
          All departments
        </button>
        {depts.map((d) => (
          <button
            key={d}
            className={`btn btn-sm ${dept === d ? 'btn-primary' : 'btn-ghost'}`}
            onClick={() => setDept(dept === d ? null : d)}
          >
            <span
              className="inline-block rounded-full"
              style={{ width: 7, height: 7, background: DEPT_COLOR[d] ?? 'var(--muted-foreground)' }}
            />
            {PILLAR_LABEL[d] ?? d}
          </button>
        ))}
      </div>

      <div className="panel p-6 overflow-x-auto">
        <div className="flex flex-col items-center min-w-[720px]">
          {/* 1 — the founder. Our client. */}
          <Card icon={Crown} title={founderName} subtitle="Founder" color="var(--primary)" />
          <Stub />

          {/* 2 — the Executive Assistant. The row that makes this KeyPlayers rather than
              a generic agent console. */}
          <Card
            icon={UserRound}
            title={assistantName || 'Executive Assistant'}
            subtitle={assistantRole ? assistantRole : 'Executive Assistant'}
            color="var(--dept-client-experience)"
          />
          <Stub />

          {/* 3 — the orchestrator, with its two standing surfaces either side. */}
          <p className="text-[10px] uppercase tracking-[0.2em] mb-1.5" style={{ color: 'var(--muted-foreground)' }}>
            Orchestrator
          </p>
          <div className="flex items-stretch gap-3">
            <div className="hidden md:flex items-center">
              <Card icon={Network} title="Second Brain" subtitle="What we know" />
            </div>
            <Card
              icon={Sparkles}
              title="KeyPlayer"
              subtitle="Routes every request"
              color="var(--primary)"
              wide
            />
            <div className="hidden md:flex items-center">
              <Card icon={MessageSquare} title="Messages" subtitle="iMessage · Telegram" />
            </div>
          </div>

          <Stub h={26} />
          {/* The rail spans department centres. Inset by half a column so its ends land
              on the first and last column rather than hanging past them. */}
          <div className="w-full px-[110px]">
            <div style={{ height: 1, background: 'var(--border)' }} />
          </div>

          {/* 4 — departments. */}
          <div className="flex items-start justify-center gap-4 flex-wrap pt-0">
            {depts.map((d) => {
              const members = byDept.get(d) ?? [];
              const color = DEPT_COLOR[d] ?? 'var(--muted-foreground)';
              const dim = dept !== null && dept !== d;
              return (
                <div
                  key={d}
                  className="flex flex-col items-center"
                  style={{
                    width: 220,
                    opacity: dim ? 0.2 : 1,
                    transition: 'opacity 180ms var(--ease-out, ease)',
                  }}
                >
                  <Stub h={22} />
                  <div
                    className="w-full rounded-xl p-3 space-y-2"
                    style={{
                      background: 'var(--card)',
                      border: `1px solid color-mix(in srgb, ${color} 40%, transparent)`,
                      boxShadow: `0 0 16px color-mix(in srgb, ${color} 10%, transparent)`,
                    }}
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="inline-block rounded-full" style={{ width: 7, height: 7, background: color }} />
                      <p className="text-sm font-semibold">{PILLAR_LABEL[d] ?? d}</p>
                      <span className="ml-auto text-[11px]" style={{ color: 'var(--muted-foreground)' }}>
                        {members.length}
                      </span>
                    </div>
                    <div className="space-y-1">
                      {members.slice(0, 8).map((m) => (
                        <div
                          key={m.id}
                          className="flex items-center gap-1.5 text-xs rounded px-1.5 py-1"
                          style={{ background: 'var(--surface-2)' }}
                        >
                          {m.is_executive ? <Users size={11} style={{ color }} /> : <User size={11} style={{ color: 'var(--muted-foreground)' }} />}
                          <span className="truncate">{m.name}</span>
                        </div>
                      ))}
                      {members.length > 8 && (
                        <p className="text-[10px]" style={{ color: 'var(--muted-foreground)' }}>
                          +{members.length - 8} more
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
