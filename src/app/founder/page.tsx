'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { UserRound, Save, Check, AlertCircle, ShieldAlert, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';
import { FOUNDER_FIELDS, type FounderAnswers } from '@/lib/founder-profile-catalog';

// Founder Profile (North Star §12) — the person, where the company playbook covers the
// business. What's typed here is prepended VERBATIM to every agent's system prompt and
// the orchestrator's, so the page says so plainly: an assistant filling this in should
// know they're programming the AI team, not filling in a form nobody reads.
//
// The field catalog is imported from founder-profile-CATALOG, never founder-profile:
// the latter pulls in the DB client and would drag the Postgres driver into the browser
// bundle. Same split (and same reason) as command-center-catalog vs command-center-views.

interface Completeness {
  filled: number; total: number;
  essentialsFilled: number; essentialsTotal: number;
  ready: boolean;
}

const GROUPS = ['How they work', 'Boundaries', 'Context', 'Preferences'] as const;

const GROUP_BLURB: Record<(typeof GROUPS)[number], string> = {
  'How they work': 'The basics an assistant needs on day one.',
  'Boundaries': 'The expensive ones to get wrong. Agents treat these as binding.',
  'Context': "Who and what matters — so nothing important gets treated as routine.",
  'Preferences': 'The details that make support feel personal rather than generic.',
};

export default function FounderProfilePage() {
  const [answers, setAnswers] = useState<FounderAnswers>({});
  const [saved, setSaved] = useState<FounderAnswers>({});
  const [stats, setStats] = useState<Completeness | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/founder');
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const a = (data.answers ?? {}) as FounderAnswers;
      setAnswers(a);
      setSaved(a);
      setStats(data.completeness ?? null);
      setUpdatedAt(data.updated_at ?? null);
    } catch {
      setError("Couldn't load the profile. Refresh to try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(
    () => JSON.stringify(answers) !== JSON.stringify(saved),
    [answers, saved],
  );

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/founder', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const d = await res.json().catch(() => ({}));
        throw new Error(d.error || 'Could not save');
      }
      const data = await res.json();
      const a = (data.answers ?? {}) as FounderAnswers;
      setSaved(a);
      setStats(data.completeness ?? null);
      setUpdatedAt(data.updated_at ?? null);
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const pct = stats ? Math.round((stats.filled / stats.total) * 100) : 0;

  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<UserRound size={20} />}
        title="Founder Profile"
        subtitle="How this founder works — read by every agent before it does anything."
        actions={
          <button className="btn btn-primary btn-sm" onClick={save} disabled={saving || !dirty}>
            {justSaved ? <><Check size={13} /> Saved</> : <><Save size={13} /> {saving ? 'Saving…' : 'Save'}</>}
          </button>
        }
      />

      <Explainer
        id="founder-profile-intro"
        title="Why this matters more than it looks"
        what="Everything you write here is given to every AI agent and the orchestrator before they do any work — so they answer as if they know the founder, not a stranger."
        when="Fill it in during onboarding, then add to it every time you learn something new about how they like things done."
        example="“Never book meetings before 9am.” “Approve anything under $500 without asking.” “Always confirm travel by text, not email.”"
        say={<>&ldquo;Add to my profile: never book anything before 9am.&rdquo;</>}
      />

      {stats && (
        <div className="panel p-3 space-y-2">
          <div className="flex items-center justify-between gap-3 text-xs">
            <span className="font-medium">
              {stats.ready
                ? 'Ready — agents have what they need'
                : `${stats.essentialsTotal - stats.essentialsFilled} essential ${stats.essentialsTotal - stats.essentialsFilled === 1 ? 'field' : 'fields'} left`}
            </span>
            <span className="text-muted-foreground">{stats.filled} of {stats.total} filled · {pct}%</span>
          </div>
          <div className="h-1.5 rounded-full bg-[var(--surface-3)] overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${pct}%`,
                background: stats.ready ? 'var(--success)' : 'var(--warning)',
              }}
            />
          </div>
          {updatedAt && (
            <p className="text-[11px] text-muted-foreground">
              Last updated {new Date(updatedAt).toLocaleDateString(undefined, {
                month: 'short', day: 'numeric', year: 'numeric',
              })}
            </p>
          )}
        </div>
      )}

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">Loading…</div>
      ) : (
        GROUPS.map((group) => {
          const fields = FOUNDER_FIELDS.filter((f) => f.group === group);
          const isBoundaries = group === 'Boundaries';
          return (
            <div key={group} className="panel p-4 space-y-3">
              <div className="space-y-0.5">
                <h2 className="text-sm font-semibold flex items-center gap-1.5">
                  {isBoundaries && <ShieldAlert size={14} className="text-[var(--warning)]" />}
                  {group}
                </h2>
                <p className="text-xs text-muted-foreground">{GROUP_BLURB[group]}</p>
              </div>
              <div className="space-y-3">
                {fields.map((f) => {
                  const val = answers[f.key] ?? '';
                  return (
                    <label key={f.key} className="block space-y-1">
                      <span className="text-xs font-medium flex items-center gap-1.5">
                        {f.label}
                        {f.essential && !val && (
                          <span className="badge badge-warning">needed</span>
                        )}
                      </span>
                      <textarea
                        value={val}
                        onChange={(e) => setAnswers({ ...answers, [f.key]: e.target.value })}
                        placeholder={f.placeholder}
                        className="input text-sm"
                        rows={2}
                        aria-label={f.label}
                      />
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })
      )}

      {dirty && !loading && (
        <div className="panel p-3 flex items-center justify-between gap-3">
          <span className="text-xs text-muted-foreground inline-flex items-center gap-1.5">
            <Sparkles size={12} /> Unsaved changes — agents keep using the last saved version until you save.
          </span>
          <button className="btn btn-primary btn-sm shrink-0" onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}
    </div>
  );
}
