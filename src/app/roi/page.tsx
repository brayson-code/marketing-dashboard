'use client';

import { useCallback, useEffect, useState } from 'react';
import { Timer, DollarSign, TrendingUp, AlertCircle, Check, Save, SlidersHorizontal } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';

interface KeyAudit {
  annual_revenue: number | null;
  annual_profit: number | null;
  hours_per_week: number | null;
  admin_percentage: number | null;
  presets: Record<string, number>;
  updated_at: string | null;
}
interface RoiSummary {
  audit: KeyAudit;
  hoursSavedAllTime: number;
  hoursSavedThisMonth: number;
  valueReclaimed: number;
  oldDollarPerHour: number | null;
  newDollarPerHour: number | null;
  projectedAnnualValue: number | null;
  byAgent: Array<{ agent_id: string | null; hours: number; value: number }>;
  byMonth: Array<{ month: string; hours: number; value: number }>;
  hasActuals: boolean;
}

const INPUT = 'px-3 py-2 rounded-lg border border-border bg-background text-sm w-full';
const fmtUsd = (n: number | null) => (n == null ? '—' : `$${Math.round(n).toLocaleString()}`);
const fmtHrs = (n: number) => `${n.toFixed(n < 10 ? 1 : 0)} hrs`;
const WEEKS = 52;

