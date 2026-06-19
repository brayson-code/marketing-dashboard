'use client';

import { useEffect, useState } from 'react';
import {
  ShieldCheck, ShieldAlert, Loader2, RefreshCw, Activity, AlertTriangle,
  Clock, Filter, KeyRound, Ban, Gauge,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';

// HQ-only Security Console. Mirrors the KeyWatch / Issues HQ-gating exactly:
//   - the API (/api/security/console) is requireHq()-gated server-side (the real
//     boundary), and additionally we hide the surface here when /api/auth/me says
//     the workspace isn't HQ. This client gate is a UX nicety, not the security line.
// It renders the cross-tenant security_events stream, firing detections, the
// pending-approvals backlog, and a platform health roll-up.

type Severity = 'info' | 'warning' | 'critical';

interface ConsoleEvent {
  id: string;
  tenant_id: string;
  tenant_name: string | null;
  type: string;
  severity: string;
  actor_user_id: string | null;
  resource_ref: string | null;
  detail: Record<string, unknown> | null;
  created_at: string;
}
interface Detection { id: string; severity: Severity; title: string; detail: string; count: number }
interface GroupCount { type: string; severity: string; count: number }
interface PendingRow {
  id: string; tenant_id: string; tenant_name: string | null;
  requested_by: string | null; action: string; resource_ref: string | null; created_at: string;
}
interface HealthRollup {
  score: number; status: 'healthy' | 'degraded' | 'down';
  runs24h: number; errors24h: number; stuckTasks: number; failedCrons: number;
}
interface ConsolePayload {
  events: ConsoleEvent[];
  detections: Detection[];
  grouped: { last24h: GroupCount[]; last7d: GroupCount[] };
  pending: { rows: PendingRow[]; total: number };
  health: HealthRollup;
  filters: { type: string | null; severity: string | null };
  checkedAt: string;
}

const EVENT_TYPES = [
  'authz_deny', 'owner_gate_deny', 'rate_limited', 'auth_fail',
  'cross_tenant_attempt', 'secret_step_up', 'pending_approval_created',
  'integration_secret_access',
] as const;

const TYPE_LABEL: Record<string, string> = {
  authz_deny: 'Authz deny',
  owner_gate_deny: 'Owner-gate deny',
  rate_limited: 'Rate limited',
  auth_fail: 'Auth fail',
  cross_tenant_attempt: 'Cross-tenant attempt',
  secret_step_up: 'Secret step-up',
  pending_approval_created: 'Approval created',
  integration_secret_access: 'Secret access',
};

function sevColor(s: string): string {
  return s === 'critical' ? 'var(--destructive)'
    : s === 'warning' ? 'var(--warning, #f59e0b)'
    : 'var(--info, var(--primary))';
}
function sevPillClass(s: string): string {
  if (s === 'critical') return 'bg-destructive/15 text-destructive';
  if (s === 'warning') return 'bg-warning/15 text-warning';
  return 'bg-info/15 text-info';
}
function scoreColor(score: number): string {
  return score >= 90 ? 'var(--success)' : score >= 60 ? 'var(--warning, #f59e0b)' : 'var(--destructive)';
}
function shortId(v: string | null): string {
  if (!v) return '—';
  return v.length > 12 ? `${v.slice(0, 8)}…` : v;
}

export default function SecurityConsolePage() {
  // null = checking. HQ-only (it reads across ALL tenants).
  const [isHq, setIsHq] = useState<boolean | null>(null);
  const [typeFilter, setTypeFilter] = useState('');
  const [sevFilter, setSevFilter] = useState('');

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setIsHq(!!j?.is_hq))
      .catch(() => setIsHq(false));
  }, []);

  const query = (() => {
    const p = new URLSearchParams();
    if (typeFilter) p.set('type', typeFilter);
    if (sevFilter) p.set('severity', sevFilter);
    p.set('limit', '200');
    return p.toString();
  })();

  const { data, loading, refetch } = useSmartPoll<ConsolePayload>(
    () => fetch(`/api/security/console?${query}`, { cache: 'no-store' }).then((r) => {
      if (!r.ok) throw new Error(String(r.status));
      return r.json();
    }),
    { interval: 20_000, enabled: isHq === true, key: query },
  );

  // Non-HQ workspaces get a clean "not available" panel. The API is independently
  // guarded (requireHq), so this is UX, not the security boundary.
  if (isHq === false) {
    return (
      <div className="animate-in">
        <div className="panel p-8 max-w-lg mx-auto mt-10 text-center space-y-3">
          <ShieldCheck size={28} className="mx-auto text-muted-foreground" />
          <h1 className="text-h2">Not available</h1>
          <p className="text-sm text-muted-foreground">
            The Security Console is an internal operations tool for the KeyPlayers team
            and isn’t part of your workspace.
          </p>
        </div>
      </div>
    );
  }
  if (isHq === null) {
    return (
      <div className="h-[50vh] grid place-items-center">
        <Loader2 className="animate-spin text-muted-foreground" />
      </div>
    );
  }

  const detections = data?.detections ?? [];
  const events = data?.events ?? [];
  const pending = data?.pending.rows ?? [];
  const health = data?.health;
  const grouped = data?.grouped.last24h ?? [];

  return (
    <div className="space-y-4 animate-in">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-h1 flex items-center gap-2">
            <ShieldCheck size={18} className="text-primary" /> Security Console
          </h1>
          <p className="text-xs text-muted-foreground">
            Platform-wide security &amp; ops event stream across all tenants — HQ only.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {data?.checkedAt && (
            <span className="text-muted-foreground">updated {timeAgo(data.checkedAt)}</span>
          )}
          <button className="btn btn-ghost btn-sm" onClick={() => refetch()} title="Refresh">
            <RefreshCw size={12} />
          </button>
        </div>
      </div>

      {/* Top row: health roll-up + firing detections */}
      <div className="grid gap-4 lg:grid-cols-3">
        <HealthCard health={health} />
        <div className="lg:col-span-2 panel">
          <div className="panel-header flex items-center gap-2">
            <ShieldAlert size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Firing detections</h2>
            <span className="badge badge-neutral ml-auto">{detections.length}</span>
          </div>
          <div className="panel-body">
            {detections.length === 0 ? (
              <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
                <ShieldCheck size={16} className="text-success" /> No detections firing.
              </div>
            ) : (
              <div className="space-y-2">
                {detections.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-start gap-3 rounded-lg border border-border/60 bg-[var(--surface-2)] p-3"
                  >
                    <span
                      className="w-2 h-2 rounded-full mt-1.5 shrink-0"
                      style={{ background: sevColor(d.severity) }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium">{d.title}</span>
                        <span className={`text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${sevPillClass(d.severity)}`}>
                          {d.severity}
                        </span>
                      </div>
                      <p className="text-xs text-muted-foreground mt-0.5">{d.detail}</p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Detection summary (counts by type, 24h) + pending approvals */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2 panel">
          <div className="panel-header flex items-center gap-2">
            <Activity size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Events by type (24h)</h2>
          </div>
          <div className="panel-body">
            {grouped.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3">No events in the last 24h.</div>
            ) : (
              <div className="grid gap-2 sm:grid-cols-2">
                {grouped.map((g) => (
                  <button
                    key={`${g.type}:${g.severity}`}
                    onClick={() => { setTypeFilter(g.type); setSevFilter(g.severity); }}
                    className="flex items-center gap-2 rounded-lg border border-border/60 bg-[var(--surface-2)] px-3 py-2 text-left hover:border-primary/50 transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sevColor(g.severity) }} />
                    <span className="text-xs flex-1 truncate">{TYPE_LABEL[g.type] ?? g.type}</span>
                    <span className="badge badge-neutral">{g.count}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="panel">
          <div className="panel-header flex items-center gap-2">
            <KeyRound size={14} className="text-muted-foreground" />
            <h2 className="text-sm font-semibold">Pending approvals</h2>
            <span className="badge badge-neutral ml-auto">{data?.pending.total ?? 0}</span>
          </div>
          <div className="panel-body">
            {pending.length === 0 ? (
              <div className="text-sm text-muted-foreground py-3">No open step-up approvals.</div>
            ) : (
              <div className="space-y-2 max-h-72 overflow-y-auto">
                {pending.map((p) => (
                  <div key={p.id} className="rounded-lg border border-border/60 bg-[var(--surface-2)] p-2.5">
                    <div className="flex items-center gap-2">
                      <Ban size={12} className="text-warning shrink-0" />
                      <span className="text-xs font-medium truncate flex-1">{p.action}</span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">{timeAgo(p.created_at)}</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-1 truncate">
                      {p.tenant_name ?? shortId(p.tenant_id)}
                      {p.resource_ref ? ` · ${p.resource_ref}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Event stream */}
      <div className="panel">
        <div className="panel-header flex items-center gap-2 flex-wrap">
          <Activity size={14} className="text-muted-foreground" />
          <h2 className="text-sm font-semibold">Event stream</h2>
          <div className="flex items-center gap-2 ml-auto text-xs">
            <Filter size={12} className="text-muted-foreground" />
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value)}
              className="px-2 py-1 rounded-md border border-border bg-background text-xs"
            >
              <option value="">All types</option>
              {EVENT_TYPES.map((t) => (
                <option key={t} value={t}>{TYPE_LABEL[t]}</option>
              ))}
            </select>
            <select
              value={sevFilter}
              onChange={(e) => setSevFilter(e.target.value)}
              className="px-2 py-1 rounded-md border border-border bg-background text-xs"
            >
              <option value="">All severities</option>
              <option value="critical">critical</option>
              <option value="warning">warning</option>
              <option value="info">info</option>
            </select>
            {(typeFilter || sevFilter) && (
              <button className="btn btn-ghost btn-sm" onClick={() => { setTypeFilter(''); setSevFilter(''); }}>
                Clear
              </button>
            )}
          </div>
        </div>
        <div className="panel-body">
          {loading && events.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-muted-foreground">
              <Loader2 size={16} className="animate-spin" />
            </div>
          ) : events.length === 0 ? (
            <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
              No events match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-[10px] uppercase tracking-wide text-muted-foreground border-b border-border/40">
                    <th className="text-left font-medium py-2 pr-3">Severity</th>
                    <th className="text-left font-medium py-2 pr-3">Type</th>
                    <th className="text-left font-medium py-2 pr-3">Tenant</th>
                    <th className="text-left font-medium py-2 pr-3">Actor</th>
                    <th className="text-left font-medium py-2 pr-3">Resource</th>
                    <th className="text-right font-medium py-2 pl-3 whitespace-nowrap">When</th>
                  </tr>
                </thead>
                <tbody>
                  {events.map((e) => (
                    <tr key={e.id} className="border-b border-border/20 last:border-0 hover:bg-[var(--surface-2)]/50">
                      <td className="py-2 pr-3">
                        <span className="inline-flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: sevColor(e.severity) }} />
                          <span className="text-muted-foreground">{e.severity}</span>
                        </span>
                      </td>
                      <td className="py-2 pr-3 font-medium">{TYPE_LABEL[e.type] ?? e.type}</td>
                      <td className="py-2 pr-3 text-muted-foreground truncate max-w-[140px]" title={e.tenant_id}>
                        {e.tenant_name ?? shortId(e.tenant_id)}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground font-mono" title={e.actor_user_id ?? 'system'}>
                        {e.actor_user_id ? shortId(e.actor_user_id) : 'system'}
                      </td>
                      <td className="py-2 pr-3 text-muted-foreground truncate max-w-[160px]" title={e.resource_ref ?? ''}>
                        {e.resource_ref ?? '—'}
                      </td>
                      <td className="py-2 pl-3 text-right text-muted-foreground whitespace-nowrap">
                        <span className="inline-flex items-center gap-1 justify-end">
                          <Clock size={10} /> {timeAgo(e.created_at)}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function HealthCard({ health }: { health: HealthRollup | undefined }) {
  const score = health?.score ?? null;
  const color = score == null ? 'var(--muted-foreground)' : scoreColor(score);
  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Gauge size={14} className="text-muted-foreground" />
        <h2 className="text-sm font-semibold">Platform health</h2>
      </div>
      <div className="panel-body">
        <div className="flex items-end gap-2">
          <span className="text-3xl font-bold font-mono" style={{ color }}>
            {score == null ? '—' : `${score}`}
          </span>
          <span className="text-xs text-muted-foreground mb-1">/ 100</span>
          {health && (
            <span className={`ml-auto mb-1 text-[10px] font-medium uppercase px-2 py-0.5 rounded-full ${
              health.status === 'healthy' ? 'bg-success/15 text-success'
                : health.status === 'degraded' ? 'bg-warning/15 text-warning'
                : 'bg-destructive/15 text-destructive'
            }`}>
              {health.status}
            </span>
          )}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
          <Stat label="Runs (24h)" value={health?.runs24h ?? 0} />
          <Stat label="Errors (24h)" value={health?.errors24h ?? 0} warn={(health?.errors24h ?? 0) > 0} />
          <Stat label="Stuck tasks" value={health?.stuckTasks ?? 0} warn={(health?.stuckTasks ?? 0) > 0} />
          <Stat label="Failed crons" value={health?.failedCrons ?? 0} warn={(health?.failedCrons ?? 0) > 0} />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, warn }: { label: string; value: number; warn?: boolean }) {
  return (
    <div className="rounded-lg border border-border/60 bg-[var(--surface-2)] px-2.5 py-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={`text-base font-semibold font-mono ${warn ? 'text-warning' : ''}`}>
        {warn && <AlertTriangle size={11} className="inline mr-1 -mt-0.5" />}{value}
      </div>
    </div>
  );
}
