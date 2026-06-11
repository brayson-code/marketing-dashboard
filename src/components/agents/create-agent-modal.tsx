'use client';

import { useState } from 'react';
import { Plus, X, Wand2, Loader2, Sparkles, ArrowLeft } from 'lucide-react';

const MODELS: Array<[string, string]> = [
  ['claude-fable-5', 'Fable 5 — most powerful (premium)'],
  ['claude-opus-4-8', 'Opus 4.8 — most capable'],
  ['claude-sonnet-4-6', 'Sonnet 4.6 — balanced'],
  ['claude-haiku-4-5-20251001', 'Haiku 4.5 — fast & cheap'],
];

// Create-agent flow with the playbook BUILT IN. Pick a common template (or start
// custom), the questionnaire pre-fills, then "Create" provisions the agent AND
// generates its soul/agent/skills in one go — so a new agent is well-defined out of
// the box, not an empty shell. Replaces the old bare id/name/role form.

export type AgentRole = 'research' | 'content' | 'outreach' | 'scheduler' | 'creative' | 'general' | 'orchestrator';
const ROLES: AgentRole[] = ['research', 'content', 'outreach', 'scheduler', 'creative', 'general'];

interface Answers { job: string; output: string; inputs: string; guardrails: string; tactics: string }
const EMPTY: Answers = { job: '', output: '', inputs: '', guardrails: '', tactics: '' };

interface Template {
  key: string; emoji: string; name: string; role: AgentRole; suggestedId: string; description: string; answers: Answers;
}

// Common agent archetypes. Picking one pre-fills the form + questionnaire; the user
// tweaks, then generates. Kept broad on purpose — they fit most marketing teams.
const TEMPLATES: Template[] = [
  {
    key: 'lead-enricher', emoji: '🔎', name: 'Lead Enricher', role: 'research', suggestedId: 'lead-enricher',
    description: 'Researches inbound leads and writes a tight, personalized brief for outreach.',
    answers: {
      job: 'Enrich an inbound lead: find their company, size, role, and a relevant, timely hook for outreach.',
      output: 'A 3-line brief per lead — (1) who they are, (2) why now, (3) a personalized opener line. No filler.',
      inputs: 'A name, company, and/or email, plus public web data (site, LinkedIn, recent news).',
      guardrails: 'Never guess or fabricate facts — mark anything unverified. No scraping gated/paywalled sources.',
      tactics: 'Check company site → LinkedIn → recent news/funding, in that order. Prefer specifics over adjectives.',
    },
  },
  {
    key: 'email-outreach', emoji: '✉️', name: 'Email Outreach Writer', role: 'outreach', suggestedId: 'email-outreach',
    description: 'Drafts short, personalized cold/warm outreach emails that get replies.',
    answers: {
      job: 'Write a short outreach email to a specific prospect that earns a reply.',
      output: 'Under 90 words. A specific personalized first line, one clear value point, one soft CTA (a 15-min call). Plain text, no hype.',
      inputs: 'The prospect brief (from the lead enricher) + our offer.',
      guardrails: 'No spammy words, no fake personalization, no multi-paragraph pitches. One ask only.',
      tactics: 'Open with something true about THEM, not us. Lead with the outcome. End with a low-friction yes/no question.',
    },
  },
  {
    key: 'reel-analyst', emoji: '🎬', name: 'Reel Analyst', role: 'creative', suggestedId: 'reel-analyst',
    description: 'Tears down a short-form video and extracts what made it work.',
    answers: {
      job: 'Analyze a short-form video (Reel/TikTok/Short) and extract the repeatable structure behind its performance.',
      output: 'Hook (first 2s), retention beats, payoff, and CTA — plus a 1-paragraph "how to apply this to us" note.',
      inputs: 'A video URL or a transcript + basic metrics.',
      guardrails: 'Describe what is actually in the video; do not invent metrics. Keep takeaways concrete and reusable.',
      tactics: 'Break it into hook → setup → payoff → CTA. Note pattern interrupts and on-screen text cadence.',
    },
  },
  {
    key: 'content-writer', emoji: '✍️', name: 'Content Writer', role: 'content', suggestedId: 'content-writer',
    description: 'Writes on-brand social posts and short content in your voice.',
    answers: {
      job: 'Write on-brand social posts (LinkedIn/X) that match our voice and push our objective.',
      output: '2-3 distinct post options, each under 280 chars, one clear idea each. No emoji unless natural, no hashtag stuffing.',
      inputs: 'A topic or angle + the company brief.',
      guardrails: 'Stay in our voice. No unverified stats. No engagement-bait or clickbait.',
      tactics: 'One idea per post. Strong first line. Concrete over clever. Vary the angle across options.',
    },
  },
  {
    key: 'competitor-watch', emoji: '🛰️', name: 'Competitor Watcher', role: 'research', suggestedId: 'competitor-watcher',
    description: 'Monitors competitors and surfaces what changed and why it matters.',
    answers: {
      job: 'Track named competitors and surface meaningful moves (launches, pricing, messaging, content).',
      output: 'A short digest: what changed, the source/date, and a one-line "what it means for us".',
      inputs: 'A list of competitor names/sites/social handles.',
      guardrails: 'Only report verifiable, dated changes with a source. No speculation presented as fact.',
      tactics: 'Diff against last known state. Prioritize pricing + positioning + GTM motions over vanity.',
    },
  },
  {
    key: 'seo-researcher', emoji: '📈', name: 'SEO Researcher', role: 'research', suggestedId: 'seo-researcher',
    description: 'Finds keyword + topic opportunities with search intent.',
    answers: {
      job: 'Find keyword and topic opportunities we can realistically rank for, with intent.',
      output: 'A ranked list: keyword, rough intent, why we can win, and the angle/format to use.',
      inputs: 'Our topic area + target audience.',
      guardrails: 'No invented search volumes — flag estimates as estimates. Favor intent over raw volume.',
      tactics: 'Cluster by intent (informational/commercial). Look for low-competition long-tail with buyer intent.',
    },
  },
];