export default function RoiPage() {
  const [data, setData] = useState<RoiSummary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState({ annual_revenue: '', annual_profit: '', hours_per_week: '', admin_percentage: '' });
  const [presets, setPresets] = useState<Record<string, number>>({});
  const [showPresets, setShowPresets] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/roi', { cache: 'no-store' });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || 'Failed to load');
      setData(json);
      setPresets(json.audit.presets ?? {});
      setForm({
        annual_revenue: json.audit.annual_revenue?.toString() ?? '',
        annual_profit: json.audit.annual_profit?.toString() ?? '',
        hours_per_week: json.audit.hours_per_week?.toString() ?? '',
        admin_percentage: json.audit.admin_percentage?.toString() ?? '',
      });
      setError(null);
    } catch (e) { setError((e as Error).message); }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { if (!notice) return; const t = setTimeout(() => setNotice(null), 3000); return () => clearTimeout(t); }, [notice]);

  // Live calc from the form (mirrors the server formulas) so numbers move as you type.
  const profit = Number(form.annual_profit) || 0;
  const hrs = Number(form.hours_per_week) || 0;
  const adminPct = Number(form.admin_percentage) || 0;
  const annualHours = hrs * WEEKS;
  const oldRate = annualHours > 0 && profit > 0 ? profit / annualHours : null;
  const adminHrsWeek = hrs * (adminPct / 100);
  const adminHrsYear = adminHrsWeek * WEEKS;
  const costOfAdmin = oldRate != null ? adminHrsYear * oldRate : null;

  async function saveAudit() {
    setSaving(true);
    try {
      const res = await fetch('/api/roi', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          annual_revenue: form.annual_revenue ? Number(form.annual_revenue) : null,
          annual_profit: form.annual_profit ? Number(form.annual_profit) : null,
          hours_per_week: form.hours_per_week ? Number(form.hours_per_week) : null,
          admin_percentage: form.admin_percentage ? Number(form.admin_percentage) : null,
        }),
      });
      if (!res.ok) { const j = await res.json(); setError(j.error || 'Save failed'); }
      else { setError(null); setNotice('Key Audit saved'); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  async function savePresets() {
    setSaving(true);
    try {
      const res = await fetch('/api/roi', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ presets }) });
      if (!res.ok) { const j = await res.json(); setError(j.error || 'Save failed'); }
      else { setError(null); setNotice('Presets saved'); await load(); }
    } catch (e) { setError((e as Error).message); }
    finally { setSaving(false); }
  }

  if (!data) return <div className="space-y-4 animate-in"><Skeleton className="h-8 w-48" /><div className="grid grid-cols-1 md:grid-cols-3 gap-3">{[0,1,2].map((i)=><Skeleton key={i} className="h-28 w-full" />)}</div><Skeleton className="h-64 w-full" /></div>;

  const maxMonth = Math.max(1, ...data.byMonth.map((m) => m.hours));

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold flex items-center gap-2"><Timer size={18} className="text-primary" /> ROI · Time Saved</h1>
          <p className="text-xs text-muted-foreground">
            How much time your agents save, and what that time is worth.
            <span className={`badge ml-2 ${data.hasActuals ? 'badge-success' : 'badge-warning'}`}>{data.hasActuals ? 'actual' : 'projected'}</span>
          </p>
        </div>
      </div>

      {error && <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5"><AlertCircle size={12} /> {error}</div>}
      {notice && <div className="panel p-3 text-xs text-emerald-500 flex items-center gap-1.5"><Check size={12} /> {notice}</div>}

      {/* Hero stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="panel p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><Timer size={12} /> Hours saved</div>
          <div className="text-2xl font-semibold">{fmtHrs(data.hoursSavedAllTime)}</div>
          <div className="text-[11px] text-muted-foreground">{fmtHrs(data.hoursSavedThisMonth)} this month</div>
        </div>
        <div className="panel p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><DollarSign size={12} /> Value reclaimed</div>
          <div className="text-2xl font-semibold">{fmtUsd(data.valueReclaimed)}</div>
          <div className="text-[11px] text-muted-foreground">projected annual {fmtUsd(data.projectedAnnualValue)}</div>
        </div>
        <div className="panel p-4 space-y-1">
          <div className="text-xs text-muted-foreground flex items-center gap-1.5"><TrendingUp size={12} /> Your $/hour</div>
          <div className="text-2xl font-semibold flex items-baseline gap-2">
            {fmtUsd(data.oldDollarPerHour)}
            {data.newDollarPerHour != null && data.oldDollarPerHour != null && data.newDollarPerHour > data.oldDollarPerHour && (
              <span className="text-sm text-emerald-500">→ {fmtUsd(data.newDollarPerHour)}</span>
            )}
          </div>
          <div className="text-[11px] text-muted-foreground">old → projected new</div>
        </div>
      </div>

      {/* Key Audit */}
      <div className="panel p-4 space-y-3">
        <div className="section-title">Key Audit</div>
        <p className="text-xs text-muted-foreground">Set these once. They define your dollar-per-hour, which values every hour the agents give back.</p>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Annual revenue ($)</span>
            <input className={INPUT} inputMode="numeric" value={form.annual_revenue} onChange={(e) => setForm({ ...form, annual_revenue: e.target.value })} placeholder="500000" /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Annual profit ($)</span>
            <input className={INPUT} inputMode="numeric" value={form.annual_profit} onChange={(e) => setForm({ ...form, annual_profit: e.target.value })} placeholder="150000" /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">Hours/week (owner)</span>
            <input className={INPUT} inputMode="numeric" value={form.hours_per_week} onChange={(e) => setForm({ ...form, hours_per_week: e.target.value })} placeholder="55" /></label>
          <label className="space-y-1 text-xs"><span className="text-muted-foreground">% on admin/ops</span>
            <input className={INPUT} inputMode="numeric" value={form.admin_percentage} onChange={(e) => setForm({ ...form, admin_percentage: e.target.value })} placeholder="40" /></label>
        </div>
        {oldRate != null && (
          <div className="text-xs bg-[var(--surface-2)] rounded border border-border/60 p-3 space-y-1 font-mono">
            <div>Your time: <b>{fmtUsd(oldRate)}/hr</b> &nbsp;(profit ÷ {annualHours.toLocaleString()} hrs/yr)</div>
            <div>Admin drag: <b>{adminHrsWeek.toFixed(1)} hrs/wk</b> = {Math.round(adminHrsYear).toLocaleString()} hrs/yr {costOfAdmin != null && <>· worth <b>{fmtUsd(costOfAdmin)}/yr</b> trapped in admin</>}</div>
          </div>
        )}
        <div className="flex gap-2">
          <button onClick={saveAudit} disabled={saving} className="btn btn-primary btn-sm"><Save size={12} /> Save audit</button>
          <button onClick={() => setShowPresets((s) => !s)} className="btn btn-ghost btn-sm"><SlidersHorizontal size={12} /> {showPresets ? 'Hide' : 'Edit'} time-per-task presets</button>
        </div>
      </div>

      {/* Presets editor */}
      {showPresets && (
        <div className="panel p-4 space-y-3">
          <div className="section-title">Minutes saved per task type</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {Object.entries(presets).map(([k, v]) => (
              <label key={k} className="flex items-center justify-between gap-2 text-xs">
                <span className="text-muted-foreground">{k.replace(/_/g, ' ')}</span>
                <input className="px-2 py-1 rounded border border-border bg-background text-sm w-20 text-right" inputMode="numeric"
                  value={v} onChange={(e) => setPresets({ ...presets, [k]: Number(e.target.value) || 0 })} />
              </label>
            ))}
          </div>
          <button onClick={savePresets} disabled={saving} className="btn btn-primary btn-sm"><Save size={12} /> Save presets</button>
        </div>
      )}

      {/* Breakdowns */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="panel p-4 space-y-2">
          <div className="section-title">By agent</div>
          {data.byAgent.length === 0 ? (
            <div className="text-xs text-muted-foreground">No agent activity logged yet. As agents complete tasks, their time savings appear here.</div>
          ) : data.byAgent.map((a) => (
            <div key={a.agent_id ?? 'unknown'} className="flex items-center justify-between text-xs">
              <span className="font-mono">{a.agent_id ?? 'unknown'}</span>
              <span className="text-muted-foreground">{fmtHrs(a.hours)} · {fmtUsd(a.value)}</span>
            </div>
          ))}
        </div>
        <div className="panel p-4 space-y-2">
          <div className="section-title">Monthly trend</div>
          {data.byMonth.length === 0 ? (
            <div className="text-xs text-muted-foreground">No history yet.</div>
          ) : data.byMonth.map((m) => (
            <div key={m.month} className="space-y-0.5">
              <div className="flex justify-between text-[11px] text-muted-foreground"><span>{m.month}</span><span>{fmtHrs(m.hours)}</span></div>
              <div className="h-2 rounded bg-[var(--surface-2)] overflow-hidden">
                <div className="h-full bg-primary/70" style={{ width: `${Math.min(100, (m.hours / maxMonth) * 100)}%` }} />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
