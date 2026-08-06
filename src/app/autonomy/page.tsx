'use client';

import { useEffect, useState } from 'react';
import { Eye, Lightbulb, Zap, Rocket, Check, Loader2, ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { toast } from '@/components/ui/toast';
import { Explainer } from '@/components/ui/explainer';

type Autonomy = 'observe' | 'propose' | 'act_notify' | 'full_auto';
type OverrideValue = 'auto' | 'approve';

interface TypeMeta { type: string; label: string; description: string; hasExecutor: boolean; defaultOverride: OverrideValue }
interface ConfigPayload { level: Autonomy; overrides: Record<string, OverrideValue>; levels: Autonomy[]; types: TypeMeta[] }
interface Entitlements { plan: string; features: { autonomy: Autonomy[] }; next: string | null; catalog: Record<string, { label: string }> }

const LEVELS: Array<{ id: Autonomy; label: string; desc: string; icon: typeof Eye }> = [
  { id: 'observe',   label: 'Observe',     desc: 'Watches and learns. Never produces drafts or sends anything.', icon: Eye },
  { id: 'propose',   label: 'Propose',     desc: 'Drafts everything for your one-tap approval.',                  icon: Lightbulb },
  { id: 'act_notify',label: 'Act + Notify',desc: 'Auto-runs the draft types you approve below; the rest stay drafts.', icon: Zap },
  { id: 'full_auto', label: 'Full Auto',   desc: 'Runs every executable action end-to-end. Hands off.',           icon: Rocket },
];

export default function AutonomyPage() {
  const [data, setData] = useState<ConfigPayload | null>(null);
  const [ent, setEnt] = useState<Entitlements | null>(null);
  const [level, setLevel] = useState<Autonomy>('propose');
  const [overrides, setOverrides] = useState<Record<string, OverrideValue>>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    Promise.all([
      fetch('/api/autonomy', { cache: 'no-store' }).then((r) => r.json()),
      fetch('/api/entitlements', { cache: 'no-store' }).then((r) => r.json()),
    ])
      .then(([j, e]: [ConfigPayload, Entitlements]) => {
        setData(j); setEnt(e); setLevel(j.level);
        // Seed each type with its current override OR the catalog default, so
        // the toggle list reflects the real "what would happen today" state.
        const seeded: Record<string, OverrideValue> = {};
        for (const t of j.types) seeded[t.type] = j.overrides[t.type] ?? t.defaultOverride;
        setOverrides(seeded);
      })
      .catch(() => toast.error('Could not load autonomy config'));
  }, []);

  const allowed = new Set<Autonomy>(ent?.features.autonomy ?? ['observe', 'propose', 'act_notify', 'full_auto']);
  const nextLabel = ent?.next ? (ent.catalog[ent.next]?.label ?? ent.next) : 'Pro';

  async function save() {
    setSaving(true);
    try {
      const r = await fetch('/api/autonomy', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ level, overrides }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'save failed');
      toast.success('Autonomy updated');
    } catch (e) {
      toast.error((e as Error).message);
    } finally { setSaving(false); }
  }

  if (!data) return <div className="p-6 text-sm text-muted-foreground"><Loader2 size={14} className="inline animate-spin mr-2" />Loading…</div>;

  return (
    <div className="space-y-6 animate-in max-w-3xl">
      <Explainer
        id="autonomy"
        title="What this is"
        what="How much your agents may do without asking. From drafting only, through to acting and telling you afterwards."
        when="When approving everything has become the bottleneck, or when something went further than you wanted."
        example="Let them send routine follow-ups on their own, but never anything with a price in it."
      />
      <div className="space-y-1">
        <Link href="/" className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1">
          <ArrowLeft size={11} /> Back to dashboard
        </Link>
        <h1 className="text-xl font-semibold flex items-center gap-2">
          <Zap size={18} className="text-primary" /> Autonomy
        </h1>
        <p className="text-xs text-muted-foreground">
          How much your agents are allowed to do on their own. You can change this anytime.
        </p>
      </div>

      {/* Mode picker */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
        {LEVELS.map((opt) => {
          const Icon = opt.icon;
          const active = level === opt.id;
          const locked = !allowed.has(opt.id);
          return (
            <button
              key={opt.id}
              type="button"
              disabled={locked}
              onClick={() => !locked && setLevel(opt.id)}
              title={locked ? `${opt.label} is part of ${nextLabel}` : undefined}
              className="flex items-start gap-3 rounded-xl border bg-[var(--surface-2)] p-3.5 text-left transition-all"
              style={{
                borderColor: active ? 'var(--primary)' : 'var(--border)',
                boxShadow: active ? '0 0 0 1px var(--primary), 0 0 18px rgba(16,217,130,0.15)' : undefined,
                opacity: locked ? 0.55 : 1,
                cursor: locked ? 'not-allowed' : 'pointer',
              }}
            >
              <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg"
                style={{ background: active ? 'var(--primary)' : 'var(--surface-2)', color: active ? 'var(--primary-foreground)' : 'var(--muted-foreground)' }}>
                <Icon size={14} />
              </span>
              <span className="flex-1">
                <span className="block text-sm font-medium flex items-center gap-1.5">
                  {opt.label}
                  {locked && <span className="badge badge-neutral text-[9px] py-0">{nextLabel}</span>}
                </span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{opt.desc}</span>
              </span>
              {active && <Check size={14} className="text-[var(--primary)] mt-0.5" />}
            </button>
          );
        })}
      </div>

      {/* Per-type toggles — only matter in act_notify mode */}
      <div className="panel">
        <div className="panel-header">
          <div className="section-title">Per-action behavior</div>
          <p className="text-[11px] text-muted-foreground mt-1">
            {level === 'act_notify'
              ? 'In Act + Notify, the agents auto-run the actions marked Auto and queue the rest for your approval.'
              : level === 'observe'
                ? 'Observe mode blocks every outbound action, so these toggles are inactive.'
                : level === 'propose'
                  ? 'Propose mode queues every action for your approval, so these toggles are inactive.'
                  : 'Full Auto runs every executable action without approval; these toggles are inactive.'}
          </p>
        </div>
        <div className="panel-body divide-y divide-border/40">
          {data.types.map((t) => {
            const value = overrides[t.type] ?? t.defaultOverride;
            const editable = level === 'act_notify' && t.hasExecutor;
            return (
              <div key={t.type} className="py-3 flex items-center justify-between gap-4">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground">{t.description}</div>
                </div>
                {!t.hasExecutor ? (
                  <span className="badge badge-neutral shrink-0">always needs approval</span>
                ) : (
                  <div className="flex items-center gap-1 shrink-0">
                    {(['auto', 'approve'] as OverrideValue[]).map((v) => {
                      const on = value === v;
                      return (
                        <button
                          key={v}
                          disabled={!editable}
                          onClick={() => setOverrides((o) => ({ ...o, [t.type]: v }))}
                          className="btn btn-sm"
                          style={{
                            background: on ? 'var(--primary)' : 'transparent',
                            color: on ? 'var(--primary-foreground)' : 'var(--muted-foreground)',
                            border: '1px solid var(--border)',
                            opacity: editable ? 1 : 0.55,
                          }}
                        >
                          {v === 'auto' ? 'Auto-run' : 'Approve first'}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
          {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />} Save
        </button>
        <span className="text-[11px] text-muted-foreground">
          Currently saved: <strong>{LEVELS.find((l) => l.id === data.level)?.label}</strong>
        </span>
      </div>
    </div>
  );
}
