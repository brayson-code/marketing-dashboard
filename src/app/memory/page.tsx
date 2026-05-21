'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BrainCircuit, Plus, Save, Trash2, Loader2, FileText } from 'lucide-react';

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
    })();
    return () => { cancelled = true; };
  }, [activeId]);

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
      <div className="space-y-1">
        <h1 className="text-xl font-semibold flex items-center gap-2"><BrainCircuit size={18} className="text-primary" /> Memory</h1>
        <p className="text-xs text-muted-foreground">Edit and improve KeyPlayer&apos;s knowledge — markdown documents stored in Supabase.</p>
      </div>

      <div className="panel flex" style={{ height: 'calc(100vh - 220px)', minHeight: 460 }}>
        {/* Document list */}
        <div className="w-60 border-r border-border/60 flex flex-col shrink-0">
          <div className="p-2 border-b border-border/40">
            <button onClick={createDoc} className="btn btn-primary btn-sm w-full"><Plus size={13} /> New document</button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {loading && docs.length === 0 ? (
              <div className="p-4 text-xs text-muted-foreground flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> Loading…</div>
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
                    <span className={`badge ${STATUS_BADGE[d.status]} text-[9px]`}>{d.status}</span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mt-0.5 truncate">{ago(d.updated_at)} · v{d.version}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* Editor */}
        <div className="flex-1 flex flex-col min-w-0">
          {!draft ? (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              {activeId ? <span className="inline-flex items-center gap-2"><Loader2 size={14} className="animate-spin" /> Loading…</span> : 'Select or create a document'}
            </div>
          ) : (
            <>
              <div className="flex items-center gap-2 p-3 border-b border-border/60">
                <input
                  value={draft.title}
                  onChange={(e) => setDraft({ ...draft, title: e.target.value })}
                  className="flex-1 text-sm font-semibold bg-transparent focus:outline-none"
                  placeholder="Document title"
                />
                <select
                  value={draft.status}
                  onChange={(e) => setDraft({ ...draft, status: e.target.value as DocStatus })}
                  className="px-2 py-1 rounded-md border border-border bg-background text-xs"
                >
                  <option value="raw">raw</option>
                  <option value="wiki">wiki</option>
                  <option value="archived">archived</option>
                </select>
                <button onClick={save} disabled={saving} className="btn btn-primary btn-sm">
                  {saving ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />} Save
                </button>
                <button onClick={remove} className="btn btn-ghost btn-sm text-destructive" title="Delete"><Trash2 size={14} /></button>
              </div>
              <textarea
                value={draft.content}
                onChange={(e) => setDraft({ ...draft, content: e.target.value })}
                onKeyDown={(e) => { if (e.key === 's' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); save(); } }}
                spellCheck={false}
                className="flex-1 w-full resize-none p-4 font-mono text-[13px] leading-relaxed bg-transparent focus:outline-none"
                placeholder="# Write markdown here…"
              />
              {error && <div className="px-4 pb-2 text-xs text-destructive">{error}</div>}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
