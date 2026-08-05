'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, UserCog, Plus, Trash2, KeyRound, Copy, Check, AlertTriangle,
} from 'lucide-react';

// Who at KeyPlayers can set clients up.
//
// Two separate facts about a person, shown separately because they fail separately:
//   • on the allow-list  → is permitted to use these surfaces
//   • has a login        → can actually sign in
// An allow-list entry with no login cannot reach anything: the middleware bounces anyone
// with no workspace to /no-workspace before Portal Admin is ever rendered. Showing them
// as one thing would make that a mystery.

interface Operator {
  email: string; note: string | null; created_at: string;
  has_login: boolean; workspace: string | null;
}

export function OperatorsPanel() {
  const [rows, setRows] = useState<Operator[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [link, setLink] = useState<{ email: string; url: string } | null>(null);
  const [copied, setCopied] = useState(false);

  const [email, setEmail] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/operators');
      if (!res.ok) throw new Error(String(res.status));
      setRows((await res.json()).operators ?? []);
    } catch {
      setError("Couldn't load the operator list.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/operators', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'That did not work.'); return null; }
      load();
      return data;
    } finally { setBusy(null); }
  };

  const add = async () => {
    if (!email.trim()) return;
    const ok = await post({ action: 'add', email: email.trim(), note: note.trim() || null }, 'add');
    if (ok) { setEmail(''); setNote(''); }
  };

  const createLogin = async (op: Operator) => {
    const data = await post({ action: 'login', email: op.email }, op.email);
    if (data?.grant?.link) { setLink({ email: op.email, url: data.grant.link }); setCopied(false); }
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* the link is on screen to copy by hand */ }
  };

  if (loading) {
    return (
      <div className="panel p-6 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={15} className="animate-spin" /> Loading operators…
      </div>
    );
  }

  return (
    <div className="panel p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <UserCog size={14} className="text-[var(--primary)]" /> Who can set clients up
        </p>
        <p className="text-xs text-muted-foreground max-w-prose">
          These people can reach Portal Admin and Industry Templates from their own
          workspace. It does not give them the engineering surfaces.
        </p>
      </div>

      {error && (
        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--destructive)' }}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {link && (
        <div className="rounded-lg p-3 text-xs space-y-1.5 bg-[var(--surface-2)]">
          <p className="font-medium">Sign-in link for {link.email}</p>
          <p className="text-muted-foreground">
            Send it to them yourself. It sets their password and expires.
          </p>
          <button onClick={copy} className="inline-flex items-center gap-1.5 text-[var(--primary)] font-medium">
            {copied ? <Check size={11} /> : <Copy size={11} />} {copied ? 'Copied' : 'Copy link'}
          </button>
        </div>
      )}

      <div className="space-y-1">
        {rows.map(op => (
          <div key={op.email} className="flex items-start gap-2 py-2 border-b border-border/30 last:border-0">
            <div className="flex-1 min-w-0">
              <p className="text-sm">{op.email}</p>
              <p className="text-[11px] text-muted-foreground">
                {op.note ?? 'No note'}
                {op.has_login
                  ? <span> · signs in to {op.workspace ?? 'their workspace'}</span>
                  : <span style={{ color: 'var(--warning)' }}> · no login yet</span>}
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {!op.has_login && (
                <button
                  onClick={() => createLogin(op)} disabled={busy === op.email}
                  className="text-[11px] font-medium inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border"
                  style={{ borderColor: 'var(--border)' }}
                >
                  {busy === op.email ? <Loader2 size={11} className="animate-spin" /> : <KeyRound size={11} />}
                  Create login
                </button>
              )}
              <button
                onClick={() => post({ action: 'remove', email: op.email }, op.email)}
                disabled={busy === op.email}
                className="text-muted-foreground hover:text-[var(--destructive)]"
                aria-label={`Remove ${op.email}`}
              >
                <Trash2 size={13} />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="flex gap-2 flex-wrap items-end pt-1">
        <label className="flex-1 min-w-[180px]">
          <span className="text-[11px] text-muted-foreground">Email</span>
          <input
            type="email" value={email} onChange={(e) => setEmail(e.target.value)}
            placeholder="name@keyplayershq.com"
            className="w-full mt-0.5 text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
          />
        </label>
        <label className="flex-1 min-w-[150px]">
          <span className="text-[11px] text-muted-foreground">Who they are</span>
          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Client Success"
            className="w-full mt-0.5 text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
          />
        </label>
        <button
          onClick={add} disabled={busy === 'add' || !email.trim()}
          className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white disabled:opacity-40"
          style={{ background: 'var(--primary)' }}
        >
          {busy === 'add' ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />} Add
        </button>
      </div>
    </div>
  );
}
