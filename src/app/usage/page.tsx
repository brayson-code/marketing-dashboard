'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar } from 'recharts';
import { DollarSign, Cpu, Zap, Activity, Bot, Database, Mic, Gauge, AlertTriangle } from 'lucide-react';

interface DailyUsage { day: string; input_tokens: number; output_tokens: number; cost_usd: number; calls: number }
interface AgentUsage { agent_id: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; avg_duration_sec: number }
interface UsageSummary {
  total: { input_tokens: number; output_tokens: number; cost_usd: number; calls: number };
  by_day: DailyUsage[];
  by_agent: AgentUsage[];
}
interface Spend {
  claude: { usd: number; tokens: number };
  apify: { usedUsd: number | null; plan: string | null } | null;
  deepgram: { balanceUsd: number | null; usedUsd: number | null } | null;
}
interface BudgetInfo {
  enabled: boolean;
  daily_tokens: number;
  used_today: number;
  pending?: boolean;
}

const RANGES = [
  { days: 7, label: '7d' },
  { days: 14, label: '14d' },
  { days: 30, label: '30d' },
  { days: 90, label: '90d' },
];

function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}
function fmtUsd(n: number): string { return n < 0.01 ? '<$0.01' : `$${n.toFixed(2)}`; }
function fmtDay(day: string): string { return day.slice(5); /* MM-DD */ }

