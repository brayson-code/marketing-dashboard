'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Building2, Check, AlertCircle, ArrowRight, ArrowLeft, Sparkles, ClipboardCheck } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';
import {
  SETUP_STEPS, stepComplete, setupProgress, type SetupStep,
} from '@/lib/business-setup';

// Business Setup — the permanent, re-editable version of onboarding.
//
// SAVED PER STEP, deliberately. A long form that only commits at the end loses work
// whenever someone gets pulled away mid-setup, which is exactly what happens to the
// people filling this in. Each step writes on continue, so leaving halfway costs
// nothing.
//
// Each step targets the store that already owns its data (Founder Profile or the
// company playbook) rather than a third copy — see @/lib/business-setup.

export default function BusinessSetupPage() {
  const [i, setI] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  // Set when Client Success filled this in on the onboarding call. Changes the whole
  // framing of the page from "author this" to "check we got it right".
  const [captured, setCaptured] = useState<{ by: string | null; at: string } | null>(null);

  // Load whatever is already answered, from both stores, so this is an edit surface
  // rather than a blank form every time.
  useEffect(() => {
    let off = false;
    (async () => {
      const json = async (u: string) => {
        try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
        catch { return null; }
      };
      const [f, p] = await Promise.all([json('/api/founder'), json('/api/playbook')]);
      if (off) return;
      const merged: Record<string, string> = {};
      for (const [k, v] of Object.entries((f?.answers ?? {}) as Record<string, unknown>)) {
        if (typeof v === 'string') merged[k] = v;
      }
      for (const [k, v] of Object.entries((p?.answers ?? {}) as Record<string, unknown>)) {
        if (typeof v === 'string') merged[k] = v;
      }
      setValues(merged);
      setCaptured(f?.captured ?? null);
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  const step: SetupStep = SETUP_STEPS[i];
  const progress = useMemo(() => setupProgress(values), [values]);

  /** Persist THIS step to its own store. Only the keys this step owns are sent, so two
   *  steps writing to the same store can't clobber each other's fields. */
  const saveStep = async (s: SetupStep): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      if (s.target === 'founder') {
        // The founder route replaces the whole object, so send everything we hold for
        // it — sending only this step's keys would wipe the others.
        const founderKeys = SETUP_STEPS.filter((x) => x.target === 'founder').flatMap((x) => x.fields.map((f) => f.key));
        const answers: Record<string, string> = {};
        for (const k of founderKeys) if ((values[k] ?? '').trim()) answers[k] = values[k].trim();
        const res = await fetch('/api/founder', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      } else {
        const pbKeys = SETUP_STEPS.filter((x) => x.target === 'playbook').flatMap((x) => x.fields.map((f) => f.key));
        const answers: Record<string, string> = {};
        for (const k of pbKeys) if ((values[k] ?? '').trim()) answers[k] = values[k].trim();
        // answers_only: never triggers the Claude draft, so setup works before a key
        // is connected.
        const res = await fetch('/api/playbook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers, answers_only: true }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Could not save');
      }
      setSavedAt(new Date().toLocaleTimeString());
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
      return false;
    } finally {
      setSaving(false);
    }
  };

  const next = async () => {
    if (await saveStep(step) && i < SETUP_STEPS.length - 1) setI(i + 1);
  };
  const jump = async (to: number) => {
    await saveStep(step);
    setI(to);
  };

  const done = i === SETUP_STEPS.length - 1;

  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<Building2 size={20} />}
        title="Business Setup"
        subtitle="Everything the Command Centre needs to know about you and the business."
      />

      {/* When the call was captured, this REPLACES the explainer rather than sitting
          next to it. Two boxes of preamble is how people learn to skip both, and the
          job to be done is different: check what we wrote, not fill in a form. */}
      {captured ? (
        <div
          className="panel p-3 flex items-start gap-2.5"
          style={{
            background: 'color-mix(in srgb, var(--primary) 6%, transparent)',
            borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
          }}
        >
          <ClipboardCheck size={15} className="text-[var(--primary)] shrink-0 mt-0.5" />
          <div className="text-xs space-y-1">
            <p className="font-semibold text-sm">We filled this in from your onboarding call</p>
            <p className="text-muted-foreground">
              Read through and correct anything we got wrong. Your assistant and every AI
              agent work from these answers, so it is worth being picky, especially about
              what they can approve without asking you.
            </p>
          </div>
        </div>
      ) : (
        <Explainer
          id="business-setup-intro"
          title="Why this is worth ten minutes"
          what="These answers are given to every AI agent before it does any work — so they act like they know you and your business, instead of guessing."
          when="Fill it in once when the workspace is set up, then come back whenever something changes. Nothing here is locked."
          example="“Never book meetings before 9am.” “My assistant can approve anything under $500.”"
        />
      )}

      {progress.total > 0 && (
        <div className="panel p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">
              {progress.pct === 100 ? 'All set — your agents have the full picture' : 'Setup progress'}
            </span>
            <span className="text-muted-foreground">{progress.filled} of {progress.total} answered · {progress.pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{ width: `${progress.pct}%`, background: progress.pct === 100 ? 'var(--success)' : 'var(--primary)' }}
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">Loading…</div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-[200px_1fr] gap-4">
          {/* Numbered step rail — jump anywhere, current step saves on the way out. */}
          <div className="panel p-2 h-fit">
            {SETUP_STEPS.map((s, idx) => {
              const complete = stepComplete(s, values);
              const active = idx === i;
              return (
                <button
                  key={s.id}
                  onClick={() => jump(idx)}
                  className="w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2 text-xs"
                  style={{
                    background: active ? 'var(--accent)' : 'transparent',
                    color: active ? 'var(--accent-foreground)' : 'var(--foreground)',
                  }}
                >
                  <span className="text-[10px] font-mono text-muted-foreground">
                    {String(idx + 1).padStart(2, '0')}
                  </span>
                  <span className="flex-1 truncate">{s.title}</span>
                  {complete && <Check size={12} className="text-[var(--success)] shrink-0" />}
                </button>
              );
            })}
          </div>

          <div className="panel p-4 space-y-4">
            <div className="space-y-1">
              <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">
                Step {i + 1} of {SETUP_STEPS.length}
              </p>
              <h2 className="text-sm font-semibold">{step.title}</h2>
              <p className="text-small">{step.blurb}</p>
              {step.note && (
                <p className="text-xs mt-1" style={{ color: 'var(--warning)' }}>{step.note}</p>
              )}
            </div>

            <div className="space-y-3">
              {step.fields.map((f) => (
                <label key={f.key} className="block space-y-1">
                  <span className="text-xs font-medium">{f.label}</span>
                  {f.long ? (
                    <textarea
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      className="input text-sm"
                      rows={2}
                      aria-label={f.label}
                    />
                  ) : (
                    <input
                      value={values[f.key] ?? ''}
                      onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                      placeholder={f.placeholder}
                      className="input text-sm"
                      aria-label={f.label}
                    />
                  )}
                </label>
              ))}
            </div>

            {error && (
              <div className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle size={13} /> {error}
              </div>
            )}

            <div className="flex items-center gap-2 pt-1">
              <button
                className="btn btn-ghost btn-sm"
                onClick={() => jump(Math.max(0, i - 1))}
                disabled={i === 0 || saving}
              >
                <ArrowLeft size={13} /> Back
              </button>
              {!done ? (
                <button className="btn btn-primary btn-sm" onClick={next} disabled={saving}>
                  {saving ? 'Saving…' : <>Save and continue <ArrowRight size={13} /></>}
                </button>
              ) : (
                <button className="btn btn-primary btn-sm" onClick={() => saveStep(step)} disabled={saving}>
                  {saving ? 'Saving…' : <><Check size={13} /> Save</>}
                </button>
              )}
              <span className="ml-auto text-[11px] text-muted-foreground">
                {savedAt ? `Saved ${savedAt}` : 'Saved per step'}
              </span>
            </div>
          </div>
        </div>
      )}

      {!loading && progress.pct === 100 && (
        <div className="panel p-4 flex items-center justify-between gap-3">
          <div className="space-y-0.5">
            <p className="text-sm font-medium flex items-center gap-1.5">
              <Sparkles size={13} className="text-[var(--primary)]" /> That&apos;s everything
            </p>
            <p className="text-small">
              Your agents now know who you are, what the business does and what they may decide alone.
            </p>
          </div>
          <Link href="/founder" className="btn btn-ghost btn-sm shrink-0">
            Review profile <ArrowRight size={12} />
          </Link>
        </div>
      )}
    </div>
  );
}
