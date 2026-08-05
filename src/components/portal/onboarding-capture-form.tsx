'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Save, Check, ClipboardList, AlertTriangle } from 'lucide-react';
import {
  CAPTURE_FIELDS, CAPTURE_SECTIONS, SECTION_BLURB,
} from '@/lib/onboarding-capture-catalog';

// What Client Success fills in DURING the onboarding call.
//
// Imports the catalog, never onboarding-capture.ts — that pulls in the DB client and
// would land the Postgres driver in the browser bundle.
//
// The label on every field is the question to ASK, not the name of the database column,
// because this is filled in while talking to a person. Saving merges, so a call can be
// left half-done and picked up later without wiping what was already captured.

interface Capture {
  founder: Record<string, string>;
  playbook: Record<string, string>;
  captured_by: string | null;
  captured_at: string | null;
  filled: number; total: number;
  essentialsFilled: number; essentialsTotal: number;
}

export function OnboardingCaptureForm({
  tenant,
  capture,
  onSaved,
}: {
  tenant: string;
  capture: Capture | null;
  onSaved: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reload whenever the operator switches workspace, so one client's answers can never
  // be shown against another's name.
  useEffect(() => {
    const next: Record<string, string> = {};
    for (const f of CAPTURE_FIELDS) {
      const store = f.store === 'founder' ? capture?.founder : capture?.playbook;
      next[f.key] = String(store?.[f.key] ?? '');
    }
    setValues(next);
    setSaved(false);
  }, [tenant, capture]);

  const set = useCallback((k: string, v: string) => {
    setValues(prev => ({ ...prev, [k]: v }));
    setSaved(false);
  }, []);

  const missingEssentials = useMemo(
    () => CAPTURE_FIELDS.filter(f => f.essential && !values[f.key]?.trim()),
    [values],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const founder: Record<string, string> = {};
      const playbook: Record<string, string> = {};
      for (const f of CAPTURE_FIELDS) {
        const v = values[f.key]?.trim();
        if (!v) continue;
        if (f.store === 'founder') founder[f.key] = v;
        else playbook[f.key] = v;
      }
      const res = await fetch('/api/portal/admin', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'capture', tenant, founder, playbook }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? 'Save failed');
      setSaved(true);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel p-4 space-y-4">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <p className="text-sm font-semibold flex items-center gap-1.5">
            <ClipboardList size={14} className="text-[var(--primary)]" /> The onboarding call
          </p>
          <p className="text-xs text-muted-foreground max-w-prose">
            Fill this in while you talk. It writes the founder profile and the company
            playbook, so on day one they check it rather than starting from nothing.
          </p>
          {capture?.captured_at && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Last captured {new Date(capture.captured_at).toLocaleString()}
              {capture.captured_by && ` by ${capture.captured_by}`}
            </p>
          )}
        </div>
        <button
          onClick={save} disabled={saving}
          className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white disabled:opacity-40"
          style={{ background: 'var(--primary)' }}
        >
          {saving ? <Loader2 size={12} className="animate-spin" />
            : saved ? <Check size={12} /> : <Save size={12} />}
          {saved ? 'Saved' : 'Save'}
        </button>
      </div>

      {error && (
        <p className="text-xs flex items-center gap-1.5" style={{ color: 'var(--destructive)' }}>
          <AlertTriangle size={12} /> {error}
        </p>
      )}

      {/* The essentials are what agents behave badly without, so what's still missing is
          named rather than left as a percentage to interpret. */}
      {missingEssentials.length > 0 && (
        <p className="text-xs" style={{ color: 'var(--warning)' }}>
          Still needed: {missingEssentials.map(f => f.label.toLowerCase()).join(', ')}
        </p>
      )}

      {CAPTURE_SECTIONS.map(section => {
        const fields = CAPTURE_FIELDS.filter(f => f.section === section);
        return (
          <div key={section} className="space-y-2">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{section}</p>
              <p className="text-[11px] text-muted-foreground">{SECTION_BLURB[section]}</p>
            </div>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {fields.map(f => (
                <label key={f.key} className={f.long ? 'sm:col-span-2' : ''}>
                  <span className="text-xs font-medium">
                    {f.label}
                    {f.essential && <span style={{ color: 'var(--warning)' }}> *</span>}
                  </span>
                  <span className="block text-[11px] text-muted-foreground mb-1">{f.ask}</span>
                  {f.long ? (
                    <textarea
                      rows={2} value={values[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="w-full text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
                    />
                  ) : (
                    <input
                      value={values[f.key] ?? ''}
                      onChange={(e) => set(f.key, e.target.value)}
                      className="w-full text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
                    />
                  )}
                </label>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
