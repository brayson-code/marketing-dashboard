'use client';

import { useCallback, useEffect, useState } from 'react';
import { BookText, Sparkles, Loader2, Save, Pencil, Check } from 'lucide-react';

// Company Playbook — a short questionnaire that generates the business context every
// agent runs with (objectives, ICP, voice, guardrails). Lives on Memory: it IS the
// agents' working memory of the business. Generated on the tenant's own Claude key;
// saved onto the workspace and injected into every agent + the orchestrator prompt.

interface Answers {
  business: string; objective: string; audience: string; value: string;
  channels: string; voice: string; constraints: string;
}
const EMPTY: Answers = { business: '', objective: '', audience: '', value: '', channels: '', voice: '', constraints: '' };

const QUESTIONS: Array<{ key: keyof Answers; label: string; placeholder: string }> = [
  { key: 'business', label: 'What does your company do?', placeholder: 'e.g. We run paid + organic social for B2B SaaS startups.' },
  { key: 'objective', label: 'Your #1 objective right now', placeholder: 'e.g. Book 30 qualified demos/month from LinkedIn by Q3.' },
  { key: 'audience', label: 'Who is your ideal customer?', placeholder: 'e.g. Seed–Series A SaaS founders, 5–50 staff, no in-house marketer.' },
  { key: 'value', label: 'Why do customers pick you?', placeholder: 'e.g. We ship content in 48h and report on pipeline, not vanity metrics.' },
  { key: 'channels', label: 'Primary channels', placeholder: 'e.g. LinkedIn, X, a weekly newsletter, cold email.' },
  { key: 'voice', label: 'Brand voice / tone', placeholder: 'e.g. Direct, a little contrarian, no hype words, no emoji in posts.' },
  { key: 'constraints', label: 'Hard no-gos', placeholder: 'e.g. Never name client logos, no political takes, no unverified stats.' },
];

export function PlaybookCard() {
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<'quiz' | 'result'>('quiz');
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [markdown, setMarkdown] = useState('');
  const [busy, setBusy] = useState(false);
  const [savedTick, setSavedTick] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/playbook', { cache: 'no-store' });
      if (r.ok) {
        const j = await r.json();
        if (j.markdown) { setMarkdown(j.markdown); setView('result'); }
        if (j.answers) setAnswers({ ...EMPTY, ...j.answers });
      }
    } finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const filledCount = QUESTIONS.filter((q) => answers[q.key].trim()).length;

  async function generate() {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/playbook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, save: true }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Generation failed'); return; }
      setMarkdown(j.markdown); setView('result');
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  async function save() {
    setBusy(true); setError(null);
    try {
      const r = await fetch('/api/playbook', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, answers }),
      });
      if (!r.ok) { const j = await r.json().catch(() => ({})); setError(j.error || 'Save failed'); return; }
      setSavedTick(true); window.setTimeout(() => setSavedTick(false), 1600);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="panel" data-walkthrough="company-playbook">
      <div className="panel-header flex items-center justify-between">
        <div className="section-title flex items-center gap-1.5">
          <BookText size={14} className="text-primary" /> Company brief
        </div>
        {view === 'result' && (
          <button className="btn btn-ghost btn-sm" onClick={() => setView('quiz')} title="Edit answers & regenerate">
            <Pencil size={12} /> Edit answers
          </button>
        )}
      </div>
      <div className="panel-body space-y-3">
        <p className="text-xs text-muted-foreground">
          The shared context <em>every</em> agent reads before doing any work — so the whole team understands your
          company, sounds like you, and pushes your real objective. (Tune each agent&apos;s own playbook in Agent Studio.)
        </p>

        {loading ? (
          <p className="text-xs text-muted-foreground">Loading…</p>
        ) : view === 'quiz' ? (
          <>
            <div className="space-y-2.5">
              {QUESTIONS.map((q) => (
                <div key={q.key} className="space-y-1">
                  <label className="text-[11px] font-medium">{q.label}</label>
                  <textarea
                    className="w-full input text-sm"
                    rows={2}
                    placeholder={q.placeholder}
                    value={answers[q.key]}
                    onChange={(e) => setAnswers((a) => ({ ...a, [q.key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <button className="btn btn-primary btn-sm" disabled={busy || filledCount === 0} onClick={generate}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Generate playbook
              </button>
              <span className="text-[11px] text-muted-foreground">{filledCount}/{QUESTIONS.length} answered</span>
            </div>
          </>
        ) : (
          <>
            <div className="text-[11px] text-muted-foreground flex items-center gap-1.5">
              <Check size={12} className="text-[var(--success)]" /> Every agent + the orchestrator now reads this.
            </div>
            <textarea
              className="w-full input text-[13px] font-mono leading-relaxed"
              rows={16}
              value={markdown}
              onChange={(e) => setMarkdown(e.target.value)}
              spellCheck={false}
            />
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex items-center gap-2">
              <button className="btn btn-primary btn-sm" disabled={busy} onClick={save}>
                {savedTick ? <><Check size={13} /> Saved</> : busy ? <Loader2 size={13} className="animate-spin" /> : <><Save size={13} /> Save edits</>}
              </button>
              <button className="btn btn-ghost btn-sm" disabled={busy} onClick={generate}>
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />} Regenerate
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default PlaybookCard;
