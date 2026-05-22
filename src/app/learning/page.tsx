'use client';

import { useEffect, useState } from 'react';
import { TrendingUp, Loader2, Info } from 'lucide-react';

interface PolicyRow { role: string; agent_id: string; variant: string; n: number; reward_mean: number; last_reward: number | null; updated_at: string }
interface EventRow { task_id: number | null; agent_id: string; role: string; reward: number; components: { approval: number | null; outcome: number | null; reliability: number | null }; stage: string; scored_at: string }
interface Data {
  policy: PolicyRow[];
  events: EventRow[];
  summary: { totalRuns: number; weightedMean: number; byRole: Record<string, { n: number; mean: number }> };
}

function pct(n: number) { return `${Math.round(n * 100)}%`; }
function comp(v: number | null) { return v == null ? '—' : v.toFixed(2); }
function ago(iso: string) {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s`; if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`; return `${Math.floor(s / 86400)}d`;
}
function rewardColor(r: number) { return r >= 0.66 ? 'var(--success, #16a34a)' : r >= 0.33 ? 'var(--warning, #d97706)' : 'var(--destructive, #dc2626)'; }

export default function LearningPage() {
  const [data, setData] = useState<Data | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetch('/api/learning', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && j && !j.error) setData(j); })
      .finally(() => on && setLoading(false));
    return () => { on = false; };
  }, []);

  return (
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2"><TrendingUp size={18} className="text-primary" /> Learning</h1>
        <p className="text-xs text-muted-foreground">What&apos;s working across the agents. Each completed run is scored with the owner-weighted blend (Reliability · Approval · Outcome) and accumulated per agent.</p>
      </div>

      <div className="panel p-2.5 text-[11px] text-muted-foreground flex items-start gap-2">
        <Info size={13} className="mt-0.5 shrink-0" />
        <span><strong className="text-foreground">Measurement only (Phase 3, slice 1).</strong> This observes what works — it does not yet change which agent gets picked. Outcome is wired but not yet attributed per run (that lands with goal-event scoring next), so today&apos;s reward leans on Reliability + Approval. Scoring runs on the daily improve cron.</span>
      </div>

      {loading ? (
        <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
      ) : !data ? (
        <div className="panel p-8 text-sm text-muted-foreground">Couldn&apos;t load learning data.</div>
      ) : data.policy.length === 0 ? (
        <div className="panel p-8 text-sm text-muted-foreground text-center">
          No runs scored yet. Once agents complete tasks, the daily improve sweep scores them here — or trigger the improve cron to score immediately.
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <Stat label="Runs scored" value={String(data.summary.totalRuns)} />
            <Stat label="Mean reward" value={pct(data.summary.weightedMean)} />
            <Stat label="Agents tracked" value={String(data.policy.length)} />
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Per-agent policy</div>
            <div className="panel divide-y divide-border/40 overflow-hidden">
              {data.policy.map((p) => (
                <div key={`${p.role}:${p.agent_id}:${p.variant}`} className="px-3 py-2.5 flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium truncate">{p.agent_id}</div>
                    <div className="text-[10px] text-muted-foreground">{p.role} · {p.n} run{p.n === 1 ? '' : 's'} · updated {ago(p.updated_at)} ago</div>
                  </div>
                  <div className="w-40 shrink-0">
                    <div className="h-2.5 rounded-full bg-[var(--surface-2)] overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: pct(p.reward_mean), background: rewardColor(p.reward_mean) }} />
                    </div>
                  </div>
                  <div className="w-12 text-right text-sm font-mono tabular-nums">{p.reward_mean.toFixed(2)}</div>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Recent scored runs</div>
            <div className="panel divide-y divide-border/40 overflow-hidden">
              {data.events.length === 0 ? (
                <div className="px-3 py-3 text-xs text-muted-foreground">No scored runs yet.</div>
              ) : data.events.map((e, i) => (
                <div key={i} className="px-3 py-2 flex items-center gap-3 text-xs">
                  <span className="font-mono tabular-nums w-10" style={{ color: rewardColor(e.reward) }}>{e.reward.toFixed(2)}</span>
                  <span className="font-medium w-36 truncate">{e.agent_id}</span>
                  <span className="text-[10px] text-muted-foreground hidden sm:inline">R {comp(e.components.reliability)} · A {comp(e.components.approval)} · O {comp(e.components.outcome)}</span>
                  <span className={`badge ${e.stage === 'warm' ? 'badge-success' : 'badge-neutral'} text-[9px] ml-auto`}>{e.stage}</span>
                  <span className="text-[10px] text-muted-foreground w-8 text-right">{ago(e.scored_at)}</span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-2xl font-bold">{value}</div>
    </div>
  );
}
