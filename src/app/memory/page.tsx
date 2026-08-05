'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { FileText, Plus, Save, Trash2, Loader2, Download, ChevronDown, Sparkles, Eye, PenLine, BadgeCheck, X } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { Explainer } from '@/components/ui/explainer';

// Supported export formats — kept in sync with src/lib/export/markdown-export.ts.
const EXPORT_FORMATS: Array<{ format: string; label: string }> = [
  { format: 'md', label: 'Markdown (.md)' },
  { format: 'html', label: 'HTML (.html)' },
  { format: 'docx', label: 'Word (.docx)' },
  { format: 'pdf', label: 'PDF (.pdf)' },
  { format: 'pptx', label: 'PowerPoint (.pptx)' },
  { format: 'xlsx', label: 'Excel (.xlsx)' },
];

// Small "Export ▾" control: each format is a plain anchor download to the
// tenant-scoped /api/documents/:id/export route, so the browser saves the file.
function ExportMenu({ baseHref }: { baseHref: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen((o) => !o)} title="Download this report as a client deliverable">
        <Download size={13} /> Export <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 z-20 mt-1 w-44 rounded-md border border-border bg-background shadow-lg py-1">
          {EXPORT_FORMATS.map((f) => (
            <a
              key={f.format}
              href={`${baseHref}?format=${f.format}`}
              download
              onClick={() => setOpen(false)}
              className="block px-3 py-1.5 text-xs hover:bg-[var(--surface-2)]"
            >
              {f.label}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

type DocStatus = 'raw' | 'wiki' | 'archived';

interface DocListItem {
  id: string;
  type: string;
  title: string;
  status: DocStatus;
  version: number;
  updated_at: string;
  excerpt: string;
}
interface Doc extends DocListItem {
  content: string;
}

const STATUS_BADGE: Record<DocStatus, string> = {
  raw: 'badge-warning',
  wiki: 'badge-success',
  archived: 'badge-neutral',
};

// Plain-English labels for the raw|wiki|archived status. "wiki" is the ONE
// status agents actually read (its content is injected into every agent prompt),
// so we surface it as the human "Active" state rather than the cryptic value.
const STATUS_SHORT: Record<DocStatus, string> = {
  wiki: 'Active',
  raw: 'Draft',
  archived: 'Archived',
};

// Friendly label for the doc-type badge (SOP vs plain note, else the raw type).
function typeLabel(type: string): string {
  const t = (type || 'note').toLowerCase();
  if (t === 'sop') return 'SOP';
  if (t === 'note') return 'Note';
  return t.charAt(0).toUpperCase() + t.slice(1);
}

function ago(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function MemoryPage() {
  const [docs, setDocs] = useState<DocListItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ title: string; content: string; status: DocStatus } | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<'docs' | 'health'>('docs');
  // Reader-first: the right pane opens as a formatted VIEW; toggle to EDIT to
  // touch the markdown source (so Export-as-markdown stays byte-identical).
  const [mode, setMode] = useState<'view' | 'edit'>('view');
  const [genOpen, setGenOpen] = useState(false);
  const loadedFor = useRef<string | null>(null);

  const loadList = useCallback(async () => {
    try {
      const res = await fetch('/api/documents', { cache: 'no-store' });
      if (!res.ok) { setError(`Failed to load documents (${res.status})`); return; }
      const json = await res.json();
      const list: DocListItem[] = Array.isArray(json.documents) ? json.documents : [];
      setDocs(list);
      setActiveId((prev) => (prev && list.some((d) => d.id === prev) ? prev : list[0]?.id ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadList(); }, [loadList]);

  // Load the active doc's full content when selection changes.
  useEffect(() => {
    if (!activeId || loadedFor.current === activeId) return;
    let cancelled = false;
    (async () => {
      const res = await fetch(`/api/documents/${activeId}`, { cache: 'no-store' });
      if (!res.ok || cancelled) return;
      const json = await res.json();
      const d: Doc = json.document;
      loadedFor.current = activeId;
      setDraft({ title: d.title, content: d.content, status: d.status });
      setMode('view'); // every new selection opens in the readable view
    })();
    return () => { cancelled = true; };
  }, [activeId]);

  // A freshly generated SOP arrives fully-formed from POST /api/documents; select
  // it and open it in VIEW mode for review (bypasses the fetch effect above).
  function handleGenerated(doc: Doc) {
    setGenOpen(false);
    loadedFor.current = doc.id;
    setActiveId(doc.id);
    setDraft({ title: doc.title, content: doc.content, status: doc.status });
    setMode('view');
    loadList();
  }

  async function createDoc() {
    setError(null);
    const res = await fetch('/api/documents', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: 'Untitled', content: '# Untitled\n\n' }),
    });
    const json = await res.json();
    if (!res.ok) { setError(json.error || 'Create failed'); return; }
    await loadList();
    loadedFor.current = json.document.id;
    setActiveId(json.document.id);
    setDraft({ title: json.document.title, content: json.document.content, status: json.document.status });
    setMode('edit'); // a blank doc has nothing to read yet — drop straight into editing
  }

  async function save() {
    if (!activeId || !draft || saving) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/documents/${activeId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      const json = await res.json();
      if (!res.ok) { setError(json.error || 'Save failed'); return; }
      await loadList();
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!activeId) return;
    if (!confirm('Delete this document?')) return;
    await fetch(`/api/documents/${activeId}`, { method: 'DELETE' });
    loadedFor.current = null;
    setActiveId(null);
    setDraft(null);
    await loadList();
  }

  return (
    <div className="space-y-4 animate-in">
      <Explainer
        id="briefings"
        title="What this is"
        what="Written summaries your agents produce — research, weekly reviews, anything worth reading rather than skimming a chat for."
        when="When you want the thinking behind a decision, or something to forward to someone else."
        example="A weekly state-of-the-business brief you can send to a partner without rewriting it."
        say="Or just ask: “Write me a summary of what happened this week.”"
      />
      <div className="flex items-end justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-h1 flex items-center gap-2"><FileText size={18} className="text-primary" /> Briefings</h1>
          <p className="text-xs text-muted-foreground">Filed outputs — mission research reports and scheduled-job results, stored as markdown. (Your AI team&apos;s live knowledge lives in Knowledge; the Company brief moved to Settings.)</p>
        </div>
        <div className="flex items-center gap-1 border-b border-border">
          <button onClick={() => setView('docs')} className={`tab ${view === 'docs' ? 'active' : ''}`}>Briefings</button>
          <button onClick={() => setView('health')} className={`tab ${view === 'health' ? 'active' : ''}`}>Health</button>
        </div>
      </div>

      {view === 'health' ? <HealthView /> : (
      <div className="panel flex" style={{ height: 'calc(100vh - 220px)', minHeight: 460 }}>
        {/* Document list */}
        <div className="w-60 border-r border-border/60 flex flex-col shrink-0">
          <div className="p-2 border-b border-border/40 space-y-1.5">
            <button onClick={createDoc} className="btn btn-primary btn-sm w-full"><Plus size={13} /> New document</button>
            <button onClick={() => setGenOpen(true)} className="btn btn-ghost btn-sm w-full"><Sparkles size={13} /> Generate SOP</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && docs.length === 0 ? (
              Array.from({ length: 6 }).map((_, i) => (
                <div key={i} className="px-3 py-2.5 border-l-2 border-transparent space-y-1.5">
                  <div className="flex items-center gap-1.5">
                    <Skeleton className="h-3 w-3 rounded-sm shrink-0" />
                    <Skeleton className="h-3 flex-1" />
                    <Skeleton className="h-3.5 w-10 rounded-full" />
                  </div>
                  <Skeleton className="h-2.5 w-20" />
                </div>
              ))
            ) : docs.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground">No documents yet. Create one to start KeyPlayer&apos;s knowledge base.</div>
            ) : (
              docs.map((d) => (
                <button
                  key={d.id}
                  onClick={() => setActiveId(d.id)}
                  className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
                    activeId === d.id ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-[var(--surface-2)]'
                  }`}
                >
                  <div className="flex items-center gap-1.5">
                    <FileText size={12} className="text-muted-foreground shrink-0" />
                    <span className="text-xs font-medium truncate flex-1">{d.title || 'Untitled'}</span>
                    <span className={`badge ${d.type === 'sop' ? 'badge-info' : 'badge-neutral'} text-[9px] shrink-0`}>{typeLabel(d.type)}</span>
                  </div>
                  <div className="mt-0.5 flex items-center gap-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground">{ago(d.updated_at)} · v{d.version}</span>
                    {d.status === 'wiki' ? (
                      <span className="badge badge-success text-[9px] gap-0.5"><BadgeCheck size={9} /> Agents read this</span>
                    ) : (
                      <span className={`badge ${STATUS_BADGE[d.status]} text-[9px]`}>{STATUS_SHORT[d.status]}</span>
                    )}
                  </div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {!draft ? (
            activeId ? (
              <div className="flex-1 flex flex-col">
                <div className="flex items-center gap-2 p-3 border-b border-border/60">
                  <Skeleton className="h-5 flex-1" />
                  <Skeleton className="h-7 w-20 rounded-md" />
                  <Skeleton className="h-7 w-16 rounded-md" />
                </div>
                <div className="flex-1 p-4">
                  <SkeletonEditorBody />
                </div>
              </div>
            ) : (
              <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                Select or create a document
              </div>
            )
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 border-b border-border/60 flex-wrap">
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="flex-1 min-w-[8rem] text-sm font-semibold bg-transparent focus:outline-none"
                  placeholder="Document title"
                />
                {draft.status === 'wiki' && (
                  <span className="badge badge-success text-[10px] gap-1 shrink-0"><BadgeCheck size={11} /> Agents read this</span>
                )}
                {/* Readable VIEW ↔ markdown EDIT toggle */}
                <div className="inline-flex rounded-md border border-border overflow-hidden shrink-0" role="group" aria-label="View or edit">
                  <button
                    type="button"
                    onClick={() => setMode('view')}
                    aria-pressed={mode === 'view'}
                    className={`px-2.5 py-1 text-xs flex items-center gap-1 active:scale-[0.98] transition-transform duration-[var(--t-press)] ease-[var(--ease-out)] ${mode === 'view' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-[var(--surface-2)]'}`}
                  >
                    <Eye size={12} /> View
                  </button>
                  <button
                    type="button"
                    onClick={() => setMode('edit')}
                    aria-pressed={mode === 'edit'}
                    className={`px-2.5 py-1 text-xs flex items-center gap-1 border-l border-border active:scale-[0.98] transition-transform duration-[var(--t-press)] ease-[var(--ease-out)] ${mode === 'edit' ? 'bg-primary/10 text-primary' : 'text-muted-foreground hover:bg-[var(--surface-2)]'}`}
                  >
                    <PenLine size={12} /> Edit
                  </button>
                </div>
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as DocStatus })}
                  title="Draft = private. Active = your AI team reads this in every task. Archived = hidden."
                  className="px-2 py-1 rounded-md border border-border bg-background text-xs shrink-0"
                >
                  <option value="raw">Draft</option>
                  <option value="wiki">Active (agents read this)</option>
                  <option value="archived">Archived</option>
                </select>
                {activeId && <ExportMenu baseHref={`/api/documents/${activeId}/export`} />}
                <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                </button>
                <button onClick={remove} className="btn btn-ghost btn-sm text-destructive" title="Delete"><Trash2 size={14} /></button>
              </div>
              {mode === 'view' ? (
                <div className="flex-1 overflow-y-auto p-4">
                  <DocMarkdown content={draft.content} />
                </div>
              ) : (
                <textarea
                  value={draft.content}
                  onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                  onKeyDown={(e) => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
                  spellCheck={false}
                  className="flex-1 w-full resize-none p-4 font-mono text-[13px] leading-relaxed bg-transparent focus:outline-none"
                  placeholder="# Write markdown here…"
                />
              )}
              {error && <div className="px-4 pb-2 text-xs text-destructive">{error}</div>}
            </>
          )}
        </div>
      </div>
      )}

      {genOpen && <GenerateSopModal onClose={() => setGenOpen(false)} onCreated={handleGenerated} />}
    </div>
  );
}

// Compact, plain-English render of a document's markdown. Keeps the markdown as
// the download source (Export → .md stays byte-identical) while the reader sees
// formatted headings / bold / lists instead of raw ## and **. Client-safe: uses
// react-markdown directly because the /docs <Markdown> pulls in node:fs.
function DocMarkdown({ content }: { content: string }) {
  const body = (content ?? '').trim();
  if (!body) {
    return <div className="text-sm text-muted-foreground italic">This report is empty. Switch to Edit to add content.</div>;
  }
  return (
    <div className="max-w-3xl text-[13px] leading-relaxed text-foreground/90">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          h1: ({ children }) => <h1 className="text-lg font-semibold mt-0 mb-3 text-foreground">{children}</h1>,
          h2: ({ children }) => <h2 className="text-[15px] font-semibold mt-6 mb-2 text-foreground">{children}</h2>,
          h3: ({ children }) => <h3 className="text-[13px] font-semibold mt-4 mb-1.5 text-foreground">{children}</h3>,
          p: ({ children }) => <p className="my-2.5 leading-relaxed">{children}</p>,
          ul: ({ children }) => <ul className="my-2.5 ml-5 list-disc space-y-1 marker:text-muted-foreground">{children}</ul>,
          ol: ({ children }) => <ol className="my-2.5 ml-5 list-decimal space-y-1 marker:text-muted-foreground">{children}</ol>,
          li: ({ children }) => <li className="leading-relaxed pl-0.5">{children}</li>,
          strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
          em: ({ children }) => <em className="italic">{children}</em>,
          a: ({ href, children }) => <a href={href} target="_blank" rel="noreferrer noopener" className="text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary transition-[text-decoration-color] duration-[var(--t-press)]">{children}</a>,
          hr: () => <hr className="my-5 border-border/70" />,
          blockquote: ({ children }) => <blockquote className="my-3 border-l-2 border-primary/50 bg-accent/40 rounded-r-md py-1.5 pl-3 pr-2 text-foreground/80 [&>p]:my-1">{children}</blockquote>,
          code: ({ className, children }) => {
            const isBlock = /language-/.test(className ?? '');
            if (isBlock) return <code className="font-mono text-[12px] leading-relaxed">{children}</code>;
            return <code className="rounded bg-muted px-1 py-0.5 font-mono text-[0.85em] border border-border/60">{children}</code>;
          },
          pre: ({ children }) => <pre className="my-3 overflow-x-auto rounded-lg border border-border bg-[color-mix(in_srgb,var(--background)_60%,#000)] p-3 text-[12px]">{children}</pre>,
          table: ({ children }) => <div className="my-3 overflow-x-auto rounded-lg border border-border"><table className="w-full border-collapse text-[12px]">{children}</table></div>,
          thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
          tr: ({ children }) => <tr className="border-b border-border/60 last:border-0">{children}</tr>,
          th: ({ children }) => <th className="px-3 py-1.5 text-left font-semibold">{children}</th>,
          td: ({ children }) => <td className="px-3 py-1.5 align-top text-foreground/85">{children}</td>,
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

// One labelled field row for the Generate-SOP form.
function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] font-medium text-muted-foreground">
        {label}{required && <span className="text-destructive"> *</span>}
      </span>
      {children}
    </label>
  );
}

// Guided "describe the procedure → get a clean SOP" form. Generation is the
// tenant's BYO-Anthropic-key call (POST /api/documents/generate, owned by another
// agent); on a valid draft we persist through the EXISTING POST /api/documents as
// { type:'sop', status:'raw' } so the new report drops into the list for review.
function GenerateSopModal({ onClose, onCreated }: { onClose: () => void; onCreated: (doc: Doc) => void }) {
  // Keys mirror the route's SOPAnswers shape exactly (steps_outline, not steps) so the
  // raw form is POSTed straight to /api/documents/generate with no field remapping.
  const [form, setForm] = useState({ title: '', purpose: '', scope: '', audience: '', steps_outline: '', tools: '', notes: '' });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    if (!form.title.trim() || !form.purpose.trim()) {
      toast.error('Add a title and a purpose to generate an SOP.');
      return;
    }
    setBusy(true);
    try {
      const res = await fetch('/api/documents/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const json = await res.json().catch(() => ({} as Record<string, unknown>));
      if (!res.ok) {
        if (json?.error === 'connect_anthropic') {
          toast.error('Connect your Anthropic key in Connections to generate SOPs.');
        } else if (json?.error === 'missing_fields') {
          const fields = Array.isArray(json.fields) ? json.fields.join(', ') : 'required fields';
          toast.error(`Missing ${fields}.`);
        } else {
          toast.error('Could not generate the SOP. Please try again.');
        }
        return;
      }
      const draft = json.draft as { title?: string; markdown?: string } | undefined;
      if (!draft?.markdown) { toast.error('Generation returned no content. Please try again.'); return; }

      // Persist via the existing create endpoint so storage is unchanged.
      const createRes = await fetch('/api/documents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: (draft.title || form.title).trim(), content: draft.markdown, type: 'sop', status: 'raw' }),
      });
      const createJson = await createRes.json().catch(() => ({} as Record<string, unknown>));
      if (!createRes.ok || !createJson.document) { toast.error((createJson.error as string) || 'Could not save the SOP.'); return; }

      toast.success('SOP drafted — review it below, then set it Active when ready.');
      onCreated(createJson.document as Doc);
    } catch {
      toast.error('Could not generate the SOP. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <button type="button" aria-label="Close" className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div className="panel modal-surface relative w-full max-w-lg max-h-[90vh] overflow-y-auto" role="dialog" aria-modal="true" aria-labelledby="gen-sop-title">
        <div className="panel-header">
          <h2 id="gen-sop-title" className="text-sm font-medium flex items-center gap-2"><Sparkles size={15} className="text-primary" /> Generate SOP</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={16} /></button>
        </div>
        <form onSubmit={submit} className="panel-body space-y-3">
          <p className="text-xs text-muted-foreground">Describe the procedure and KeyPlayer drafts a clean, plain-English SOP you can review, edit, and export.</p>
          <Field label="Title" required>
            <input value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="e.g. Onboarding a new client" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
          </Field>
          <Field label="Purpose" required>
            <textarea value={form.purpose} onChange={(e) => set('purpose', e.target.value)} rows={2} placeholder="What is this SOP for? What outcome should it guarantee?" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Scope (optional)">
              <input value={form.scope} onChange={(e) => set('scope', e.target.value)} placeholder="When it applies / doesn't" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </Field>
            <Field label="Audience (optional)">
              <input value={form.audience} onChange={(e) => set('audience', e.target.value)} placeholder="Who follows it" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </Field>
          </div>
          <Field label="Steps outline (optional)">
            <textarea value={form.steps_outline} onChange={(e) => set('steps_outline', e.target.value)} rows={3} placeholder="Rough bullet steps — the AI expands and orders them" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm resize-none" />
          </Field>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Tools (optional)">
              <input value={form.tools} onChange={(e) => set('tools', e.target.value)} placeholder="Systems / apps involved" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </Field>
            <Field label="Notes (optional)">
              <input value={form.notes} onChange={(e) => set('notes', e.target.value)} placeholder="Anything else to include" className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm" />
            </Field>
          </div>
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="btn btn-ghost btn-sm">Cancel</button>
            <button type="submit" disabled={busy} className="btn btn-primary btn-sm">
              {busy ? <><Loader2 size={13} className="animate-spin" /> Generating…</> : <><Sparkles size={13} /> Generate</>}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

interface HealthData {
  documents: { total: number; raw: number; wiki: number; archived: number; duplicate_titles: number };
  kg: { entities: number; relations: number; low_confidence: number; duplicate_names: number; by_source: Array<{ source: string; c: number }> };
  memory: { rollups: number; last_rollup: string | null };
}

function Stat({ label, value, hint, warn }: { label: string; value: number | string; hint?: string; warn?: boolean }) {
  return (
    <div className="panel p-3">
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-2xl font-bold ${warn ? 'text-warning' : ''}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function SkeletonEditorBody() {
  return (
    <div className="space-y-2.5" aria-hidden="true">
      <Skeleton className="h-4 w-1/2" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-5/6" />
      <Skeleton className="h-3 w-2/3" />
      <Skeleton className="h-3 w-full" />
      <Skeleton className="h-3 w-3/4" />
    </div>
  );
}

function HealthSkeleton() {
  return (
    <div className="space-y-4">
      {Array.from({ length: 3 }).map((_, sec) => (
        <div key={sec}>
          <Skeleton className="h-3 w-32 mb-2" />
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {Array.from({ length: 4 }).map((__, i) => (
              <div key={i} className="panel p-3 space-y-2">
                <Skeleton className="h-2.5 w-16" />
                <Skeleton className="h-7 w-10" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function HealthView() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let on = true;
    fetch('/api/memory/health', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (on && j && !j.error) setData(j); })
      .finally(() => on && setLoading(false));
    return () => { on = false; };
  }, []);

  if (loading) return <HealthSkeleton />;
  if (!data) return <div className="panel p-8 text-sm text-muted-foreground">Couldn&apos;t load memory health.</div>;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Documents</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Total" value={data.documents.total} />
          <Stat label="Active" value={data.documents.wiki} hint="agents read these" />
          <Stat label="Draft" value={data.documents.raw} hint="staging" />
          <Stat label="Duplicate titles" value={data.documents.duplicate_titles} warn={data.documents.duplicate_titles > 0} hint="merge candidates" />
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Knowledge graph</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Entities" value={data.kg.entities} />
          <Stat label="Relations" value={data.kg.relations} />
          <Stat label="Low confidence" value={data.kg.low_confidence} warn={data.kg.low_confidence > 0} hint="< 0.6 — review" />
          <Stat label="Duplicate names" value={data.kg.duplicate_names} warn={data.kg.duplicate_names > 0} hint="dedupe candidates" />
        </div>
        {data.kg.by_source.length > 0 && (
          <div className="panel p-3 mt-3">
            <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-2">What each agent learned</div>
            <div className="space-y-1.5">
              {data.kg.by_source.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-xs">
                  <span>{s.source}</span>
                  <span className="font-mono text-muted-foreground">{s.c}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
      <div>
        <div className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Summarised history</div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label="Rollups" value={data.memory.rollups} />
          <Stat label="Last rollup" value={data.memory.last_rollup ? new Date(data.memory.last_rollup).toLocaleDateString() : '—'} />
        </div>
      </div>
    </div>
  );
}