export function CreateAgentModal({
  onClose, onCreated,
}: {
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  const [step, setStep] = useState<'pick' | 'form'>('pick');
  const [id, setId] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState<AgentRole>('general');
  const [model, setModel] = useState('claude-sonnet-4-6');
  const [description, setDescription] = useState('');
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [stage, setStage] = useState<string>('');
  const [error, setError] = useState<string | null>(null);

  const slugify = (s: string) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const idValid = id === '' || SLUG_RE.test(id);

  function chooseTemplate(t: Template) {
    setName(t.name); setRole(t.role); setId(t.suggestedId); setDescription(t.description); setAnswers(t.answers);
    setStep('form');
  }
  function startCustom() {
    setAnswers(EMPTY); setName(''); setId(''); setRole('general'); setDescription('');
    setStep('form');
  }

  async function create() {
    const slug = id.trim() || slugify(name);
    if (!slug || !name.trim()) { setError('Name (and a slug id) are required.'); return; }
    if (!SLUG_RE.test(slug)) { setError('ID must be lowercase letters, digits, and hyphens.'); return; }
    setBusy(true); setError(null);
    try {
      // 1) Create the agent shell.
      setStage('Creating agent…');
      const cr = await fetch('/api/agents/defs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: slug, name: name.trim(), role, model, max_tokens: 8000, rate_per_hour: 0, description, soul: '', agent_md: '', skills: '', spawnable: true }),
      });
      const cj = await cr.json().catch(() => ({}));
      if (!cr.ok) throw new Error(cj.error || (cr.status === 409 ? `Agent "${slug}" already exists` : 'Create failed'));

      // 2) If the questionnaire has a job, generate + save the full definition.
      if (answers.job.trim()) {
        setStage('Writing its playbook…');
        const gr = await fetch(`/api/agents/defs/${encodeURIComponent(slug)}/generate`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers, name: name.trim(), role }),
        });
        const gj = await gr.json();
        if (gr.ok) {
          setStage('Saving…');
          await fetch(`/api/agents/defs/${encodeURIComponent(slug)}`, {
            method: 'PUT', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              name: name.trim(), role, model, description: gj.description || description,
              soul: gj.soul, agent_md: gj.agent_md, skills: gj.skills, spawnable: true, enabled: true,
            }),
          });
        }
        // If generation failed, the shell still exists — the user can generate from the editor.
      }
      onCreated(slug);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); setStage(''); }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <div className="panel modal-surface w-full max-w-2xl animate-in max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header flex items-center justify-between">
          <div className="text-sm font-medium flex items-center gap-2">
            {step === 'form' && <button className="btn btn-ghost btn-xs" onClick={() => !busy && setStep('pick')} aria-label="Back"><ArrowLeft size={14} /></button>}
            <Plus size={14} className="text-primary" /> New agent
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} disabled={busy} aria-label="Close"><X size={14} /></button>
        </div>

        {step === 'pick' ? (
          <div className="panel-body space-y-3 overflow-y-auto">
            <p className="text-xs text-muted-foreground">Start from a common agent — we&apos;ll pre-fill the questions — or build your own. Either way, you answer a few questions and we write its playbook.</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {TEMPLATES.map((t) => (
                <button key={t.key} onClick={() => chooseTemplate(t)}
                  className="text-left rounded-lg border border-border/60 p-3 hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] hover:bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] transition-colors">
                  <div className="flex items-center gap-2"><span className="text-base">{t.emoji}</span><span className="text-sm font-medium">{t.name}</span></div>
                  <div className="text-[11px] text-muted-foreground mt-1">{t.description}</div>
                </button>
              ))}
              <button onClick={startCustom}
                className="text-left rounded-lg border border-dashed border-border/70 p-3 hover:border-[color-mix(in_srgb,var(--primary)_45%,var(--border))] transition-colors">
                <div className="flex items-center gap-2"><Wand2 size={15} className="text-primary" /><span className="text-sm font-medium">Custom agent</span></div>
                <div className="text-[11px] text-muted-foreground mt-1">Describe your own from scratch.</div>
              </button>
            </div>
          </div>
        ) : (
          <div className="panel-body space-y-3 overflow-y-auto">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Name</span>
                <input className="input text-sm w-full" value={name} onChange={(e) => { setName(e.target.value); if (!id) setId(slugify(e.target.value)); }} placeholder="Lead Enricher" autoFocus />
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">ID (slug)</span>
                <input className="input text-sm font-mono w-full" value={id} onChange={(e) => setId(e.target.value)} placeholder="lead-enricher" />
                {!idValid && <span className="text-[10px] text-destructive">lowercase letters, digits, hyphens</span>}
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Role</span>
                <select className="input text-sm w-full" value={role} onChange={(e) => setRole(e.target.value as AgentRole)}>
                  {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </label>
              <label className="space-y-1">
                <span className="text-xs text-muted-foreground">Model</span>
                <select className="input text-sm font-mono w-full" value={model} onChange={(e) => setModel(e.target.value)}>
                  {MODELS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              </label>
            </div>

            <div className="pt-1 text-[11px] uppercase tracking-wider text-muted-foreground font-semibold flex items-center gap-1.5"><Sparkles size={12} className="text-primary" /> Its playbook</div>
            {([
              ['job', 'What is this agent’s job?'],
              ['output', 'What does a great result look like?'],
              ['inputs', 'What does it work from?'],
              ['guardrails', 'Hard rules / never-dos'],
              ['tactics', 'Tactics or steps (optional)'],
            ] as Array<[keyof Answers, string]>).map(([k, label]) => (
              <label key={k} className="block space-y-1">
                <span className="text-xs font-medium">{label}{k === 'job' && <span className="text-destructive"> *</span>}</span>
                <textarea className="input text-sm w-full" rows={2} value={answers[k]} onChange={(e) => setAnswers((a) => ({ ...a, [k]: e.target.value }))} />
              </label>
            ))}
            {error && <p className="text-xs text-destructive">{error}</p>}
          </div>
        )}

        {step === 'form' && (
          <div className="flex items-center justify-between gap-2 px-5 py-3 border-t border-border/40">
            <span className="text-[11px] text-muted-foreground">{busy ? stage : answers.job.trim() ? 'Creates the agent + writes its playbook' : 'Creates a blank agent you can define'}</span>
            <div className="flex items-center gap-2">
              <button type="button" className="btn btn-ghost btn-sm text-xs" onClick={onClose} disabled={busy}>Cancel</button>
              <button type="button" className="btn btn-primary btn-sm text-xs" onClick={create} disabled={busy || !name.trim() || !idValid}>
                {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? stage || 'Working…' : answers.job.trim() ? 'Create + generate' : 'Create agent'}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
