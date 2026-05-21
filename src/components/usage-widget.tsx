'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { useSmartPoll } from '@/hooks/use-smart-poll';

// ── Claude theming ──────────────────────────────────────────────
const CLAUDE = {
  primary: '#D97757', // signature coral-orange
  accent: '#E8835A',
  bright: '#EA580C',
  warn: '#DC2626', // over-limit warning shade
  fillSoft: 'rgba(217, 119, 87, 0.16)',
  fillSofter: 'rgba(217, 119, 87, 0.08)',
  tint: 'rgba(217, 119, 87, 0.10)',
  border: 'rgba(217, 119, 87, 0.30)',
};

// ── Types (mirror src/lib/usage.ts) ─────────────────────────────
interface DailyUsage { day: string; input_tokens: number; output_tokens: number; cost_usd: number; calls: number }
interface AgentDailyPoint { day: string; input_tokens: number; output_tokens: number; tokens: number; cost_usd: number }
interface AgentDailyUsage { agent_id: string; model: string; total_tokens: number; total_cost_usd: number; days: AgentDailyPoint[] }
interface UsageLimit { used: number; limit: number; pct: number }
interface UsageLimits { daily: UsageLimit; weekly: UsageLimit }
interface UsageSummary {
  total: { input_tokens: number; output_tokens: number; cost_usd: number; calls: number };
  by_day: DailyUsage[];
  by_agent_daily: AgentDailyUsage[];
  limits: UsageLimits;
}

const AGENT_LABELS: Record<string, string> = {
  keyplayer: 'KeyPlayer',
  'research-analyst': 'Research Analyst',
  'content-writer': 'Content Writer',
  'outreach-sender': 'Outreach Sender',
  'calendar-scheduler': 'Calendar Scheduler',
  'memory-compactor': 'Memory Compactor',
  'lead-research': 'Lead Research',
  'thumbnail-generator': 'Thumbnail Generator',
  'hyperframes-agent': 'Hyperframes Agent',
};

function agentLabel(id: string): string {
  return AGENT_LABELS[id] ?? id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}
