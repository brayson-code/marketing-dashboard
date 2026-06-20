'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import {
  PhoneCall, Download, Plug, Settings2, History, Copy, Check, Trash2,
  KeyRound, ExternalLink, AlertCircle, Sparkles, Wand2, ArrowLeft, Plus, X,
  BookOpen, CheckCircle2, PenLine, FlaskConical, Instagram, Youtube, FileText,
  Loader2, Quote, ArrowRight, RefreshCw, Clock,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';

// SalesOps — re-host of the PIF AI Sales Co-Pilot Chrome extension as a multi-tenant
// Command Center feature. This page is the OWNER/MEMBER control surface:
//   • Playbook Studio — the ONE place you create the playbook (AI-drafted or by hand).
//                       The active playbook is what the live co-pilot reads.
//   • Install         — download the packaged extension + load-unpacked steps
//   • Connect         — mint a per-tenant SalesOps token and push it to the extension
//   • Call settings   — how the co-pilot BEHAVES (cadence + CRM summary). NOT playbook
//                       content — that lives in Playbook Studio, so there's no duplication.
//   • Recent calls    — recorded calls + their CRM summaries
//
// The page itself is flag-gated (the nav item only shows when SALESOPS_ENABLED is true,
// and every /api/salesops-admin/* route returns 404 when the flag is off). Token gen and
// config writes go through SESSION-authed, owner|member-gated, tenant-scoped admin routes.

// Deterministic ID of the packaged extension (derived from the manifest "key"). The
// SalesOps page uses it to hand the freshly-minted token directly to the installed
// extension via chrome.runtime.sendMessage — no copy/paste needed when it works.
const EXTENSION_ID = 'maaajmcpggkooiocbfjdneccijejicaf';

// ── types ──────────────────────────────────────────────────────────────────────
interface TokenRow {
  id: string;
  label: string | null;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface SalesopsConfig {
  persona: string | null;
  playbook: string | null;
  company_name: string | null;
  product_name: string | null;
  pricing: string | null;
  differentiators: string | null;
  objection_keywords: string[];
  suggestion_interval_ms: number;
  summary_enabled: boolean;
  summary_fields: string[];
}

interface SalesCall {
  id: string;
  started_at: string;
  ended_at: string | null;
  platform: string | null;
  contact_name: string | null;
  contact_email: string | null;
  lead_id: string | null;
  summary: string | null;
  deal_temp: string | null;
  suggestions_count: number;
}

// ── Playbook Studio types (mirror src/lib/salesops/playbook-gen.ts) ──────────────
// The guided wizard's Q&A answers.
interface PlaybookAnswers {
  company_name: string;
  product_name: string;
  buyer_persona: string;
  pricing: string;
  differentiators: string;
  sales_motion: string;
  methodology: string;
  common_objections: string;
  desired_tone: string;
  call_goal: string;
}

interface ObjectionScript { objection: string; response: string }

// The structured playbook Claude returns / the owner reviews + edits before Apply.
interface PlaybookContent {
  persona: string;
  company_name: string;
  product_name: string;
  pricing: string;
  differentiators: string;
  objection_keywords: string[];
  opener: string;
  discovery_questions: string[];
  value_props: string[];
  objection_handling: ObjectionScript[];
  closing: string;
  playbook_narrative: string;
}

// A row from GET /api/salesops-admin/playbook (list / future split-test UX).
interface PlaybookListItem {
  id: string;
  name: string;
  is_active: boolean;
  source: string;
  calls_count: number;
  won_count: number;
  created_at: string;
}

// ── Reanalyze (Playbook Phase 2) types — mirror src/lib/salesops/{sources,reanalyze}.ts ──
// Declared locally (the page is a client component; don't import server-only modules).
type SourceKind = 'won_call' | 'instagram' | 'youtube' | 'manual';
type SourceStatus = 'pending' | 'extracted' | 'error';

// A row of salesops_playbook_sources as GET /sources returns it.
interface SourceRecord {
  id: string;
  kind: SourceKind;
  label: string | null;
  ref: string | null;
  niche: string | null;
  status: SourceStatus;
  content: string | null;
  error: string | null;
  created_at: string;
}

type ChangeOp = 'replace' | 'append';
type ChangeConfidence = 'high' | 'medium' | 'low';

interface ChangeCitation {
  source_id: string;
  source_label: string;
  quote: string;
}

// One proposed change to a single PlaybookContent field. proposed_value's runtime type
// matches that field's kind (string | string[] | ObjectionScript[]).
interface ChangeItem {
  field: keyof PlaybookContent;
  op: ChangeOp;
  current_excerpt: string;
  proposed_value: string | string[] | ObjectionScript[];
  rationale: string;
  confidence: ChangeConfidence;
  pattern_support: string;
  citations: ChangeCitation[];
}

// A salesops_playbook_changesets row as reanalyze POST / changeset GET return it.
interface ChangeSetRecord {
  id: string;
  status: 'pending' | 'applied' | 'discarded';
  summary: string;
  changes: ChangeItem[];
  sources_used: string[];
  base_playbook_id: string | null;
  applied_playbook_id: string | null;
  created_at: string;
}

// chrome.runtime.sendMessage is only present inside an extension page; on a normal web
// page Chrome injects a (very small) chrome.runtime when the page is externally_connectable
// to an installed extension. We feature-detect it and fall back to copy/paste otherwise.
declare global {
  interface Window {
    chrome?: {
      runtime?: {
        sendMessage?: (
          extensionId: string,
          message: unknown,
          callback?: (response: unknown) => void,
        ) => void;
        lastError?: { message?: string };
      };
    };
  }
}

export default function SalesOpsPage() {
  // The Reanalyze surface is gated behind PLAYBOOK_REANALYZE (a SalesOps sub-flag).
  // The page itself is already SALESOPS_ENABLED-gated at the nav level; here we just
  // read the sub-flag off /api/auth/me to hide/show the surface. The routes enforce it.
  const [reanalyzeEnabled, setReanalyzeEnabled] = useState(false);
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setReanalyzeEnabled(!!j?.playbook_reanalyze_enabled))
      .catch(() => setReanalyzeEnabled(false));
  }, []);

  return (
    <div className="space-y-8 animate-in">
      <div className="space-y-1">
        <h1 className="text-h1 flex items-center gap-2">
          <PhoneCall size={18} className="text-primary" /> SalesOps
        </h1>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Real-time AI sales coaching on your video calls. Build a playbook, install the browser extension, connect
          it to this workspace, and review every call here. Transcription and coaching use your own Deepgram and
          Anthropic keys from{' '}
          <Link href="/connections" className="text-primary hover:underline">Connections</Link>.
        </p>
      </div>

      <PlaybookStudioSection />
      {reanalyzeEnabled && <ReanalyzeSection />}
      <InstallSection />
      <ConnectSection />
      <CallSettingsSection />
      <ReviewSection />
    </div>
  );
}

// ── Playbook Studio ──────────────────────────────────────────────────────────────
// The ONE surface for playbook content. Three modes on one section:
//   'home'    — your active playbook + saved versions, and two ways to make a new one
//   'wizard'  — guided Q&A → POST /api/salesops-admin/playbook/generate → review
//   'review'  — editable draft (AI-drafted OR blank/manual) + name →
//               POST /api/salesops-admin/playbook/apply (NON-DESTRUCTIVE: creates a NEW
//               active playbook, never overwrites a prior one)
// Apply mirrors the structured fields into salesops_config, so the live co-pilot uses the
// new playbook immediately — no second form to keep in sync.

const METHODOLOGY_OPTIONS = ['Consultative', 'Challenger', 'SPIN', 'Sandler', 'Solution', 'MEDDIC', 'Other'];

const EMPTY_ANSWERS: PlaybookAnswers = {
  company_name: '', product_name: '', buyer_persona: '', pricing: '', differentiators: '',
  sales_motion: '', methodology: '', common_objections: '', desired_tone: '', call_goal: '',
};

const EMPTY_CONTENT: PlaybookContent = {
  persona: '', company_name: '', product_name: '', pricing: '', differentiators: '',
  objection_keywords: [], opener: '', discovery_questions: [], value_props: [],
  objection_handling: [], closing: '', playbook_narrative: '',
};

/** Coerce a stored/fetched playbook content into a full PlaybookContent for the editor
 *  (fills missing fields + guarantees the array fields are arrays, so the editor can't crash). */
