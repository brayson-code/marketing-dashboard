'use client';

import { useCallback, useEffect, useState } from 'react';
import { Bug, X, GitPullRequest, Loader2, ShieldCheck, Slack, MessageSquare, ExternalLink, RefreshCw } from 'lucide-react';

type Status = 'triage' | 'assigned' | 'fix_proposed' | 'in_review' | 'resolved' | 'ignored';
type Level = 'error' | 'warning' | 'fatal';

interface Issue {
  id: string;
  title: string;
  level: Level;
  source: 'client' | 'server' | 'edge';
  status: Status;
  priority: 'low' | 'med' | 'high' | 'urgent';
  count: number;
  route: string | null;
  sample_stack: string | null;
  root_cause: string | null;
  suggested_fix: string | null;
  pr_url: string | null;
  assignee: string | null;
  first_seen: string;
  last_seen: string;
}

interface ErrorEvent {
  id: number;
  message: string;
  stack: string | null;
  component_stack: string | null;
  url: string | null;
  created_at: string;
}

interface Capabilities { github: boolean; slack: boolean; imessage: boolean }

const COLUMNS: { status: Status; label: string }[] = [
  { status: 'triage', label: 'Triage' },
  { status: 'assigned', label: 'Assigned' },
  { status: 'fix_proposed', label: 'Fix Proposed' },
  { status: 'in_review', label: 'In Review' },
  { status: 'resolved', label: 'Resolved' },
  { status: 'ignored', label: 'Ignored' },
];

const LEVEL_DOT: Record<Level, string> = { error: 'bg-orange-500', warning: 'bg-yellow-500', fatal: 'bg-red-600' };

function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

export default function IssuesPage() {
  const [issues, setIssues] = useState<Issue[]>([]);
  const [caps, setCaps] = useState<Capabilities>({ github: false, slack: false, imessage: false });
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/issues?limit=300', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      setIssues(Array.isArray(json.issues) ? json.issues : []);
      if (json.capabilities) setCaps(json.capabilities);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 8000);
    return () => clearInterval(id);
  }, [load]);

  const active = COLUMNS.filter((c) => c.status !== 'resolved' && c.status !== 'ignored');
  const archived = COLUMNS.filter((c) => c.status === 'resolved' || c.status === 'ignored');

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold flex items-center gap-2"><Bug size={18} className="text-primary" /> KeyWatch — Issues</h1>
          <p className="text-xs text-muted-foreground">Real-time errors, deduped. Assign the Fixer to open a draft PR.</p>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <CapBadge ok={caps.github} icon={<GitPullRequest size={11} />} label="GitHub PRs" envHint="GITHUB_TOKEN" />
          <CapBadge ok={caps.slack} icon={<Slack size={11} />} label="Slack" envHint="SLACK_WEBHOOK_URL" />
          <CapBadge ok={caps.imessage} icon={<MessageSquare size={11} />} label="iMessage" envHint="LOOPMESSAGE_AUTH_KEY" />
          <button className="btn btn-ghost btn-sm" onClick={() => load()}><RefreshCw size={12} /></button>
        </div>
      </div>

      {loading && issues.length === 0 ? (
        <div className="panel p-8 text-center text-sm text-muted-foreground flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" /> Loading issues…
        </div>
      ) : issues.length === 0 ? (
        <div className="panel p-8 text-center text-sm text-muted-foreground">
          <ShieldCheck size={20} className="mx-auto mb-2 text-success" />
          No issues captured. KeyWatch is watching client, server, and edge errors in real time.
        </div>
      ) : (
        <>
          <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${active.length}, minmax(180px, 1fr))` }}>
            {active.map((col) => (
              <Column key={col.status} label={col.label} issues={issues.filter((i) => i.status === col.status)} onSelect={setSelected} />
            ))}
          </div>
          <div className="grid gap-3 grid-cols-2">
            {archived.map((col) => (
              <Column key={col.status} label={col.label} issues={issues.filter((i) => i.status === col.status)} onSelect={setSelected} dim />
            ))}
          </div>
        </>
      )}

      {selected && <IssueDrawer id={selected} caps={caps} onClose={() => setSelected(null)} onChanged={load} />}
    </div>
  );
}

function CapBadge({ ok, icon, label, envHint }: { ok: boolean; icon: React.ReactNode; label: string; envHint: string }) {
  return (
    <span className={`badge inline-flex items-center gap-1 ${ok ? 'badge-success' : 'badge-neutral'}`} title={ok ? `${label} connected` : `Set ${envHint} to enable ${label}`}>
      {icon} {label}{!ok && ' ·off'}
    </span>
  );
}

function Column({ label, issues, onSelect, dim }: { label: string; issues: Issue[]; onSelect: (id: string) => void; dim?: boolean }) {
  return (
    <div className={`panel p-2 ${dim ? 'opacity-70' : ''}`}>
      <div className="flex items-center justify-between px-1 pb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
        <span>{label}</span>
        <span className="badge badge-neutral">{issues.length}</span>
      </div>
      <div className="space-y-2">
        {issues.map((i) => (
          <button key={i.id} onClick={() => onSelect(i.id)} className="w-full text-left rounded-lg border border-border/60 bg-[var(--surface-2)] p-2.5 hover:border-primary/50 transition-colors">
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[i.level]}`} />
              <span className="text-[10px] text-muted-foreground">{i.source}{i.route ? ` · ${i.route}` : ''}</span>
            </div>
            <div className="text-xs font-medium leading-snug line-clamp-2">{i.title}</div>
            <div className="flex items-center justify-between mt-1.5 text-[10px] text-muted-foreground">
              <span>seen {i.count}×</span>
              <span>{timeAgo(i.last_seen)}</span>
            </div>
            {i.pr_url && <div className="mt-1 text-[10px] text-primary inline-flex items-center gap-1"><GitPullRequest size={10} /> PR open</div>}
          </button>
        ))}
        {issues.length === 0 && <div className="px-1 py-3 text-[11px] text-muted-foreground/60">—</div>}
      </div>
    </div>
  );
}