function fmtUsd(n: number): string { return n > 0 && n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`; }
function fmtDay(day: string): string { return typeof day === 'string' ? day.slice(5) : ''; }

// ── Claude mascot — the real "jammin" sprite (dancing, transparent bg) ──
function ClaudeMascot({ size = 40 }: { size?: number }) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/sprites/claude-jammin.gif"
      alt="Claude"
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: 'pixelated', display: 'block', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.25))' }}
      aria-hidden
    />
  );
}

// ── Claude spark/asterisk header icon ───────────────────────────
function ClaudeSpark({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <path
        d="M12 2.5l1.9 6.1 6.1 1.9-6.1 1.9-1.9 6.1-1.9-6.1L4 10.5l6.1-1.9z"
        fill={CLAUDE.primary}
        stroke={CLAUDE.bright}
        strokeWidth="0.6"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Limit progress bar with the dancing Claude riding on top ─────
function LimitBar({ label, limit }: { label: string; limit: UsageLimit }) {
  const used = Number(limit?.used ?? 0);
  const max = Number(limit?.limit ?? 0);
  const rawPct = Number.isFinite(limit?.pct) ? Number(limit.pct) : 0;
  const over = rawPct >= 100;
  const fillPct = Math.max(0, Math.min(100, rawPct)); // clamp the visible fill
  // Keep the mascot inside the track so it never clips off the edge.
  const ridePct = Math.max(6, Math.min(94, fillPct));

  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-sm font-extrabold tracking-tight uppercase" style={{ color: CLAUDE.bright, letterSpacing: '0.02em' }}>{label}</span>
        <span className="text-xs font-mono font-bold" style={{ color: over ? CLAUDE.warn : 'var(--foreground)' }}>
          {fmtNum(used)} / {fmtNum(max)} <span className="opacity-60">tokens</span> · {Math.round(rawPct)}%
        </span>
      </div>
      {/* extra top padding leaves room for the mascot to sit above the track */}
      <div className="relative pt-8">
        <div
          className="relative h-9 rounded-full overflow-hidden"
          style={{
            background: 'rgba(217,119,87,0.12)',
            border: `1px solid ${CLAUDE.border}`,
            boxShadow: 'inset 0 1px 3px rgba(0,0,0,0.18)',
          }}
        >
          {/* gradient fill */}
          <div
            className="absolute inset-y-0 left-0 rounded-full transition-all duration-700 ease-out"
            style={{
              width: `${Math.max(fillPct, 2)}%`,
              background: over
                ? 'linear-gradient(90deg, #EA580C 0%, #DC2626 60%, #B91C1C 100%)'
                : 'linear-gradient(90deg, #EA580C 0%, #F59E0B 45%, #D97757 100%)',
              boxShadow: `0 0 14px ${over ? 'rgba(220,38,38,0.6)' : 'rgba(234,88,12,0.55)'}`,
            }}
          >
            {/* moving shimmer highlight across the fill */}
            <div className="claude-bar-shimmer absolute inset-0 rounded-full" />
          </div>
        </div>

        {/* dancing mascot, sitting ON TOP of the bar at the fill edge */}
        <div
          className="absolute transition-all duration-700 ease-out"
          style={{ left: `${ridePct}%`, top: 0, transform: 'translateX(-50%)', zIndex: 3 }}
          title={`${Math.round(rawPct)}% of ${label.toLowerCase()}`}
        >
          <div className="claude-mascot-bob">
            <ClaudeMascot size={58} />
          </div>
        </div>
      </div>
      {over && (
        <p className="text-[11px] mt-1.5 font-medium" style={{ color: CLAUDE.warn }}>
          Over limit — {fmtNum(used - max)} tokens past the cap
        </p>
      )}
    </div>
  );
}

// ── Tooltip for the over-time chart ─────────────────────────────
interface TipPayload { payload?: { tokens?: number; cost_usd?: number; fullDay?: string } }
function ChartTip({ active, payload }: { active?: boolean; payload?: TipPayload[] }) {
  if (!active || !Array.isArray(payload) || payload.length === 0) return null;
  const p = payload[0]?.payload;
  if (!p) return null;
  return (
    <div
      className="rounded-lg px-2.5 py-1.5 text-[11px]"
      style={{ background: 'var(--card)', border: `1px solid ${CLAUDE.border}`, color: 'var(--foreground)' }}
    >
      <div className="font-mono text-[10px]" style={{ color: 'var(--muted-foreground)' }}>{p.fullDay}</div>
      <div style={{ color: CLAUDE.primary }} className="font-semibold">{fmtNum(Number(p.tokens ?? 0))} tokens</div>
      <div style={{ color: 'var(--muted-foreground)' }}>{fmtUsd(Number(p.cost_usd ?? 0))}</div>
    </div>
  );
}

// ── Per-agent sparkline ─────────────────────────────────────────
function AgentSparkline({ days }: { days: AgentDailyPoint[] }) {
  const data = Array.isArray(days) ? days : [];
  const gid = useMemo(() => `spark-${Math.random().toString(36).slice(2, 9)}`, []);
  if (data.length === 0) return null;
  return (
    <ResponsiveContainer width="100%" height={36}>
      <AreaChart data={data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={CLAUDE.primary} stopOpacity={0.5} />
            <stop offset="100%" stopColor={CLAUDE.primary} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area type="monotone" dataKey="tokens" stroke={CLAUDE.primary} fill={`url(#${gid})`} strokeWidth={1.5} isAnimationActive={false} dot={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function UsageWidget() {
  const [showChart, setShowChart] = useState(true);
  const { data } = useSmartPoll<UsageSummary>(
    () => fetch('/api/usage?days=14', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null),
    { interval: 30_000 },
  );

  // Defensive: guard everything against 401 / empty / malformed responses.
  const limits: UsageLimits = data?.limits && typeof data.limits === 'object'
    ? data.limits
    : { daily: { used: 0, limit: 2_000_000, pct: 0 }, weekly: { used: 0, limit: 10_000_000, pct: 0 } };
  const daily = limits.daily ?? { used: 0, limit: 2_000_000, pct: 0 };
  const weekly = limits.weekly ?? { used: 0, limit: 10_000_000, pct: 0 };

  const byDay = Array.isArray(data?.by_day) ? data.by_day : [];
  const byAgentDaily = Array.isArray(data?.by_agent_daily) ? data.by_agent_daily : [];

  const series = byDay.map((d) => ({
    day: fmtDay(d.day),
    fullDay: d.day,
    tokens: Number(d.input_tokens ?? 0) + Number(d.output_tokens ?? 0),
    cost_usd: Number(d.cost_usd ?? 0),
  }));
  const hasUsage = series.some((s) => s.tokens > 0) || byAgentDaily.length > 0;

  return (
    <div
      className="panel overflow-hidden"
      style={{
        borderColor: CLAUDE.primary,
        background: 'linear-gradient(135deg, rgba(234,88,12,0.16) 0%, rgba(217,119,87,0.06) 45%, rgba(217,119,87,0.02) 100%), var(--card)',
        boxShadow: '0 8px 28px rgba(234,88,12,0.16), 0 0 0 1px rgba(234,88,12,0.18) inset',
      }}
    >
      <div className="panel-header flex items-center justify-between" style={{ borderColor: 'rgba(234,88,12,0.22)' }}>
        <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
          <ClaudeSpark size={17} />
          <span style={{ color: CLAUDE.bright }}>Usage</span>
        </h3>
        <span className="text-[11px] font-mono font-semibold" style={{ color: CLAUDE.primary }}>Claude API · 14d</span>
      </div>

      <div className="panel-body space-y-5">
        {/* Limit bars (always shown — they convey headroom even with no usage) */}
        <div className="space-y-4">
          <LimitBar label="Daily limit" limit={daily} />
          <LimitBar label="Weekly limit" limit={weekly} />
        </div>

        {!hasUsage ? (
          <div
            className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl text-center"
            style={{ background: CLAUDE.fillSofter, border: `1px dashed ${CLAUDE.border}` }}
          >
            <ClaudeMascot size={40} />
            <p className="text-sm font-medium" style={{ color: CLAUDE.primary }}>No usage yet</p>
            <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>
              Token usage will show up here once your agents start running.
            </p>
          </div>
        ) : (
          <>
            {/* Usage over time — collapsible */}
            <div>
              <button
                type="button"
                onClick={() => setShowChart((v) => !v)}
                className="w-full flex items-center justify-between mb-2 group"
                aria-expanded={showChart}
              >
                <span className="text-sm font-bold tracking-tight" style={{ color: CLAUDE.bright }}>Usage over time</span>
                <ChevronDown
                  size={16}
                  className="transition-transform duration-200"
                  style={{ color: CLAUDE.primary, transform: showChart ? 'rotate(0deg)' : 'rotate(-90deg)' }}
                />
              </button>
              {showChart && (
              <ResponsiveContainer width="100%" height={150}>
                <AreaChart data={series} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
                  <defs>
                    <linearGradient id="usageArea" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={CLAUDE.primary} stopOpacity={0.45} />
                      <stop offset="100%" stopColor={CLAUDE.primary} stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                  <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={10} tickLine={false} axisLine={false} />
                  <YAxis stroke="var(--muted-foreground)" fontSize={10} tickFormatter={fmtNum} tickLine={false} axisLine={false} width={40} />
                  <Tooltip content={<ChartTip />} cursor={{ stroke: CLAUDE.border }} />
                  <Area type="monotone" dataKey="tokens" stroke={CLAUDE.primary} fill="url(#usageArea)" strokeWidth={2} />
                </AreaChart>
              </ResponsiveContainer>
              )}
            </div>

            {/* Per-agent breakdown */}
            <div>
              <div className="text-sm font-bold mb-2 tracking-tight" style={{ color: CLAUDE.bright }}>By agent</div>
              <div className="space-y-2">
                {byAgentDaily.length === 0 ? (
                  <p className="text-xs" style={{ color: 'var(--muted-foreground)' }}>No agent activity yet.</p>
                ) : (
                  byAgentDaily.map((a) => (
                    <div
                      key={a.agent_id}
                      className="flex items-center gap-3 p-2.5 rounded-lg"
                      style={{ background: CLAUDE.fillSofter, border: `1px solid ${CLAUDE.border}` }}
                    >
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-bold truncate" style={{ color: 'var(--foreground)' }}>
                          {agentLabel(a.agent_id)}
                        </div>
                        <div className="text-[10px] font-mono font-semibold" style={{ color: 'var(--muted-foreground)' }}>
                          {fmtNum(Number(a.total_tokens ?? 0))} tokens · {fmtUsd(Number(a.total_cost_usd ?? 0))}
                        </div>
                      </div>
                      <div className="w-24 shrink-0">
                        <AgentSparkline days={a.days} />
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default UsageWidget;
