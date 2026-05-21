'use client';

import { useMemo, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { GymClaude, FlagWaver } from '@/components/mascot';
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
  primary: '#E8835A', // signature coral-orange (brightened for the dark card)
  accent: '#E8835A',
  bright: '#FB923C', // vivid orange for headings on dark
  warn: '#F87171', // over-limit warning shade (lightened for dark bg)
  fillSoft: 'rgba(255, 255, 255, 0.08)',
  fillSofter: 'rgba(255, 255, 255, 0.05)',
  tint: 'rgba(234, 88, 12, 0.10)',
  border: 'rgba(255, 255, 255, 0.12)',
  dark: '#1A1512', // warm charcoal card fill
  ink: '#F5F3F0', // light text on the dark card
  inkMuted: 'rgba(245, 243, 240, 0.60)',
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
function LimitBar({ label, limit, mascot }: { label: string; limit: UsageLimit; mascot?: React.ReactNode }) {
  const used = Number(limit?.used ?? 0);
  const max = Number(limit?.limit ?? 0);
  const rawPct = Number.isFinite(limit?.pct) ? Number(limit.pct) : 0;
  const over = rawPct >= 100;
  const fillPct = Math.max(0, Math.min(100, rawPct)); // clamp the visible fill
  // Keep the mascot inside the track so it never clips off the edge.
  const ridePct = Math.max(6, Math.min(94, fillPct));

  return (
    <div>
      <div className="flex items-end justify-between mb-2 gap-2 flex-wrap">
        <span className="text-lg font-extrabold tracking-tight uppercase inline-flex items-baseline gap-2" style={{ color: CLAUDE.bright, letterSpacing: '0.02em' }}>
          {label}
          <span className="font-mono" style={{ color: over ? CLAUDE.warn : CLAUDE.ink, fontSize: '0.95rem' }}>{Math.round(rawPct)}%</span>
        </span>
        <span className="font-mono font-bold" style={{ color: over ? CLAUDE.warn : CLAUDE.ink, fontSize: '1.05rem' }}>
          {fmtNum(used)} / {fmtNum(max)} <span className="text-xs opacity-60">tokens</span>
        </span>
      </div>
      {/* pt leaves room for the mascot to stand on top of the bar */}
      <div className="pt-14">
        {/* relative anchor = the bar track's box; the mascot is positioned to its
            top edge (bottom:100%) so it stands ON the bar at the fill point. */}
        <div className="relative">
          {/* mascot — feet on the top edge of the bar, centered on the fill % */}
          {mascot && (
            <div
              className="absolute transition-all duration-700 ease-out"
              style={{ left: `${ridePct}%`, bottom: '100%', transform: 'translateX(-50%)', zIndex: 3, lineHeight: 0 }}
              title={`${Math.round(rawPct)}% of ${label.toLowerCase()}`}
            >
              <div className="claude-mascot-bob">{mascot}</div>
            </div>
          )}

          <div
            className="relative h-9 rounded-full overflow-hidden"
            style={{
              background: 'rgba(255,255,255,0.08)',
              border: `1px solid ${CLAUDE.border}`,
              boxShadow: 'inset 0 1px 4px rgba(0,0,0,0.45)',
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
      style={{ background: CLAUDE.dark, border: `1px solid ${CLAUDE.border}`, color: CLAUDE.ink }}
    >
      <div className="font-mono text-[10px]" style={{ color: CLAUDE.inkMuted }}>{p.fullDay}</div>
      <div style={{ color: CLAUDE.bright }} className="font-semibold">{fmtNum(Number(p.tokens ?? 0))} tokens</div>
      <div style={{ color: CLAUDE.inkMuted }}>{fmtUsd(Number(p.cost_usd ?? 0))}</div>
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
  const [showChart, setShowChart] = useState(false);

  // Pick two DISTINCT mascots for the daily vs weekly bars. Reshuffled each load
  // (useMemo on mount), so it varies over time but the two are never the same.
  const [dailyMascot, weeklyMascot] = useMemo(() => {
    const size = 54;
    // Transparent gif mascots (verified) + the in-place SVG animations. Confetti
    // is excluded (its burst overflows a small bar); solid-bg gifs are excluded.
    // All 480x480, character framed consistently. Excludes clawd-linuxdo-06
    // (1936x1850 "jumping" animation — figure moves inside a big canvas, so it
    // reads small/off-center on the small bar).
    const gifs = [
      'claude-jammin', 'clawd-headphones', 'clawd-linuxdo-01', 'clawd-linuxdo-02',
      'clawd-linuxdo-04', 'clawd-linuxdo-05', 'clawd-linuxdo-07',
    ];
    const renderers: Array<(s: number) => React.ReactNode> = [
      ...gifs.map((name) => (s: number) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`/sprites/${name}.gif`} alt="" style={{ width: s, height: s, imageRendering: 'pixelated', display: 'block', filter: 'drop-shadow(0 2px 3px rgba(0,0,0,0.3))' }} />
      )),
      (s: number) => <GymClaude size={s} />,
      (s: number) => <FlagWaver size={s} />,
    ];
    // Shuffle, then take two distinct — varies each load, never the same pair.
    for (let i = renderers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [renderers[i], renderers[j]] = [renderers[j], renderers[i]];
    }
    return [<span key="daily">{renderers[0](size)}</span>, <span key="weekly">{renderers[1](size)}</span>];
  }, []);

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
      className="panel overflow-hidden usage-card"
      style={{
        border: `2px solid ${CLAUDE.primary}`,
        borderRadius: 22,
        background: CLAUDE.dark,
        boxShadow: '0 18px 40px -12px rgba(234,88,12,0.35), 0 10px 22px -8px rgba(0,0,0,0.30)',
      }}
    >
      <div className="panel-header flex items-center justify-between" style={{ borderColor: 'rgba(234,88,12,0.22)' }}>
        <h3 className="flex items-center gap-2 text-base font-extrabold tracking-tight">
          <ClaudeSpark size={17} />
          <span style={{ color: CLAUDE.bright }}>Usage</span>
        </h3>
        <span className="text-[11px] font-mono font-semibold" style={{ color: CLAUDE.primary }}>Claude API · 14d</span>
      </div>

      <div className="panel-body space-y-4">
        {/* Limit bars — the default view (headroom is always visible) */}
        <div className="space-y-4">
          <LimitBar label="Daily limit" limit={daily} mascot={dailyMascot} />
          <LimitBar label="Weekly limit" limit={weekly} mascot={weeklyMascot} />
        </div>

        {/* Dropdown toggle — sits right under the bars so you never scroll to hide */}
        <button
          type="button"
          onClick={() => setShowChart((v) => !v)}
          className="w-full flex items-center justify-center gap-1.5 pt-2 text-[11px] font-bold uppercase tracking-wide"
          style={{ color: CLAUDE.primary, borderTop: `1px solid ${CLAUDE.border}` }}
          aria-expanded={showChart}
        >
          {showChart ? 'Hide' : 'Usage over time & by agent'}
          <ChevronDown
            size={15}
            className="transition-transform duration-200"
            style={{ transform: showChart ? 'rotate(180deg)' : 'rotate(0deg)' }}
          />
        </button>

        {/* Everything below lives in the dropdown — hidden until expanded */}
        {showChart && (
          <div className="space-y-5 pt-1">
            {!hasUsage ? (
              <div
                className="flex flex-col items-center justify-center gap-2 py-8 rounded-xl text-center"
                style={{ background: CLAUDE.fillSofter, border: `1px dashed ${CLAUDE.border}` }}
              >
                <ClaudeMascot size={40} />
                <p className="text-sm font-medium" style={{ color: CLAUDE.primary }}>No usage yet</p>
                <p className="text-xs" style={{ color: CLAUDE.inkMuted }}>
                  Token usage will show up here once your agents start running.
                </p>
              </div>
            ) : (
              <>
                {/* Usage over time */}
                <div>
                  <div className="text-sm font-bold mb-2 tracking-tight" style={{ color: CLAUDE.bright }}>Usage over time</div>
                  <ResponsiveContainer width="100%" height={150}>
                    <AreaChart data={series} margin={{ top: 4, right: 6, bottom: 0, left: -10 }}>
                      <defs>
                        <linearGradient id="usageArea" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor={CLAUDE.primary} stopOpacity={0.45} />
                          <stop offset="100%" stopColor={CLAUDE.primary} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid stroke="rgba(255,255,255,0.08)" strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="day" stroke={CLAUDE.inkMuted} fontSize={10} tickLine={false} axisLine={false} />
                      <YAxis stroke={CLAUDE.inkMuted} fontSize={10} tickFormatter={fmtNum} tickLine={false} axisLine={false} width={40} />
                      <Tooltip content={<ChartTip />} cursor={{ stroke: CLAUDE.border }} />
                      <Area type="monotone" dataKey="tokens" stroke={CLAUDE.primary} fill="url(#usageArea)" strokeWidth={2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>

                {/* Per-agent breakdown */}
                <div>
                  <div className="text-sm font-bold mb-2 tracking-tight" style={{ color: CLAUDE.bright }}>By agent</div>
                  <div className="space-y-2">
                    {byAgentDaily.length === 0 ? (
                      <p className="text-xs" style={{ color: CLAUDE.inkMuted }}>No agent activity yet.</p>
                    ) : (
                      byAgentDaily.map((a) => (
                        <div
                          key={a.agent_id}
                          className="flex items-center gap-3 p-2.5 rounded-lg"
                          style={{ background: CLAUDE.fillSofter, border: `1px solid ${CLAUDE.border}` }}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-bold truncate" style={{ color: CLAUDE.ink }}>
                              {agentLabel(a.agent_id)}
                            </div>
                            <div className="text-[10px] font-mono font-semibold" style={{ color: CLAUDE.inkMuted }}>
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
        )}
      </div>
    </div>
  );
}

export default UsageWidget;