function IssueDrawer({ id, caps, onClose, onChanged }: { id: string; caps: Capabilities; onClose: () => void; onChanged: () => void }) {
  const [issue, setIssue] = useState<Issue | null>(null);
  const [events, setEvents] = useState<ErrorEvent[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/issues/${id}`, { cache: 'no-store' });
    if (!res.ok) return;
    const json = await res.json();
    setIssue(json.issue);
    setEvents(Array.isArray(json.events) ? json.events : []);
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [load]);

  async function patch(body: Record<string, string>, tag: string) {
    setBusy(tag);
    try {
      await fetch(`/api/issues/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      await load();
      onChanged();
    } finally { setBusy(null); }
  }

  async function assign() {
    setBusy('assign');
    try {
      await fetch(`/api/issues/${id}/assign`, { method: 'POST' });
      await load();
      onChanged();
    } finally { setBusy(null); }
  }

  return (
    <div className="fixed inset-0 z-50 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40" />
      <div className="relative w-full max-w-xl h-full bg-[var(--background)] border-l border-border overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        {!issue ? (
          <div className="p-8 flex items-center gap-2 text-sm text-muted-foreground"><Loader2 size={14} className="animate-spin" /> Loading…</div>
        ) : (
          <div className="p-4 space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground mb-1">
                  <span className={`h-2 w-2 rounded-full ${LEVEL_DOT[issue.level]}`} /> {issue.level} · {issue.source}{issue.route ? ` · ${issue.route}` : ''} · seen {issue.count}×
                </div>
                <h2 className="text-sm font-semibold leading-snug">{issue.title}</h2>
              </div>
              <button onClick={onClose} className="btn btn-ghost btn-sm shrink-0"><X size={15} /></button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button onClick={assign} disabled={busy !== null || issue.status === 'assigned'} className="btn btn-primary btn-sm">
                {busy === 'assign' ? <Loader2 size={12} className="animate-spin" /> : <Bug size={12} />} Assign Fixer
              </button>
              {issue.pr_url && (
                <a href={issue.pr_url} target="_blank" rel="noreferrer" className="btn btn-ghost btn-sm">
                  <GitPullRequest size={12} /> View PR <ExternalLink size={11} />
                </a>
              )}
              <button onClick={() => patch({ status: 'resolved' }, 'resolve')} disabled={busy !== null} className="btn btn-ghost btn-sm">Resolve</button>
              <button onClick={() => patch({ status: 'ignored' }, 'ignore')} disabled={busy !== null} className="btn btn-ghost btn-sm">Ignore</button>
              <select
                value={issue.priority}
                onChange={(e) => patch({ priority: e.target.value }, 'priority')}
                className="px-2 py-1 rounded-md border border-border bg-background text-xs"
              >
                <option value="low">low</option><option value="med">med</option><option value="high">high</option><option value="urgent">urgent</option>
              </select>
            </div>

            {!caps.github && (
              <div className="panel p-2.5 text-[11px] text-muted-foreground">
                The Fixer will diagnose and save a proposed patch to this issue. Set <code className="text-foreground">GITHUB_TOKEN</code> + <code className="text-foreground">GITHUB_REPO</code> to have it open a draft PR automatically.
              </div>
            )}

            {issue.root_cause && (
              <Section title="Root cause"><p className="text-xs leading-relaxed whitespace-pre-wrap">{issue.root_cause}</p></Section>
            )}
            {issue.suggested_fix && (
              <Section title="Proposed fix"><pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-[var(--surface-2)] rounded-lg p-2.5 overflow-x-auto">{issue.suggested_fix}</pre></Section>
            )}
            {issue.sample_stack && (
              <Section title="Stack trace"><pre className="text-[11px] leading-relaxed whitespace-pre-wrap bg-[var(--surface-2)] rounded-lg p-2.5 overflow-x-auto max-h-72">{issue.sample_stack}</pre></Section>
            )}

            <Section title={`Recent occurrences (${events.length})`}>
              <div className="space-y-2">
                {events.map((e) => (
                  <div key={e.id} className="text-[11px] border border-border/50 rounded-lg p-2">
                    <div className="text-muted-foreground mb-1">{timeAgo(e.created_at)}{e.url ? ` · ${e.url}` : ''}</div>
                    <div className="font-medium break-words">{e.message}</div>
                  </div>
                ))}
                {events.length === 0 && <div className="text-[11px] text-muted-foreground">No event detail.</div>}
              </div>
            </Section>
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">{title}</div>
      {children}
    </div>
  );
}
