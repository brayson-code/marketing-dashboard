'use client';

import { useState } from 'react';
import { Wand2, Loader2, X, Sparkles } from 'lucide-react';

// Per-agent playbook wizard. A short questionnaire about THIS agent's objectives →
// generates its soul/agent/skills definition (the markdown that controls how it
// runs). On success it hands the generated fields back to the Agent Studio editor,
// which populates them UNSAVED so the owner reviews + tunes before Save.

export interface GeneratedDef { description: string; soul: string; agent_md: string; skills: string }

interface Answers { job: string; output: string; inputs: string; guardrails: string; tactics: string }
const EMPTY: Answers = { job: '', output: '', inputs: '', guardrails: '', tactics: '' };

const FIELDS: Array<{ key: keyof Answers; label: string; placeholder: string; required?: boolean }> = [
  { key: 'job', label: 'What is this agent’s job?', placeholder: 'e.g. Enrich inbound leads — find company size, role, and a relevant hook for outreach.', required: true },
  { key: 'output', label: 'What does an excellent result look like?', placeholder: 'e.g. A 3-line brief per lead: who they are, why now, and a personalized opener. No fluff.' },
  { key: 'inputs', label: 'What does it work from?', placeholder: 'e.g. A name + company + email, plus public web data.' },
  { key: 'guardrails', label: 'Hard rules / never-dos', placeholder: 'e.g. Never guess facts; mark anything unverified. No scraping gated sites.' },
  { key: 'tactics', label: 'Tactics or steps it should follow (optional)', placeholder: 'e.g. Check LinkedIn → company site → recent news, in that order.' },
];

export function AgentPlaybookWizard({
  agentId, agentName, role, onClose, onGenerated,
}: {
  agentId: string;
  agentName: string;
  role: string;
  onClose: () => void;
  onGenerated: (def: GeneratedDef) => void;
}) {
  const [answers, setAnswers] = useState<Answers>(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function generate() {
    if (!answers.job.trim()) { setError('Describe the agent’s core job first.'); return; }
    setBusy(true); setError(null);
    try {
      const r = await fetch(`/api/agents/defs/${encodeURIComponent(agentId)}/generate`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answers, name: agentName, role }),
      });
      const j = await r.json();
      if (!r.ok) { setError(j.error || 'Generation failed'); return; }
      onGenerated(j as GeneratedDef);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  }

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-background/70 backdrop-blur-sm p-4" onClick={() => !busy && onClose()}>
      <div className="panel w-full max-w-xl animate-in max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="panel-header flex items-center justify-between">
          <div className="text-sm font-medium flex items-center gap-2">
            <Wand2 size={14} className="text-primary" /> Generate playbook — {agentName}
          </div>
          <button type="button" className="btn btn-ghost btn-xs" onClick={onClose} disabled={busy} aria-label="Close"><X size={14} /></button>
        </div>

        <div className="panel-body space-y-3 overflow-y-auto">
          <p className="text-xs text-muted-foreground">
            Answer a few questions about what <span className="font-medium">{agentName}</span> should do. We&apos;ll write its
            soul / operating instructions / skills — then you review and tune them before saving.
          </p>
          {FIELDS.map((f) => (
            <label key={f.key} className="block space-y-1">
              <span className="text-xs font-medium">{f.label}{f.required && <span className="text-destructive"> *</span>}</span>
              <textarea
                className="input text-sm w-full"
                rows={2}
                placeholder={f.placeholder}
                value={answers[f.key]}
                onChange={(e) => setAnswers((a) => ({ ...a, [f.key]: e.target.value }))}
              />
            </label>
          ))}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border/40">
          <button type="button" className="btn btn-ghost btn-sm text-xs" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary btn-sm text-xs" onClick={generate} disabled={busy || !answers.job.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />} {busy ? 'Generating…' : 'Generate definition'}
          </button>
        </div>
      </div>
    </div>
  );
}
