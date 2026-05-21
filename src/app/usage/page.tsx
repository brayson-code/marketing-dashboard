'use client';

import { useCallback, useEffect, useState } from 'react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Legend } from 'recharts';
import { DollarSign, Cpu, Zap, Activity } from 'lucide-react';

interface DailyUsage { day: string; input_tokens: number; output_tokens: number; cost_usd: number; calls: number }
interface AgentUsage { agent_id: string; model: string; calls: number; input_tokens: number; output_tokens: number; cost_usd: number; avg_duration_sec: number }
interface UsageSummary {
  total: { input_tokens: number; output_tokens: number; cost_usd: number; calls: number };
  by_day: DailyUsage[];
  by_agent: AgentUsage[];
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
  const [days, setDays] = useState(14);

  const load = useCallback(async () => {
    const res = await fetch(`/api/usage?days=${days}`, { cache: 'no-store' });
    setData(await res.json());
  }, [days]);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);

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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <StatTile icon={Activity} label="Calls" value={String(data.total.calls)} />
        <StatTile icon={Cpu} label="Tokens" value={fmtNum(totalTokens)} sub={`${fmtNum(data.total.input_tokens)} in · ${fmtNum(data.total.output_tokens)} out`} />
        <StatTile icon={DollarSign} label="Cost" value={fmtUsd(data.total.cost_usd)} sub={`last ${days}d`} />
        <StatTile icon={Zap} label="Avg / call" value={data.total.calls > 0 ? fmtUsd(data.total.cost_usd / data.total.calls) : '—'} />
      </div>

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