export default function UsagePage() {
  const [data, setData] = useState<UsageSummary | null>(null);
  const [spend, setSpend] = useState<Spend | null>(null);
  const [budget, setBudget] = useState<BudgetInfo | null>(null);
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    const res = await fetch(`/api/usage?days=${days}`, { cache: 'no-store' });
    setData(await res.json());
  }, [days]);

  const loadSpend = useCallback(async () => {
    try {
      const res = await fetch('/api/spend', { cache: 'no-store' });
      if (res.ok) setSpend(await res.json());
    } catch { /* leave prior spend */ }
  }, []);

  const loadBudget = useCallback(async () => {
    try {
      const res = await fetch('/api/usage-cap', { cache: 'no-store' });
      if (res.ok) {
        const b: BudgetInfo = await res.json();
        if (!b.pending) setBudget(b);
      }
    } catch { /* leave prior budget */ }
  }, []);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);
  useEffect(() => { loadSpend(); const id = setInterval(loadSpend, 60000); return () => clearInterval(id); }, [loadSpend]);
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { loadBudget(); const id = setInterval(loadBudget, 15000); return () => clearInterval(id); }, [loadBudget]);

  if (!data) return <div className="text-xs text-muted-foreground">Loading usage…</div>;

  const totalTokens = data.total.input_tokens + data.total.output_tokens;
  const dailySeries = data.by_day.map((d) => ({ ...d, day: fmtDay(d.day), total_tokens: d.input_tokens + d.output_tokens }));

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Usage</h1>
          <p className="text-xs text-muted-foreground">Claude API consumption from KeyPlayer + sub-agents. Updates every 5s.</p>
        </div>
        <div className="flex gap-1">
          {RANGES.map((r) => (
            <button key={r.days} onClick={() => setDays(r.days)} className={`tab ${days === r.days ? 'active' : ''}`}>{r.label}</button>
          ))}
        </div>
      </div>

      <div>
        <div className="section-title mb-2">Spend</div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <SpendCard
            icon={Bot}
            label="Claude"
            value={spend ? fmtUsd(spend.claude.usd) : '—'}
            sub={spend ? `${fmtNum(spend.claude.tokens)} tokens · last 30d` : 'last 30d'}
          />
          <SpendCard
            icon={Database}
            label="Apify"
            value={spend?.apify?.usedUsd != null ? fmtUsd(spend.apify.usedUsd) : '—'}
            sub={spend?.apify ? (spend.apify.plan ? `${spend.apify.plan} plan · month to date` : 'month to date') : 'not connected'}
          />
          <SpendCard
            icon={Mic}
            label="Deepgram"
            value={spend?.deepgram?.balanceUsd != null ? `${fmtUsd(spend.deepgram.balanceUsd)} free credit left` : '—'}
            sub={spend?.deepgram ? 'remaining balance' : 'not connected'}
          />
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Activity} label="Calls" value={String(data.total.calls)} />
        <StatTile icon={Cpu} label="Tokens" value={fmtNum(totalTokens)} sub={`${fmtNum(data.total.input_tokens)} in · ${fmtNum(data.total.output_tokens)} out`} />
        <StatTile icon={DollarSign} label="Cost" value={fmtUsd(data.total.cost_usd)} sub={`last ${days}d`} />
        <StatTile icon={Zap} label="Avg / call" value={data.total.calls > 0 ? fmtUsd(data.total.cost_usd / data.total.calls) : '—'} />
      </div>

      {/* Daily budget — shown only when a cap is configured */}
      {budget && (
        (() => {
          const { enabled, daily_tokens, used_today } = budget;
          const pct = daily_tokens > 0 ? Math.min((used_today / daily_tokens) * 100, 100) : 0;
          const amber = pct >= 80 && pct < 100;
          const red = pct >= 100;
          const barColor = red ? 'var(--destructive)' : amber ? 'var(--warning)' : 'var(--primary)';
          const paused = enabled && red;
          return (
            <div className={`panel p-4 space-y-3 ${paused ? 'border-destructive/40' : ''}`}>
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
                  <Gauge size={11} /> Daily budget
                </div>
                {!enabled && (
                  <span className="text-[10px] text-muted-foreground">enforcement off</span>
                )}
              </div>

              {paused && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                  <span>
                    Agents paused — daily token budget reached. They resume automatically
                    tomorrow, or{' '}
                    <Link href="/settings" className="underline underline-offset-2">
                      raise the cap in Settings
                    </Link>
                    .
                  </span>
                </div>
              )}

              <div className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-muted-foreground">Used today</span>
                  <span className={red ? 'text-destructive font-medium' : amber ? 'text-warning font-medium' : ''}>
                    {fmtNum(used_today)} / {fmtNum(daily_tokens)} tokens ({pct.toFixed(0)}%)
                  </span>
                </div>
                <div className="h-1.5 w-full rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: barColor,
                      transition: 'width 300ms ease-out',
                    }}
                  />
                </div>
              </div>
            </div>
          );
        })()
      )}

      <div className="panel p-4">
        <div className="section-title mb-3">Tokens per day</div>
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={dailySeries}>
            <defs>
              <linearGradient id="in" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="out" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--info)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="var(--info)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={fmtNum} />
            <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} />
            <Area type="monotone" dataKey="input_tokens" name="input" stroke="var(--primary)" fill="url(#in)" strokeWidth={2} />
            <Area type="monotone" dataKey="output_tokens" name="output" stroke="var(--info)" fill="url(#out)" strokeWidth={2} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="panel p-4">
        <div className="section-title mb-3">Cost per day ($)</div>
        <ResponsiveContainer width="100%" height={180}>
          <BarChart data={dailySeries}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="day" stroke="var(--muted-foreground)" fontSize={11} />
            <YAxis stroke="var(--muted-foreground)" fontSize={11} tickFormatter={(v) => `$${v}`} />
            <Tooltip contentStyle={{ background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12 }} formatter={(v) => fmtUsd(Number(v))} />
            <Bar dataKey="cost_usd" fill="var(--primary)" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="panel">
        <div className="panel-header"><h3 className="section-title">By agent</h3></div>
        <div className="panel-body p-0">
          <table className="data-table">
            <thead><tr>
              <th>Agent</th><th>Model</th><th>Calls</th><th>Input</th><th>Output</th><th>Avg time</th><th>Cost</th>
            </tr></thead>
            <tbody>
              {data.by_agent.length === 0 && (
                <tr><td colSpan={7} className="text-center text-muted-foreground">No usage yet.</td></tr>
              )}
              {data.by_agent.map((a) => (
                <tr key={a.agent_id}>
                  <td className="font-mono text-xs">{a.agent_id}</td>
                  <td className="text-xs text-muted-foreground">{a.model}</td>
                  <td>{a.calls}</td>
                  <td>{fmtNum(a.input_tokens)}</td>
                  <td>{fmtNum(a.output_tokens)}</td>
                  <td>{a.avg_duration_sec.toFixed(1)}s</td>
                  <td>{fmtUsd(a.cost_usd)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function StatTile({ icon: Icon, label, value, sub }: { icon: typeof Activity; label: string; value: string; sub?: string }) {
  return (
    <div className="stat-tile">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon size={11} /> {label}
      </div>
      <div className="text-xl font-semibold mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}

function SpendCard({ icon: Icon, label, value, sub }: { icon: typeof Activity; label: string; value: string; sub?: string }) {
  return (
    <div className="panel p-4">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-muted-foreground">
        <Icon size={11} /> {label}
      </div>
      <div className="text-lg font-semibold mt-1">{value}</div>
      {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
    </div>
  );
}