function normalizeForEdit(c: Partial<PlaybookContent> | null | undefined): PlaybookContent {
  const r = c ?? {};
  const arr = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return {
    persona: String(r.persona ?? ''),
    company_name: String(r.company_name ?? ''),
    product_name: String(r.product_name ?? ''),
    pricing: String(r.pricing ?? ''),
    differentiators: String(r.differentiators ?? ''),
    objection_keywords: arr(r.objection_keywords),
    opener: String(r.opener ?? ''),
    discovery_questions: arr(r.discovery_questions),
    value_props: arr(r.value_props),
    objection_handling: Array.isArray(r.objection_handling)
      ? r.objection_handling
          .filter((o): o is ObjectionScript => !!o && typeof o === 'object')
          .map((o) => ({ objection: String(o.objection ?? ''), response: String(o.response ?? '') }))
      : [],
    closing: String(r.closing ?? ''),
    playbook_narrative: String(r.playbook_narrative ?? ''),
  };
}

function PlaybookStudioSection() {
  const [mode, setMode] = useState<'home' | 'wizard' | 'review'>('home');
  const [answers, setAnswers] = useState<PlaybookAnswers>(EMPTY_ANSWERS);
  const [methodologyChoice, setMethodologyChoice] = useState(''); // select value; 'Other' → free text
  const [draft, setDraft] = useState<PlaybookContent | null>(null);
  const [name, setName] = useState('');
  const [generating, setGenerating] = useState(false);
  const [applying, setApplying] = useState(false);
  const [fromWizard, setFromWizard] = useState(false); // review reached via AI wizard vs. manual

  // Saved playbooks (active + history/variants).
  const [playbooks, setPlaybooks] = useState<PlaybookListItem[]>([]);
  const [listLoading, setListLoading] = useState(true);

  const loadList = useCallback(async () => {
    setListLoading(true);
    try {
      const res = await fetch('/api/salesops-admin/playbook', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setPlaybooks(json.playbooks ?? []);
      }
    } finally {
      setListLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  const setAns = (k: keyof PlaybookAnswers, v: string) => setAnswers((a) => ({ ...a, [k]: v }));

  function startGenerate() {
    setAnswers(EMPTY_ANSWERS);
    setMethodologyChoice('');
    setMode('wizard');
  }

  function startManual() {
    setDraft({ ...EMPTY_CONTENT });
    setName('');
    setFromWizard(false);
    setMode('review');
  }

  // View / edit a saved playbook: load its full content into the editor. Applying edits
  // creates a NEW version via the same non-destructive apply path (prior versions kept).
  async function startEdit(id: string) {
    try {
      const res = await fetch(`/api/salesops-admin/playbook/${id}`, { cache: 'no-store' });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.playbook) { toast.error('Could not load that playbook.'); return; }
      setDraft(normalizeForEdit(json.playbook.content));
      setName(json.playbook.name ?? '');
      setFromWizard(false);
      setMode('review');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function generate() {
    if (!answers.company_name.trim() || !answers.product_name.trim() || !answers.buyer_persona.trim()) {
      toast.error('Company, product, and buyer persona are required.');
      return;
    }
    setGenerating(true);
    try {
      const methodology = methodologyChoice === 'Other' ? answers.methodology : methodologyChoice;
      const res = await fetch('/api/salesops-admin/playbook/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...answers, methodology }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'connect_anthropic') {
          toast.error('Connect your Anthropic key in Connections → Anthropic to generate a playbook.');
        } else if (json.error === 'missing_fields') {
          toast.error('Please fill in company, product, and buyer persona.');
        } else {
          toast.error('Could not generate the playbook. Try again.');
        }
        return;
      }
      const d: PlaybookContent = json.draft;
      setDraft(d);
      setName(suggestPlaybookName(answers, methodology)); // sensible default; rep can rename
      setFromWizard(true);
      setMode('review');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setGenerating(false);
    }
  }

  async function apply() {
    if (!draft) return;
    const trimmed = name.trim();
    if (!trimmed) {
      toast.error('Give this playbook a name.');
      return;
    }
    if (!draft.playbook_narrative.trim()) {
      toast.error('The playbook narrative is empty — add some content before applying.');
      return;
    }
    setApplying(true);
    try {
      const res = await fetch('/api/salesops-admin/playbook/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, content: draft, inputs: fromWizard ? answers : {} }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'empty_playbook') toast.error('The playbook narrative is empty.');
        else if (json.error === 'name is required') toast.error('Give this playbook a name.');
        else toast.error('Could not apply the playbook. Try again.');
        return;
      }
      toast.success(`“${trimmed}” is now your active playbook`);
      // Reset back to home and refresh the list (which now shows the new active playbook).
      setAnswers(EMPTY_ANSWERS);
      setMethodologyChoice('');
      setDraft(null);
      setName('');
      setFromWizard(false);
      setMode('home');
      await loadList();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  const activePlaybook = playbooks.find((p) => p.is_active) ?? null;

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <BookOpen size={14} className="text-primary" /> Playbook Studio
        </div>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Your playbook tells the AI how to coach &mdash; what you sell, who you sell to, and how you handle objections.
          Draft one with AI or write it yourself. Applying it makes a new, named version active for your live co-pilot;
          previous versions are kept.
        </p>
      </div>

      {mode === 'home' && (
        <PlaybookHome
          activePlaybook={activePlaybook}
          playbooks={playbooks}
          loading={listLoading}
          onGenerate={startGenerate}
          onManual={startManual}
          onEdit={startEdit}
        />
      )}

      {mode === 'wizard' && (
        <WizardForm
          answers={answers}
          setAns={setAns}
          methodologyChoice={methodologyChoice}
          setMethodologyChoice={setMethodologyChoice}
          generating={generating}
          onGenerate={generate}
          onBack={() => setMode('home')}
        />
      )}

      {mode === 'review' && draft && (
        <ReviewForm
          draft={draft}
          setDraft={setDraft}
          name={name}
          setName={setName}
          applying={applying}
          fromWizard={fromWizard}
          onApply={apply}
          onBack={() => setMode(fromWizard ? 'wizard' : 'home')}
        />
      )}
    </section>
  );
}

/** Home: the active-playbook spotlight + two creation paths + saved versions. */
function PlaybookHome({
  activePlaybook, playbooks, loading, onGenerate, onManual, onEdit,
}: {
  activePlaybook: PlaybookListItem | null;
  playbooks: PlaybookListItem[];
  loading: boolean;
  onGenerate: () => void;
  onManual: () => void;
  onEdit: (id: string) => void;
}) {
  return (
    <div className="space-y-4">
      {/* Active playbook spotlight */}
      {activePlaybook ? (
        <div className="rounded-xl border border-success/30 bg-[color-mix(in_srgb,var(--success)_8%,transparent)] p-4">
          <div className="flex items-start gap-3">
            <span className="rounded-lg bg-success/15 p-2 shrink-0">
              <BookOpen size={16} className="text-success" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold truncate">{activePlaybook.name}</span>
                <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border bg-success/15 text-success border-success/30">
                  Active
                </span>
              </div>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Coaching your live calls &middot; created {fmtDate(activePlaybook.created_at)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => onEdit(activePlaybook.id)}
              className="btn btn-ghost btn-sm shrink-0 self-center inline-flex items-center gap-1"
            >
              <PenLine size={12} /> View / edit
            </button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-border p-5 text-center">
          <BookOpen size={20} className="text-muted-foreground mx-auto mb-1.5" />
          <p className="text-xs text-muted-foreground">
            No playbook yet. Create one so the AI knows how to coach your calls.
          </p>
        </div>
      )}

      {/* Two creation paths */}
      <div className="grid sm:grid-cols-2 gap-2.5">
        <button
          onClick={onGenerate}
          className="text-left rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-1.5 transition-[border-color,background-color] duration-150 hover:border-primary/50 hover:bg-[color-mix(in_srgb,var(--surface-2)_72%,transparent)]"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-primary/12 p-1.5"><Wand2 size={14} className="text-primary" /></span>
            <span className="text-[13px] font-semibold">{activePlaybook ? 'New playbook with AI' : 'Generate with AI'}</span>
            <span className="ml-auto text-[8px] font-bold uppercase tracking-wider text-primary bg-primary/10 rounded-full px-1.5 py-0.5">
              Recommended
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Answer a few quick questions &mdash; we&rsquo;ll draft a complete, editable playbook with your Anthropic key.
          </p>
        </button>

        <button
          onClick={onManual}
          className="text-left rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-1.5 transition-[border-color,background-color] duration-150 hover:border-primary/50 hover:bg-[color-mix(in_srgb,var(--surface-2)_72%,transparent)]"
        >
          <div className="flex items-center gap-2">
            <span className="rounded-lg bg-muted-foreground/12 p-1.5"><PenLine size={14} className="text-muted-foreground" /></span>
            <span className="text-[13px] font-semibold">Write it myself</span>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Start from a blank playbook and fill it in by hand. No Anthropic key needed.
          </p>
        </button>
      </div>

      {/* Saved versions */}
      <PlaybookList playbooks={playbooks} loading={loading} onEdit={onEdit} />
    </div>
  );
}

/** A labeled cluster of wizard fields. */
function WizardGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2.5">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/80">{title}</div>
      {children}
    </div>
  );
}

/** Step 1 — the guided Q&A wizard, grouped into logical clusters. */
function WizardForm({
  answers, setAns, methodologyChoice, setMethodologyChoice, generating, onGenerate, onBack,
}: {
  answers: PlaybookAnswers;
  setAns: (k: keyof PlaybookAnswers, v: string) => void;
  methodologyChoice: string;
  setMethodologyChoice: (v: string) => void;
  generating: boolean;
  onGenerate: () => void;
  onBack: () => void;
}) {
  return (
    <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <Wand2 size={12} className="text-primary" /> Guided setup
        </div>
        <button className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={onBack} disabled={generating}>
          <ArrowLeft size={12} /> Back
        </button>
      </div>

      <WizardGroup title="Your company & offer">
        <div className="grid sm:grid-cols-2 gap-2.5">
          <Field label="Company name">
            <input value={answers.company_name} onChange={(e) => setAns('company_name', e.target.value)} style={{ width: '100%' }} placeholder="Acme Inc." />
          </Field>
          <Field label="What you sell">
            <input value={answers.product_name} onChange={(e) => setAns('product_name', e.target.value)} style={{ width: '100%' }} placeholder="e.g. AI scheduling for clinics" />
          </Field>
        </div>
        <Field label="Pricing" hint="We never invent prices — only what you enter here is used.">
          <input value={answers.pricing} onChange={(e) => setAns('pricing', e.target.value)} style={{ width: '100%' }} placeholder="e.g. $499/mo, 20% off annual" />
        </Field>
      </WizardGroup>

      <WizardGroup title="Your buyer & edge">
        <Field label="Who buys it" hint="Your typical buyer — role, company size, what they care about.">
          <textarea value={answers.buyer_persona} onChange={(e) => setAns('buyer_persona', e.target.value)} style={{ width: '100%' }} rows={2} placeholder="e.g. Practice managers at 5–20 provider clinics, time-strapped, hate no-shows" />
        </Field>
        <Field label="Differentiators" hint="Why you win vs. the alternatives.">
          <textarea value={answers.differentiators} onChange={(e) => setAns('differentiators', e.target.value)} style={{ width: '100%' }} rows={2} placeholder="e.g. Sets up in a day, native EHR sync, white-glove onboarding" />
        </Field>
      </WizardGroup>

      <WizardGroup title="How your calls run">
        <Field label="Sales motion" hint="How these calls usually run.">
          <input value={answers.sales_motion} onChange={(e) => setAns('sales_motion', e.target.value)} style={{ width: '100%' }} placeholder="e.g. 30-min inbound demo calls" />
        </Field>
        <Field label="Methodology" hint="Pick a framework, or choose Other to describe your own.">
          <select value={methodologyChoice} onChange={(e) => setMethodologyChoice(e.target.value)} style={{ width: '100%' }}>
            <option value="">No preference</option>
            {METHODOLOGY_OPTIONS.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </Field>
        {methodologyChoice === 'Other' && (
          <Field label="Describe your methodology">
            <input value={answers.methodology} onChange={(e) => setAns('methodology', e.target.value)} style={{ width: '100%' }} placeholder="e.g. Discovery-led, demo last, never discount on call 1" />
          </Field>
        )}
        <Field label="Common objections" hint="What prospects push back on. Comma-separated is fine.">
          <textarea value={answers.common_objections} onChange={(e) => setAns('common_objections', e.target.value)} style={{ width: '100%' }} rows={2} placeholder="too expensive, need to ask my partner, already use a competitor, not the right time" />
        </Field>
      </WizardGroup>

      <WizardGroup title="Coaching style">
        <div className="grid sm:grid-cols-2 gap-2.5">
          <Field label="Tone" hint="How the coaching should sound.">
            <input value={answers.desired_tone} onChange={(e) => setAns('desired_tone', e.target.value)} style={{ width: '100%' }} placeholder="e.g. confident, warm, concise" />
          </Field>
          <Field label="Goal of the call" hint="What a great call ends with.">
            <input value={answers.call_goal} onChange={(e) => setAns('call_goal', e.target.value)} style={{ width: '100%' }} placeholder="e.g. book a paid pilot" />
          </Field>
        </div>
      </WizardGroup>

      <div className="pt-1 border-t border-border/40">
        <button className="btn btn-primary btn-sm inline-flex items-center gap-1.5" disabled={generating} onClick={onGenerate}>
          <Sparkles size={13} /> {generating ? 'Generating…' : 'Generate playbook'}
        </button>
        <p className="text-[10px] text-muted-foreground mt-1.5">
          Uses your own Anthropic key. This drafts a playbook for review — nothing is saved or activated until you apply it.
        </p>
      </div>
    </div>
  );
}

/** Step 2 — review + edit the draft (AI-generated OR blank/manual), name it, then apply. */
function ReviewForm({
  draft, setDraft, name, setName, applying, fromWizard, onApply, onBack,
}: {
  draft: PlaybookContent;
  setDraft: React.Dispatch<React.SetStateAction<PlaybookContent | null>>;
  name: string;
  setName: (v: string) => void;
  applying: boolean;
  fromWizard: boolean;
  onApply: () => void;
  onBack: () => void;
}) {
  // Helpers that edit one field of the draft.
  const set = <K extends keyof PlaybookContent>(k: K, v: PlaybookContent[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  return (
    <div className="rounded-xl border border-primary/30 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
      <div className="flex items-center gap-2">
        <button className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={onBack} disabled={applying}>
          <ArrowLeft size={12} /> Back
        </button>
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
          {fromWizard ? <><Sparkles size={12} /> Review your draft</> : <><PenLine size={12} /> Write your playbook</>}
        </div>
      </div>

      <div className="rounded-lg border border-info/30 bg-info/10 p-2.5 text-[10px] text-muted-foreground flex items-start gap-1.5">
        <AlertCircle size={12} className="text-info shrink-0 mt-0.5" />
        <span>
          Edit anything below, then <span className="font-medium text-foreground">Apply</span>. Applying saves this as a
          <span className="font-medium text-foreground"> new, named playbook</span> and makes it active for your live
          co-pilot. It never overwrites a previous playbook &mdash; they&rsquo;re all kept for history and split-testing.
        </span>
      </div>

      {/* Fields mirrored into salesops_config (what the live coach reads) */}
      <Field label="Buyer persona">
        <textarea value={draft.persona} onChange={(e) => set('persona', e.target.value)} style={{ width: '100%' }} rows={2} placeholder="Who you're typically selling to" />
      </Field>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Company name">
          <input value={draft.company_name} onChange={(e) => set('company_name', e.target.value)} style={{ width: '100%' }} />
        </Field>
        <Field label="Product / service">
          <input value={draft.product_name} onChange={(e) => set('product_name', e.target.value)} style={{ width: '100%' }} />
        </Field>
      </div>
      <Field label="Pricing" hint="Only what you provide is used — never invented.">
        <input value={draft.pricing} onChange={(e) => set('pricing', e.target.value)} style={{ width: '100%' }} />
      </Field>
      <Field label="Differentiators">
        <textarea value={draft.differentiators} onChange={(e) => set('differentiators', e.target.value)} style={{ width: '100%' }} rows={2} />
      </Field>

      <Field label="Opener" hint="The first line or two of the call.">
        <textarea value={draft.opener} onChange={(e) => set('opener', e.target.value)} style={{ width: '100%' }} rows={2} />
      </Field>

      <StringListEditor
        label="Discovery questions"
        hint="Questions to surface pain and fit."
        items={draft.discovery_questions}
        onChange={(items) => set('discovery_questions', items)}
        placeholder="Add a discovery question…"
      />
      <StringListEditor
        label="Value props"
        hint="Punchy reasons to buy."
        items={draft.value_props}
        onChange={(items) => set('value_props', items)}
        placeholder="Add a value prop…"
      />

      <ObjectionEditor
        items={draft.objection_handling}
        onChange={(items) => set('objection_handling', items)}
      />

      <Field label="Closing" hint="The next-step / close move.">
        <textarea value={draft.closing} onChange={(e) => set('closing', e.target.value)} style={{ width: '100%' }} rows={2} />
      </Field>

      <Field label="Objection keywords" hint="Comma-separated. Trigger an instant suggestion when heard on a call.">
        <input
          value={draft.objection_keywords.join(', ')}
          onChange={(e) => set('objection_keywords', e.target.value.split(',').map((s) => s.trim()).filter(Boolean))}
          style={{ width: '100%' }}
          placeholder="too expensive, competitor, not sure"
        />
      </Field>

      <Field label="Playbook narrative" hint="The full playbook your live co-pilot reads on every call. Edit freely.">
        <textarea value={draft.playbook_narrative} onChange={(e) => set('playbook_narrative', e.target.value)} style={{ width: '100%' }} rows={10} className="font-mono text-[11px]" />
      </Field>

      <div className="pt-1 border-t border-border/40 space-y-2">
        <Field label="Playbook name" hint="Name this version so you can tell variants apart later.">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} maxLength={120} placeholder="e.g. Consultative v1" />
        </Field>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm inline-flex items-center gap-1.5" disabled={applying} onClick={onApply}>
            <CheckCircle2 size={13} /> {applying ? 'Applying…' : 'Apply & activate'}
          </button>
          <button className="btn btn-ghost btn-sm" disabled={applying} onClick={onBack}>
            {fromWizard ? 'Back to questions' : 'Cancel'}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Editable list of free-text strings (discovery questions, value props). */
function StringListEditor({
  label, hint, items, onChange, placeholder,
}: {
  label: string;
  hint?: string;
  items: string[];
  onChange: (items: string[]) => void;
  placeholder?: string;
}) {
  const update = (i: number, v: string) => onChange(items.map((x, idx) => (idx === i ? v : x)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, '']);

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground -mt-0.5">{hint}</p>}
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <input value={item} onChange={(e) => update(i, e.target.value)} style={{ width: '100%' }} placeholder={placeholder} />
            <button type="button" className="btn btn-ghost btn-sm shrink-0" title="Remove" onClick={() => remove(i)}>
              <X size={11} />
            </button>
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={add}>
          <Plus size={11} /> Add
        </button>
      </div>
    </div>
  );
}

/** Editable list of objection → response script pairs. */
function ObjectionEditor({
  items, onChange,
}: {
  items: ObjectionScript[];
  onChange: (items: ObjectionScript[]) => void;
}) {
  const update = (i: number, patch: Partial<ObjectionScript>) =>
    onChange(items.map((x, idx) => (idx === i ? { ...x, ...patch } : x)));
  const remove = (i: number) => onChange(items.filter((_, idx) => idx !== i));
  const add = () => onChange([...items, { objection: '', response: '' }]);

  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium">Objection handling</label>
      <p className="text-[10px] text-muted-foreground -mt-0.5">A verbatim rebuttal for each objection.</p>
      <div className="space-y-2">
        {items.map((o, i) => (
          <div key={i} className="rounded-lg border border-border/50 p-2 space-y-1.5">
            <div className="flex items-center gap-1.5">
              <input value={o.objection} onChange={(e) => update(i, { objection: e.target.value })} style={{ width: '100%' }} placeholder="Objection (how they say it)" />
              <button type="button" className="btn btn-ghost btn-sm shrink-0" title="Remove" onClick={() => remove(i)}>
                <X size={11} />
              </button>
            </div>
            <textarea value={o.response} onChange={(e) => update(i, { response: e.target.value })} style={{ width: '100%' }} rows={2} placeholder="Your verbatim response" />
          </div>
        ))}
        <button type="button" className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={add}>
          <Plus size={11} /> Add objection
        </button>
      </div>
    </div>
  );
}

/** The list of saved playbooks — history + variants; seeds the future split-test UX. */
function PlaybookList({ playbooks, loading, onEdit }: { playbooks: PlaybookListItem[]; loading: boolean; onEdit: (id: string) => void }) {
  // The active one already has the spotlight above; list the rest as history.
  const others = playbooks.filter((p) => !p.is_active);
  if (loading) {
    return <p className="text-xs text-muted-foreground">Loading playbooks…</p>;
  }
  if (others.length === 0) return null;

  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground">
        <History size={12} /> Earlier versions
      </div>
      <div className="space-y-1">
        {others.map((p) => (
          <div key={p.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5">
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-medium truncate">{p.name}</div>
              <div className="text-[10px] text-muted-foreground">
                Created {fmtDate(p.created_at)}
                <span className="opacity-60"> · split-test stats coming soon</span>
              </div>
            </div>
            <div className="text-[10px] text-muted-foreground shrink-0 text-right" title="Calls / wins — coming with split-testing">
              — / —
            </div>
            <button
              type="button"
              onClick={() => onEdit(p.id)}
              className="btn btn-ghost btn-sm shrink-0"
              title="View / edit this version"
              aria-label={`View or edit ${p.name}`}
            >
              <PenLine size={11} />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A sensible default name for a freshly generated playbook (rep can rename). */
function suggestPlaybookName(answers: PlaybookAnswers, methodology: string): string {
  const base = methodology?.trim() || answers.product_name?.trim() || 'Playbook';
  const stamp = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return `${base} · ${stamp}`.slice(0, 120);
}

// ── Reanalyze (Playbook Phase 2) ─────────────────────────────────────────────────
// The MANUAL "re-derive the active playbook from evidence" surface. Three pieces on one
// section, gated behind PLAYBOOK_REANALYZE:
//   • Sources manager — add own won calls (pick from recent), creator IG handles/URLs, or
//                       pasted YouTube transcripts / freeform notes; list + remove; show status.
//   • Reanalyze button — POST /reanalyze → stages a pending change-set (disabled with no active
//                        playbook or no extracted sources). Nothing is applied automatically.
//   • Change-set review — per proposed change: field, current→proposed, rationale, confidence,
//                         pattern_support, citations; per-change accept/reject (default accept
//                         high/medium, reject low); a name; "Apply selected" → new active version;
//                         "Discard".
// EVERYTHING is non-destructive and manual: a change-set is only created on an explicit click,
// and applying it goes through the same non-destructive new-version path as playbook/apply.

const SOURCE_KIND_META: Record<SourceKind, { label: string; icon: typeof Instagram }> = {
  won_call: { label: 'Won call', icon: PhoneCall },
  instagram: { label: 'Instagram', icon: Instagram },
  youtube: { label: 'YouTube', icon: Youtube },
  manual: { label: 'Notes', icon: FileText },
};

// Human label for a PlaybookContent field (what the change targets).
const FIELD_LABELS: Record<keyof PlaybookContent, string> = {
  persona: 'Buyer persona',
  company_name: 'Company name',
  product_name: 'Product / service',
  pricing: 'Pricing',
  differentiators: 'Differentiators',
  objection_keywords: 'Objection keywords',
  opener: 'Opener',
  discovery_questions: 'Discovery questions',
  value_props: 'Value props',
  objection_handling: 'Objection handling',
  closing: 'Closing',
  playbook_narrative: 'Playbook narrative',
};

function ReanalyzeSection() {
  // Sources
  const [sources, setSources] = useState<SourceRecord[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);

  // Whether there's an active playbook (drives whether Reanalyze can run).
  const [hasActivePlaybook, setHasActivePlaybook] = useState(false);

  // Change-set lifecycle
  const [changeset, setChangeset] = useState<ChangeSetRecord | null>(null);
  const [reanalyzing, setReanalyzing] = useState(false);

  const loadSources = useCallback(async () => {
    setSourcesLoading(true);
    try {
      const res = await fetch('/api/salesops-admin/sources', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setSources(json.sources ?? []);
      }
    } finally {
      setSourcesLoading(false);
    }
  }, []);

  // Is there an active playbook? (Reuse the playbook list endpoint.)
  const loadActive = useCallback(async () => {
    try {
      const res = await fetch('/api/salesops-admin/playbook', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setHasActivePlaybook(((json.playbooks ?? []) as PlaybookListItem[]).some((p) => p.is_active));
      }
    } catch { /* non-fatal */ }
  }, []);

  // Surface any already-pending change-set so a refresh doesn't lose it.
  const loadPending = useCallback(async () => {
    try {
      const res = await fetch('/api/salesops-admin/changeset?status=pending', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        const list = (json.changesets ?? []) as ChangeSetRecord[];
        if (list.length > 0) setChangeset(list[0]);
      }
    } catch { /* non-fatal */ }
  }, []);

  useEffect(() => { loadSources(); loadActive(); loadPending(); }, [loadSources, loadActive, loadPending]);

  const extractedCount = sources.filter((s) => s.status === 'extracted').length;
  const canReanalyze = hasActivePlaybook && extractedCount > 0 && !reanalyzing;

  async function runReanalyze() {
    if (!canReanalyze) return;
    setReanalyzing(true);
    try {
      const res = await fetch('/api/salesops-admin/reanalyze', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}), // default: all extracted sources
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'connect_anthropic') {
          toast.error('Connect your Anthropic key in Connections → Anthropic to reanalyze.');
        } else if (json.error === 'no_active_playbook') {
          toast.error('Create an active playbook first.');
        } else if (json.error === 'no_sources') {
          toast.error('Add at least one extracted source first.');
        } else {
          toast.error('Reanalyze failed. Try again.');
        }
        return;
      }
      const cs: ChangeSetRecord = json.changeset;
      setChangeset(cs);
      if ((cs.changes?.length ?? 0) === 0) {
        toast.info('The evidence supports no changes right now.');
      } else {
        toast.success(`${cs.changes.length} proposed change${cs.changes.length === 1 ? '' : 's'} ready to review`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setReanalyzing(false);
    }
  }

  // After apply/discard, clear the panel + refresh active state.
  function onChangesetResolved() {
    setChangeset(null);
    loadActive();
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <FlaskConical size={14} className="text-primary" /> Reanalyze playbook
          <span className="text-[8px] font-bold uppercase tracking-wider text-primary bg-primary/10 rounded-full px-1.5 py-0.5">
            Beta
          </span>
        </div>
        <p className="text-xs text-muted-foreground max-w-2xl">
          Improve your active playbook from real evidence &mdash; your own closed-won calls, top creators in your niche,
          or pasted notes. We propose specific, cited changes for you to accept or reject. Nothing changes automatically.
        </p>
      </div>

      <SourcesManager
        sources={sources}
        loading={sourcesLoading}
        onChanged={loadSources}
      />

      {/* Reanalyze trigger */}
      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-2">
        <div className="flex items-center gap-2 flex-wrap">
          <button
            className="btn btn-primary btn-sm inline-flex items-center gap-1.5"
            disabled={!canReanalyze}
            onClick={runReanalyze}
          >
            {reanalyzing
              ? <><Loader2 size={13} className="animate-spin" /> Reanalyzing…</>
              : <><RefreshCw size={13} /> Reanalyze playbook</>}
          </button>
          <span className="text-[11px] text-muted-foreground">
            {extractedCount} ready source{extractedCount === 1 ? '' : 's'}
          </span>
        </div>
        {!hasActivePlaybook && (
          <p className="text-[10px] text-warning inline-flex items-center gap-1">
            <AlertCircle size={11} /> Create an active playbook above before reanalyzing.
          </p>
        )}
        {hasActivePlaybook && extractedCount === 0 && (
          <p className="text-[10px] text-muted-foreground">
            Add at least one source (and let it finish extracting) to enable reanalyze.
          </p>
        )}
        <p className="text-[10px] text-muted-foreground">
          Uses your own Anthropic key. This drafts a change-set for review &mdash; your active playbook is never changed
          until you apply selected changes.
        </p>
      </div>

      {/* Change-set review */}
      {changeset && (
        <ChangesetReview
          changeset={changeset}
          sources={sources}
          onResolved={onChangesetResolved}
        />
      )}
    </section>
  );
}

/** Sources manager — add own won calls (picker), creator handles/URLs, or pasted notes; list + remove. */
function SourcesManager({
  sources, loading, onChanged,
}: {
  sources: SourceRecord[];
  loading: boolean;
  onChanged: () => void;
}) {
  const [adder, setAdder] = useState<null | SourceKind>(null);

  async function remove(id: string) {
    if (!confirm('Remove this source?')) return;
    const res = await fetch('/api/salesops-admin/sources', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) { toast.success('Source removed'); onChanged(); }
    else toast.error('Could not remove the source.');
  }

  return (
    <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground">
          <BookOpen size={12} /> Evidence sources
        </div>
        <div className="flex items-center gap-1.5 flex-wrap justify-end">
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={() => setAdder('won_call')}>
            <PhoneCall size={11} /> Won call
          </button>
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={() => setAdder('instagram')}>
            <Instagram size={11} /> Instagram
          </button>
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={() => setAdder('youtube')}>
            <Youtube size={11} /> YouTube
          </button>
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-1" onClick={() => setAdder('manual')}>
            <FileText size={11} /> Notes
          </button>
        </div>
      </div>

      {adder && (
        <AddSourceForm
          kind={adder}
          onCancel={() => setAdder(null)}
          onAdded={() => { setAdder(null); onChanged(); }}
        />
      )}

      {/* Source list */}
      {loading ? (
        <p className="text-xs text-muted-foreground">Loading sources…</p>
      ) : sources.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          No sources yet. Add a won call, a creator&rsquo;s Instagram, or paste notes to give the reanalysis evidence.
        </p>
      ) : (
        <div className="space-y-1">
          {sources.map((s) => <SourceRow key={s.id} source={s} onRemove={() => remove(s.id)} />)}
        </div>
      )}
    </div>
  );
}

/** One source row: kind icon + label + status pill + remove. */
function SourceRow({ source, onRemove }: { source: SourceRecord; onRemove: () => void }) {
  const meta = SOURCE_KIND_META[source.kind];
  const Icon = meta.icon;
  const display = source.label || source.ref || meta.label;
  return (
    <div className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5">
      <span className="rounded bg-muted-foreground/12 p-1 shrink-0">
        <Icon size={12} className="text-muted-foreground" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium truncate">{display}</div>
        <div className="text-[10px] text-muted-foreground truncate">
          {meta.label}
          {source.niche ? ` · ${source.niche}` : ''}
          {' · '}{fmtDate(source.created_at)}
          {source.status === 'error' && source.error ? ` · ${source.error}` : ''}
        </div>
      </div>
      <SourceStatusPill status={source.status} />
      <button className="btn btn-ghost btn-sm shrink-0" title="Remove" onClick={onRemove}>
        <Trash2 size={11} />
      </button>
    </div>
  );
}

function SourceStatusPill({ status }: { status: SourceStatus }) {
  const map: Record<SourceStatus, { cls: string; label: string; icon: typeof Check }> = {
    extracted: { cls: 'bg-success/15 text-success border-success/30', label: 'Ready', icon: Check },
    pending: { cls: 'bg-warning/15 text-warning border-warning/30', label: 'Pending', icon: Clock },
    error: { cls: 'bg-destructive/15 text-destructive border-destructive/30', label: 'Error', icon: AlertCircle },
  };
  const { cls, label, icon: Icon } = map[status];
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border inline-flex items-center gap-0.5 shrink-0 ${cls}`}>
      <Icon size={9} /> {label}
    </span>
  );
}

/** The add-a-source form. Shape depends on kind:
 *  - won_call : pick from recent sales_calls
 *  - instagram: a handle OR a reel/post URL (+ optional niche/label)
 *  - youtube  : paste a transcript (+ optional label/niche) — native fetch is DEFERRED
 *  - manual   : paste freeform notes (+ optional label/niche)
 */
function AddSourceForm({
  kind, onCancel, onAdded,
}: {
  kind: SourceKind;
  onCancel: () => void;
  onAdded: () => void;
}) {
  const meta = SOURCE_KIND_META[kind];
  const [ref, setRef] = useState('');
  const [label, setLabel] = useState('');
  const [niche, setNiche] = useState('');
  const [text, setText] = useState('');
  const [pickedCallId, setPickedCallId] = useState('');
  const [saving, setSaving] = useState(false);

  // won_call picker data
  const [calls, setCalls] = useState<SalesCall[]>([]);
  const [callsLoading, setCallsLoading] = useState(kind === 'won_call');

  useEffect(() => {
    if (kind !== 'won_call') return;
    setCallsLoading(true);
    fetch('/api/salesops-admin/calls', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { calls: [] }))
      .then((j) => setCalls(j.calls ?? []))
      .catch(() => {})
      .finally(() => setCallsLoading(false));
  }, [kind]);

  function validate(): { ref?: string | null; text?: string | null } | null {
    if (kind === 'won_call') {
      if (!pickedCallId) { toast.error('Pick a call to add.'); return null; }
      return { ref: pickedCallId };
    }
    if (kind === 'instagram') {
      if (!ref.trim()) { toast.error('Enter a handle or a reel URL.'); return null; }
      return { ref: ref.trim() };
    }
    // youtube | manual — pasted text
    if (!text.trim()) { toast.error('Paste some text to add as a source.'); return null; }
    return { text: text.trim() };
  }

  async function add() {
    const v = validate();
    if (!v) return;
    setSaving(true);
    try {
      const res = await fetch('/api/salesops-admin/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind,
          ref: v.ref ?? null,
          label: label.trim() || null,
          niche: niche.trim() || null,
          text: v.text ?? null,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'connect_apify') {
          toast.error('Connect your Apify key in Connections → Apify to scrape Instagram.');
        } else {
          toast.error('Could not add the source. Try again.');
        }
        return;
      }
      const s: SourceRecord | undefined = json.source;
      if (s?.status === 'error') {
        toast.error(`Added, but extraction failed${s.error ? `: ${s.error}` : ''}.`);
      } else {
        toast.success('Source added');
      }
      onAdded();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] p-3 space-y-2.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
          <meta.icon size={12} /> Add {meta.label.toLowerCase()} source
        </div>
        <button className="btn btn-ghost btn-sm shrink-0" title="Cancel" onClick={onCancel} disabled={saving}>
          <X size={11} />
        </button>
      </div>

      {kind === 'won_call' && (
        <Field label="Pick a recorded call" hint="We read its transcript + summary as evidence.">
          {callsLoading ? (
            <p className="text-[11px] text-muted-foreground">Loading calls…</p>
          ) : calls.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">No recorded calls yet.</p>
          ) : (
            <select value={pickedCallId} onChange={(e) => setPickedCallId(e.target.value)} style={{ width: '100%' }}>
              <option value="">Select a call…</option>
              {calls.map((c) => (
                <option key={c.id} value={c.id}>
                  {(c.contact_name || c.contact_email || 'Unknown contact')}
                  {c.deal_temp ? ` · ${c.deal_temp}` : ''} · {fmtDate(c.started_at)}
                </option>
              ))}
            </select>
          )}
        </Field>
      )}

      {kind === 'instagram' && (
        <Field label="Handle or reel URL" hint="e.g. @topcreator (recent reels) or a single reel/post URL.">
          <input value={ref} onChange={(e) => setRef(e.target.value)} style={{ width: '100%' }} placeholder="@creator or https://instagram.com/reel/…" />
        </Field>
      )}

      {(kind === 'youtube' || kind === 'manual') && (
        <Field
          label={kind === 'youtube' ? 'Paste the transcript' : 'Paste your notes'}
          hint={kind === 'youtube'
            ? 'Paste a YouTube transcript or talk track. Automatic fetch is coming soon.'
            : 'Any freeform notes, scripts, or observations to mine.'}
        >
          <textarea value={text} onChange={(e) => setText(e.target.value)} style={{ width: '100%' }} rows={5} placeholder="Paste text here…" />
        </Field>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Field label="Label" hint="Optional — to recognize it later.">
          <input value={label} onChange={(e) => setLabel(e.target.value)} style={{ width: '100%' }} placeholder="e.g. Best discovery call" />
        </Field>
        <Field label="Niche" hint="Optional — the niche/context.">
          <input value={niche} onChange={(e) => setNiche(e.target.value)} style={{ width: '100%' }} placeholder="e.g. dental SaaS" />
        </Field>
      </div>

      <div className="flex items-center gap-2 pt-1">
        <button className="btn btn-primary btn-sm inline-flex items-center gap-1.5" disabled={saving} onClick={add}>
          {saving ? <><Loader2 size={12} className="animate-spin" /> Adding…</> : <><Plus size={12} /> Add source</>}
        </button>
        <button className="btn btn-ghost btn-sm" disabled={saving} onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

/** Change-set review panel: per-change accept/reject, citations, name, Apply selected, Discard. */
function ChangesetReview({
  changeset, sources, onResolved,
}: {
  changeset: ChangeSetRecord;
  sources: SourceRecord[];
  onResolved: () => void;
}) {
  // Default accept high/medium, reject low. Keyed by change index.
  const [accepted, setAccepted] = useState<boolean[]>(() =>
    changeset.changes.map((c) => c.confidence !== 'low'));
  const [name, setName] = useState('');
  const [applying, setApplying] = useState(false);
  const [discarding, setDiscarding] = useState(false);

  const acceptedCount = accepted.filter(Boolean).length;

  function toggle(i: number) {
    setAccepted((a) => a.map((x, idx) => (idx === i ? !x : x)));
  }

  async function apply() {
    const trimmed = name.trim();
    if (!trimmed) { toast.error('Name this new playbook version.'); return; }
    const accepted_indexes = accepted.flatMap((ok, i) => (ok ? [i] : []));
    if (accepted_indexes.length === 0) { toast.error('Select at least one change to apply.'); return; }
    setApplying(true);
    try {
      const res = await fetch('/api/salesops-admin/changeset/apply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeset_id: changeset.id, accepted_indexes, name: trimmed }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (json.error === 'empty_playbook') toast.error('The resulting playbook narrative is empty.');
        else toast.error('Could not apply the change-set. Try again.');
        return;
      }
      toast.success(`“${trimmed}” is now your active playbook`);
      onResolved();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setApplying(false);
    }
  }

  async function discard() {
    if (!confirm('Discard this change-set? The proposed changes will be dropped.')) return;
    setDiscarding(true);
    try {
      const res = await fetch('/api/salesops-admin/changeset/discard', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ changeset_id: changeset.id }),
      });
      if (res.ok) { toast.success('Change-set discarded'); onResolved(); }
      else toast.error('Could not discard the change-set.');
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDiscarding(false);
    }
  }

  const busy = applying || discarding;

  if (changeset.changes.length === 0) {
    return (
      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground">
          <FlaskConical size={12} className="text-primary" /> Reanalysis complete
        </div>
        <p className="text-xs text-muted-foreground">
          {changeset.summary || 'The evidence supports no changes to your active playbook right now.'}
        </p>
        <button className="btn btn-ghost btn-sm inline-flex items-center gap-1.5" disabled={discarding} onClick={discard}>
          {discarding ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Dismiss
        </button>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-primary/30 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
      <div className="flex items-center gap-1.5 text-[11px] font-medium text-primary">
        <FlaskConical size={12} /> Proposed changes
        <span className="text-[10px] text-muted-foreground font-normal ml-1">
          {acceptedCount} of {changeset.changes.length} selected
        </span>
      </div>

      {changeset.summary && (
        <div className="rounded-lg border border-info/30 bg-info/10 p-2.5 text-[11px] text-muted-foreground">
          {changeset.summary}
        </div>
      )}

      <div className="space-y-2.5">
        {changeset.changes.map((c, i) => (
          <ChangeCard key={i} change={c} accepted={accepted[i]} onToggle={() => toggle(i)} />
        ))}
      </div>

      {/* Apply / discard */}
      <div className="pt-1 border-t border-border/40 space-y-2">
        <Field label="New playbook name" hint="Applying creates a new active version — your current playbook is kept.">
          <input value={name} onChange={(e) => setName(e.target.value)} style={{ width: '100%' }} maxLength={120} placeholder="e.g. Reanalyzed · evidence v1" />
        </Field>
        <div className="flex items-center gap-2 flex-wrap">
          <button className="btn btn-primary btn-sm inline-flex items-center gap-1.5" disabled={busy || acceptedCount === 0} onClick={apply}>
            {applying ? <><Loader2 size={13} className="animate-spin" /> Applying…</> : <><CheckCircle2 size={13} /> Apply selected ({acceptedCount})</>}
          </button>
          <button className="btn btn-ghost btn-sm inline-flex items-center gap-1.5" disabled={busy} onClick={discard}>
            {discarding ? <Loader2 size={12} className="animate-spin" /> : <Trash2 size={12} />} Discard
          </button>
        </div>
        <p className="text-[10px] text-muted-foreground">
          Applying mirrors the new playbook to your live co-pilot immediately. It never overwrites a previous version.
        </p>
      </div>
    </div>
  );
}

/** A single proposed change: header (field + op + confidence), current→proposed diff,
 *  rationale, pattern_support, citations, and an accept/reject checkbox. */
function ChangeCard({
  change, accepted, onToggle,
}: {
  change: ChangeItem;
  accepted: boolean;
  onToggle: () => void;
}) {
  return (
    <div className={`rounded-xl border p-3 space-y-2 transition-[border-color,background-color] duration-150 ${
      accepted
        ? 'border-primary/40 bg-[color-mix(in_srgb,var(--primary)_5%,transparent)]'
        : 'border-border/60 bg-[color-mix(in_srgb,var(--surface-2)_40%,transparent)] opacity-75'
    }`}>
      <div className="flex items-start gap-2">
        <label className="flex items-center gap-1.5 cursor-pointer pt-0.5 shrink-0">
          <input type="checkbox" checked={accepted} onChange={onToggle} />
        </label>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5 flex-wrap">
            <span className="text-[12px] font-semibold">{FIELD_LABELS[change.field]}</span>
            <span className="text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border bg-surface-2 text-muted-foreground border-border">
              {change.op}
            </span>
            <ConfidenceBadge confidence={change.confidence} />
          </div>
          {change.pattern_support && (
            <p className="text-[10px] text-muted-foreground mt-0.5">{change.pattern_support}</p>
          )}
        </div>
      </div>

      {/* current → proposed */}
      <div className="grid sm:grid-cols-[1fr_auto_1fr] gap-1.5 items-start">
        <div className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_35%,transparent)] p-2 min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80 mb-0.5">Now</div>
          <div className="text-[11px] text-muted-foreground whitespace-pre-wrap break-words">
            {change.current_excerpt || <span className="opacity-60">(empty)</span>}
          </div>
        </div>
        <div className="hidden sm:flex items-center justify-center pt-5 text-muted-foreground">
          <ArrowRight size={12} />
        </div>
        <div className="rounded-lg border border-primary/30 bg-[color-mix(in_srgb,var(--primary)_6%,transparent)] p-2 min-w-0">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-primary/80 mb-0.5">Proposed</div>
          <ProposedValue field={change.field} value={change.proposed_value} />
        </div>
      </div>

      {change.rationale && (
        <p className="text-[11px] text-muted-foreground">{change.rationale}</p>
      )}

      {change.citations.length > 0 && (
        <div className="space-y-1 pt-1 border-t border-border/40">
          <div className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/80">
            Evidence ({change.citations.length})
          </div>
          {change.citations.map((cit, i) => (
            <div key={i} className="flex items-start gap-1.5">
              <Quote size={11} className="text-muted-foreground/60 shrink-0 mt-0.5" />
              <div className="min-w-0 text-[10px] text-muted-foreground">
                <span className="italic">&ldquo;{cit.quote}&rdquo;</span>
                <span className="text-muted-foreground/70"> &mdash; {cit.source_label}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Render a proposed value per its field kind: text, string list, or objection pairs. */
function ProposedValue({ field, value }: { field: keyof PlaybookContent; value: ChangeItem['proposed_value'] }) {
  // Objection handling — array of {objection, response}.
  if (field === 'objection_handling' && Array.isArray(value)) {
    const pairs = value as ObjectionScript[];
    return (
      <div className="space-y-1.5">
        {pairs.map((p, i) => (
          <div key={i} className="text-[11px]">
            <div className="font-medium">{p.objection}</div>
            <div className="text-muted-foreground whitespace-pre-wrap break-words">{p.response}</div>
          </div>
        ))}
      </div>
    );
  }
  // List fields — string[].
  if (Array.isArray(value)) {
    return (
      <ul className="text-[11px] space-y-0.5 list-disc pl-4">
        {(value as string[]).map((v, i) => <li key={i} className="break-words">{v}</li>)}
      </ul>
    );
  }
  // Text fields — string.
  return <div className="text-[11px] whitespace-pre-wrap break-words">{String(value)}</div>;
}

function ConfidenceBadge({ confidence }: { confidence: ChangeConfidence }) {
  const map: Record<ChangeConfidence, string> = {
    high: 'bg-success/15 text-success border-success/30',
    medium: 'bg-warning/15 text-warning border-warning/30',
    low: 'bg-info/15 text-info border-info/30',
  };
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${map[confidence]}`}>
      {confidence}
    </span>
  );
}

// ── Install ────────────────────────────────────────────────────────────────────
function InstallSection() {
  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Download size={14} className="text-primary" /> Install the extension
        </div>
        <p className="text-xs text-muted-foreground">
          Download the package, then load it as an unpacked extension in Chrome. The Web Store listing is coming soon.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
        <a href="/salesops/pif-extension.zip" download className="btn btn-primary btn-sm inline-flex items-center gap-1.5 w-max">
          <Download size={13} /> Download extension (.zip)
        </a>
        <ol className="text-xs text-muted-foreground space-y-1.5 list-decimal pl-4">
          <li>Unzip the download to a folder you&rsquo;ll keep.</li>
          <li>
            Open <code className="font-mono text-[11px] px-1 rounded bg-surface-2">chrome://extensions</code> and turn on{' '}
            <span className="font-medium text-foreground">Developer mode</span> (top-right).
          </li>
          <li>Click <span className="font-medium text-foreground">Load unpacked</span> and select the unzipped folder.</li>
          <li>Pin the &ldquo;PIF AI Sales Co-Pilot&rdquo; icon, then come back here to <span className="font-medium text-foreground">Connect</span>.</li>
        </ol>
      </div>
    </section>
  );
}

// ── Connect ────────────────────────────────────────────────────────────────────
function ConnectSection() {
  const [tokens, setTokens] = useState<TokenRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [minting, setMinting] = useState(false);
  const [freshToken, setFreshToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/salesops-admin/tokens', { cache: 'no-store' });
      if (res.ok) {
        const json = await res.json();
        setTokens(json.tokens ?? []);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const apiUrl = typeof window !== 'undefined' ? window.location.origin : '';

  // Try to hand the token straight to the installed extension. Returns true if the
  // extension acknowledged; false if it isn't reachable (→ show the copy/paste fallback).
  function pushToExtension(token: string): Promise<boolean> {
    return new Promise((resolve) => {
      const rt = window.chrome?.runtime;
      if (!rt?.sendMessage) return resolve(false);
      let settled = false;
      const done = (ok: boolean) => { if (!settled) { settled = true; resolve(ok); } };
      try {
        rt.sendMessage(
          EXTENSION_ID,
          { type: 'salesops_connect', token, apiUrl },
          (response) => {
            // chrome.runtime.lastError is set when the extension isn't installed/reachable.
            if (rt.lastError) return done(false);
            done(!!(response && (response as { ok?: boolean }).ok));
          },
        );
      } catch {
        done(false);
      }
      // Safety net: if no callback fires (extension absent), don't hang the UI.
      setTimeout(() => done(false), 1200);
    });
  }

  async function mintAndConnect() {
    setMinting(true);
    setFreshToken(null);
    try {
      const res = await fetch('/api/salesops-admin/tokens', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: `Connected ${new Date().toLocaleDateString()}` }),
      });
      const json = await res.json();
      if (!res.ok) { toast.error(json.error || 'Could not create token'); return; }

      const token: string = json.token;
      setFreshToken(token); // always show it as the paste fallback
      const pushed = await pushToExtension(token);
      if (pushed) toast.success('Extension connected to this workspace');
      else toast.info('Token created — paste it into the extension to finish connecting');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setMinting(false);
    }
  }

  async function revoke(id: string) {
    if (!confirm('Revoke this token? Any extension using it will stop working.')) return;
    const res = await fetch('/api/salesops-admin/tokens', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id }),
    });
    if (res.ok) { toast.success('Token revoked'); await load(); }
    else toast.error('Could not revoke token');
  }

  function copyToken() {
    if (!freshToken) return;
    navigator.clipboard?.writeText(freshToken)
      .then(() => { setCopied(true); window.setTimeout(() => setCopied(false), 1500); })
      .catch(() => {});
  }

  const activeTokens = tokens.filter((t) => !t.revoked_at);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Plug size={14} className="text-primary" /> Connect the extension
        </div>
        <p className="text-xs text-muted-foreground">
          Generate a connection token for this workspace. We&rsquo;ll hand it straight to the installed extension; if that
          can&rsquo;t reach it, copy the token and paste it into the extension&rsquo;s options.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
        <button className="btn btn-primary btn-sm inline-flex items-center gap-1.5 w-max" disabled={minting} onClick={mintAndConnect}>
          <Plug size={13} /> {minting ? 'Connecting…' : 'Connect extension'}
        </button>

        {freshToken && (
          <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 space-y-2">
            <div className="flex items-center gap-1.5 text-[11px] font-medium text-warning">
              <AlertCircle size={12} /> Copy this token now — it won&rsquo;t be shown again
            </div>
            <div className="flex items-center gap-1.5">
              <input
                readOnly
                value={freshToken}
                onFocus={(e) => e.currentTarget.select()}
                className="text-[10px] font-mono"
                style={{ width: '100%' }}
              />
              <button type="button" className="btn btn-ghost btn-sm shrink-0 inline-flex items-center gap-1" onClick={copyToken}>
                {copied ? <><Check size={11} /> Copied</> : <><Copy size={11} /> Copy</>}
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Paste it into the extension&rsquo;s <span className="font-medium">Options → Connection</span> if the extension wasn&rsquo;t
              connected automatically. The API URL is{' '}
              <code className="font-mono">{apiUrl}</code>.
            </p>
          </div>
        )}

        {/* Active token list */}
        <div className="space-y-1.5">
          <div className="text-[11px] font-medium flex items-center gap-1.5 text-muted-foreground">
            <KeyRound size={12} /> Connection tokens
          </div>
          {loading ? (
            <p className="text-xs text-muted-foreground">Loading…</p>
          ) : activeTokens.length === 0 ? (
            <p className="text-xs text-muted-foreground">No active tokens yet.</p>
          ) : (
            <div className="space-y-1">
              {activeTokens.map((t) => (
                <div key={t.id} className="flex items-center gap-2 rounded-lg border border-border/50 px-2.5 py-1.5">
                  <div className="min-w-0 flex-1">
                    <div className="text-[11px] font-medium truncate">{t.label || 'Untitled token'}</div>
                    <div className="text-[10px] text-muted-foreground">
                      Added {fmtDate(t.created_at)}
                      {t.last_used_at ? ` · last used ${fmtDate(t.last_used_at)}` : ' · never used'}
                    </div>
                  </div>
                  <button className="btn btn-destructive btn-sm shrink-0" title="Revoke" onClick={() => revoke(t.id)}>
                    <Trash2 size={11} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}

// ── Call settings ────────────────────────────────────────────────────────────────
// ONLY how the co-pilot behaves during a call (cadence + CRM summary). The playbook
// CONTENT lives in Playbook Studio — there is no second copy of those fields here.
const SUMMARY_FIELD_OPTIONS = ['deal_temp', 'objections', 'pain_points', 'next_steps', 'action_items'];

function CallSettingsSection() {
  const [saving, setSaving] = useState(false);

  const [form, setForm] = useState({
    suggestion_interval_ms: 15000,
    summary_enabled: false,
    summary_fields: [...SUMMARY_FIELD_OPTIONS],
  });

  const load = useCallback(async () => {
    const res = await fetch('/api/salesops-admin/config', { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    const c = json.config as SalesopsConfig;
    setForm({
      suggestion_interval_ms: c.suggestion_interval_ms ?? 15000,
      summary_enabled: !!c.summary_enabled,
      summary_fields: c.summary_fields ?? [...SUMMARY_FIELD_OPTIONS],
    });
  }, []);

  useEffect(() => { load(); }, [load]);

  async function save() {
    setSaving(true);
    try {
      // Send ONLY the operational fields. The config route does a partial update, so the
      // playbook-content fields (mirrored from the active playbook) are left untouched.
      const res = await fetch('/api/salesops-admin/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          suggestion_interval_ms: form.suggestion_interval_ms,
          summary_enabled: form.summary_enabled,
          summary_fields: form.summary_fields,
        }),
      });
      if (res.ok) { toast.success('Settings saved'); await load(); }
      else { const j = await res.json(); toast.error(j.error || 'Save failed'); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  function toggleSummaryField(field: string) {
    setForm((f) => ({
      ...f,
      summary_fields: f.summary_fields.includes(field)
        ? f.summary_fields.filter((x) => x !== field)
        : [...f.summary_fields, field],
    }));
  }

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <Settings2 size={14} className="text-primary" /> Call settings
        </div>
        <p className="text-xs text-muted-foreground">
          How the live co-pilot behaves during a call. What it actually says comes from your active playbook above.
        </p>
      </div>

      <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-4 space-y-3">
        <Field label="Suggestion interval" hint="How often coaching refreshes during a call.">
          <select
            value={form.suggestion_interval_ms}
            onChange={(e) => setForm({ ...form, suggestion_interval_ms: Number(e.target.value) })}
            style={{ width: '100%' }}
          >
            <option value={10000}>Every 10 seconds</option>
            <option value={15000}>Every 15 seconds</option>
            <option value={30000}>Every 30 seconds</option>
            <option value={60000}>Every 60 seconds</option>
          </select>
        </Field>

        <div className="space-y-2 pt-1 border-t border-border/40">
          <label className="flex items-center gap-2 text-[11px] font-medium cursor-pointer">
            <input type="checkbox" checked={form.summary_enabled} onChange={(e) => setForm({ ...form, summary_enabled: e.target.checked })} />
            Generate a CRM summary when the call ends
          </label>
          {form.summary_enabled && (
            <div className="pl-5 flex flex-wrap gap-2">
              {SUMMARY_FIELD_OPTIONS.map((f) => (
                <label key={f} className="flex items-center gap-1.5 text-[10px] cursor-pointer">
                  <input type="checkbox" checked={form.summary_fields.includes(f)} onChange={() => toggleSummaryField(f)} />
                  {f.replace(/_/g, ' ')}
                </label>
              ))}
            </div>
          )}
        </div>

        <div className="pt-1">
          <button className="btn btn-primary btn-sm" disabled={saving} onClick={save}>
            {saving ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </div>
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <label className="text-[11px] font-medium">{label}</label>
      {hint && <p className="text-[10px] text-muted-foreground -mt-0.5">{hint}</p>}
      {children}
    </div>
  );
}

// ── Recent calls ─────────────────────────────────────────────────────────────────
function ReviewSection() {
  const [calls, setCalls] = useState<SalesCall[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/salesops-admin/calls', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : { calls: [] }))
      .then((j) => setCalls(j.calls ?? []))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <div className="section-title flex items-center gap-1.5">
          <History size={14} className="text-primary" /> Recent calls
        </div>
        <p className="text-xs text-muted-foreground">
          Every call the extension recorded, with its AI summary. Matched contacts link to your CRM.
        </p>
      </div>

      {loading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : calls.length === 0 ? (
        <div className="rounded-xl border border-border/50 p-6 text-center">
          <p className="text-xs text-muted-foreground">No calls yet. Start listening on a call and they&rsquo;ll appear here.</p>
        </div>
      ) : (
        <div className="space-y-2">
          {calls.map((c) => (
            <div key={c.id} className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_45%,transparent)] p-3 space-y-1.5">
              <div className="flex items-center gap-2 flex-wrap">
                {c.deal_temp && <DealTempPill temp={c.deal_temp} />}
                <span className="text-[11px] font-medium">
                  {c.contact_name || c.contact_email || 'Unknown contact'}
                </span>
                {c.platform && (
                  <span className="text-[9px] uppercase tracking-wider text-muted-foreground px-1.5 py-0.5 rounded bg-surface-2">
                    {c.platform}
                  </span>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">{fmtDate(c.started_at)}</span>
                {c.lead_id && (
                  <Link href="/crm" className="text-[10px] text-primary hover:underline inline-flex items-center gap-0.5">
                    CRM <ExternalLink size={9} />
                  </Link>
                )}
              </div>
              {c.summary && (
                <p className="text-[11px] text-muted-foreground whitespace-pre-wrap line-clamp-6">{c.summary}</p>
              )}
              <div className="text-[10px] text-muted-foreground">
                {c.suggestions_count} suggestion{c.suggestions_count === 1 ? '' : 's'} during the call
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function DealTempPill({ temp }: { temp: string }) {
  const styles: Record<string, string> = {
    HOT: 'bg-destructive/15 text-destructive border-destructive/30',
    WARM: 'bg-warning/15 text-warning border-warning/30',
    COLD: 'bg-info/15 text-info border-info/30',
  };
  const cls = styles[temp.toUpperCase()] || 'bg-surface-2 text-muted-foreground border-border';
  return (
    <span className={`text-[9px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full border ${cls}`}>
      {temp}
    </span>
  );
}

// ── helpers ──────────────────────────────────────────────────────────────────────
function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
    });
  } catch {
    return iso;
  }
}
