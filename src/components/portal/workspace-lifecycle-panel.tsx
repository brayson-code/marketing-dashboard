'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Loader2, Lock, Unlock, PauseCircle, PlayCircle, LogOut, Plus, Copy, Check,
  AlertTriangle, CalendarClock, BookOpen, Circle,
} from 'lucide-react';
import {
  STATUS_LABEL, STATUS_BLURB, ACTION_LABEL, ACTION_CONSEQUENCE, allowedActions,
  type WorkspaceStatus, type LifecycleAction,
} from '@/lib/workspace-lifecycle-catalog';
import { readiness, urgency } from '@/lib/readiness';

// Client Success's control over who can get into a workspace.
//
// Imports the CATALOG, never workspace-lifecycle.ts — the latter pulls in the DB client
// and the Supabase admin SDK, which would land in the browser bundle. tsc will not
// catch that; the split is the guard.
//
// Every action shows its consequence and asks again before firing. These buttons decide
// whether a paying client can reach their workspace, so the cost of one misclick is a
// real person locked out or let in before they have paid.

interface Row {
  id: string; name: string; status: WorkspaceStatus;
  provisioned_at: string | null; activated_at: string | null;
  go_live_on: string | null; status_note: string | null; members: number;
  captured_at: string | null; essentials_filled: number;
  has_assistant_name: boolean; has_start_date: boolean; has_assistant_login: boolean;
  agents: number; industry_agents: number;
}

const ESSENTIALS_TOTAL = 6;

function factsFor(w: Row) {
  return {
    status: w.status,
    capturedAt: w.captured_at,
    essentialsFilled: w.essentials_filled,
    essentialsTotal: ESSENTIALS_TOTAL,
    hasAssistantName: w.has_assistant_name,
    hasStartDate: w.has_start_date,
    members: w.members,
    hasAssistantLogin: w.has_assistant_login,
    goLiveOn: w.go_live_on,
  };
}
interface Grant { email: string; role: string; link: string | null; error?: string }

const STATUS_TONE: Record<WorkspaceStatus, string> = {
  provisioned: 'var(--warning)',
  active: 'var(--primary)',
  paused: 'var(--muted-foreground)',
  offboarded: 'var(--destructive)',
};

const ACTION_ICON: Record<LifecycleAction, typeof Lock> = {
  activate: Unlock, pause: PauseCircle, resume: PlayCircle, offboard: LogOut,
};

/** Actions that create logins, so they need email addresses before they can run. */
const NEEDS_EMAILS = new Set<LifecycleAction>(['activate', 'resume']);

export function WorkspaceLifecyclePanel() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [pending, setPending] = useState<{ row: Row; action: LifecycleAction } | null>(null);
  const [clientEmail, setClientEmail] = useState('');
  const [eaEmail, setEaEmail] = useState('');
  const [note, setNote] = useState('');
  const [grants, setGrants] = useState<Grant[] | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  // Early assistant access, offered only while a workspace is still closed.
  const [prepFor, setPrepFor] = useState<string | null>(null);
  const [prepEmail, setPrepEmail] = useState('');

  const [newName, setNewName] = useState('');
  const [newGoLive, setNewGoLive] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/lifecycle');
      if (!res.ok) throw new Error(String(res.status));
      const list: Row[] = (await res.json()).workspaces ?? [];
      // Live-and-unfinished first: a client is already using those, so they are the
      // ones costing something right now.
      setRows([...list].sort((a, b) => {
        const ua = urgency(factsFor(a), readiness(factsFor(a)));
        const ub = urgency(factsFor(b), readiness(factsFor(b)));
        return ua - ub || a.name.localeCompare(b.name);
      }));
    } catch {
      setError("Couldn't load workspaces.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const provision = async () => {
    if (!newName.trim()) return;
    setBusy(true);
    try {
      const res = await fetch('/api/lifecycle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'provision', name: newName.trim(), go_live_on: newGoLive || null }),
      });
      if (res.ok) { setNewName(''); setNewGoLive(''); load(); }
      else setError((await res.json()).error ?? 'Could not create the workspace.');
    } finally { setBusy(false); }
  };

  const run = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      const emails: Array<{ email: string; role: 'owner' | 'va' }> = [];
      if (NEEDS_EMAILS.has(pending.action)) {
        if (clientEmail.trim()) emails.push({ email: clientEmail.trim(), role: 'owner' });
        if (eaEmail.trim()) emails.push({ email: eaEmail.trim(), role: 'va' });
      }
      const res = await fetch('/api/lifecycle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: pending.action, tenant: pending.row.id, emails, note: note || null }),
      });
      const data = await res.json();
      if (res.ok) {
        setGrants(data.grants ?? null);
        setPending(null);
        setClientEmail(''); setEaEmail(''); setNote('');
        load();
      } else {
        setError(data.error ?? 'That did not work.');
        if (data.grants) setGrants(data.grants);
      }
    } finally { setBusy(false); }
  };

  const givePrep = async (row: Row) => {
    if (!prepEmail.trim()) return;
    setBusy(true);
    setError(null);
    try {
      // Read-only runs until day one. Without a date there is nothing to expire, so the
      // workspace's go-live is required rather than guessed at.
      const until = row.go_live_on ? `${row.go_live_on}T00:00:00Z` : '';
      if (!until) { setError('Set a day-one date on this workspace first.'); return; }
      const res = await fetch('/api/lifecycle', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'prep', tenant: row.id, email: prepEmail.trim(), until }),
      });
      const data = await res.json();
      if (res.ok) { setGrants(data.grants ?? null); setPrepFor(null); setPrepEmail(''); load(); }
      else setError(data.error ?? 'Could not give early access.');
    } finally { setBusy(false); }
  };

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(link);
      setTimeout(() => setCopied(null), 2000);
    } catch { /* the link is on screen to copy by hand */ }
  };

  if (loading) {
    return (
      <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={16} className="animate-spin" /> Loading workspaces…
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="panel p-4 space-y-3">
        <div>
          <p className="text-sm font-semibold">Workspaces</p>
          <p className="text-xs text-muted-foreground">
            Build a workspace on the onboarding call. It stays closed until you open it on day one.
          </p>
        </div>

        {error && (
          <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--destructive)' }}>
            <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
          </p>
        )}

        <div className="flex gap-2 flex-wrap items-end">
          <label className="flex-1 min-w-[180px]">
            <span className="text-[11px] text-muted-foreground">New workspace</span>
            <input
              value={newName} onChange={(e) => setNewName(e.target.value)}
              placeholder="Client's business name"
              className="w-full mt-0.5 text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
            />
          </label>
          <label>
            <span className="text-[11px] text-muted-foreground">Day one</span>
            <input
              type="date" value={newGoLive} onChange={(e) => setNewGoLive(e.target.value)}
              className="mt-0.5 block text-sm bg-[var(--surface-2)] border border-border rounded-lg px-2.5 py-1.5"
            />
          </label>
          <button
            onClick={provision} disabled={busy || !newName.trim()}
            className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white disabled:opacity-40"
            style={{ background: 'var(--primary)' }}
          >
            <Plus size={12} /> Build it
          </button>
        </div>
      </div>

      {/* Sign-in links land here after opening a workspace. Shown once — they're
          generated fresh each time, so there's nothing to lose by closing this. */}
      {grants && grants.length > 0 && (
        <div className="panel p-4 space-y-2">
          <p className="text-sm font-semibold">Sign-in links</p>
          {grants.map(g => (
            <div key={g.email} className="text-xs space-y-1 py-1.5 border-b border-border/30 last:border-0">
              <p className="font-medium">
                {g.email} <span className="text-muted-foreground font-normal">
                  · {g.role === 'va' ? 'assistant' : 'client'}
                </span>
              </p>
              {g.error ? (
                <p style={{ color: 'var(--destructive)' }}>{g.error}</p>
              ) : g.link ? (
                <button
                  onClick={() => copy(g.link!)}
                  className="inline-flex items-center gap-1.5 text-[var(--primary)] font-medium"
                >
                  {copied === g.link ? <Check size={11} /> : <Copy size={11} />}
                  {copied === g.link ? 'Copied' : 'Copy link'}
                </button>
              ) : (
                <p className="text-muted-foreground">Access granted. No link generated.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {rows.map(w => {
        const actions = allowedActions(w.status);
        return (
          <div key={w.id} className="panel p-4 space-y-2">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div className="min-w-0">
                <p className="text-sm font-semibold">{w.name}</p>
                <p className="text-[11px] flex items-center gap-1.5" style={{ color: STATUS_TONE[w.status] }}>
                  {w.status === 'active' ? <Unlock size={10} /> : <Lock size={10} />}
                  {STATUS_LABEL[w.status]}
                  <span className="text-muted-foreground">
                    · {w.members} {w.members === 1 ? 'person' : 'people'}
                  </span>
                </p>
                <p className="text-[11px] text-muted-foreground mt-0.5">{STATUS_BLURB[w.status]}</p>
                {w.go_live_on && w.status === 'provisioned' && (
                  <p className="text-[11px] mt-1 flex items-center gap-1" style={{ color: 'var(--warning)' }}>
                    <CalendarClock size={10} /> Opens {new Date(`${w.go_live_on}T12:00:00Z`).toLocaleDateString()}
                  </p>
                )}
                {w.status_note && (
                  <p className="text-[11px] text-muted-foreground mt-0.5 italic">{w.status_note}</p>
                )}

                {/* Ready for day one? Four steps in the order they actually happen.
                    Being OPEN deliberately does not count as ready — every live
                    workspace today is open with nothing in it, and a checklist that
                    agreed everything was fine would be worse than none. */}
                {(() => {
                  const r = readiness(factsFor(w));
                  return (
                    <div className="mt-2 space-y-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        {r.steps.map(step => (
                          <span
                            key={step.key}
                            title={step.detail ?? 'Done'}
                            className="text-[10px] px-1.5 py-0.5 rounded inline-flex items-center gap-1"
                            style={step.done
                              ? { color: 'var(--primary)', background: 'color-mix(in srgb, var(--primary) 10%, transparent)' }
                              : step.blocksGoodDayOne
                                ? { color: 'var(--warning)', background: 'color-mix(in srgb, var(--warning) 10%, transparent)' }
                                : { color: 'var(--muted-foreground)', background: 'var(--surface-2)' }}
                          >
                            {step.done ? <Check size={9} /> : <Circle size={9} />}
                            {step.label}
                          </span>
                        ))}
                      </div>
                      {r.nextAction && (
                        <p className="text-[11px]" style={{ color: 'var(--warning)' }}>
                          Next: {r.nextAction}
                        </p>
                      )}
                      {/* What the client will actually find on day one. Shown as a fact
                          rather than a checklist step: applying an industry roster is
                          not something Client Success can do yet, and a box nobody can
                          tick is worse than no box. */}
                      {w.agents > 0 && (
                        <p className="text-[11px] text-muted-foreground">
                          {w.agents} agents
                          {w.industry_agents > 0
                            ? ` · ${w.industry_agents} industry-tuned`
                            : ' · none industry-tuned'}
                        </p>
                      )}
                    </div>
                  );
                })()}
              </div>

              <div className="flex gap-1.5 flex-wrap shrink-0">
                {w.status === 'provisioned' && (
                  <button
                    onClick={() => { setPrepFor(prepFor === w.id ? null : w.id); setPending(null); setError(null); }}
                    className="text-[11px] font-medium inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border"
                    style={{ borderColor: 'var(--border)', color: 'var(--foreground)' }}
                  >
                    <BookOpen size={11} /> Assistant, read-only
                  </button>
                )}
                {actions.map(a => {
                  const Icon = ACTION_ICON[a];
                  const destructive = a === 'offboard';
                  return (
                    <button
                      key={a}
                      onClick={() => { setPending({ row: w, action: a }); setGrants(null); setError(null); }}
                      className="text-[11px] font-medium inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border"
                      style={destructive
                        ? { borderColor: 'var(--destructive)', color: 'var(--destructive)' }
                        : { borderColor: 'var(--border)', color: 'var(--foreground)' }}
                    >
                      <Icon size={11} /> {ACTION_LABEL[a]}
                    </button>
                  );
                })}
              </div>
            </div>

            {prepFor === w.id && (
              <div className="rounded-lg p-3 space-y-2.5 mt-1 bg-[var(--surface-2)]">
                <p className="text-xs">
                  <strong>Early access for the assistant.</strong> They can read
                  everything captured about this client but cannot act on anything until
                  day one. The workspace stays closed to the client.
                </p>
                <div className="flex gap-2 flex-wrap items-end">
                  <label className="flex-1 min-w-[200px]">
                    <span className="text-[11px] text-muted-foreground">Assistant&apos;s email</span>
                    <input
                      type="email" value={prepEmail} onChange={(e) => setPrepEmail(e.target.value)}
                      className="w-full mt-0.5 text-sm bg-[var(--surface)] border border-border rounded-lg px-2.5 py-1.5"
                    />
                  </label>
                  <button
                    onClick={() => givePrep(w)} disabled={busy || !prepEmail.trim()}
                    className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-2 rounded-lg text-white disabled:opacity-40"
                    style={{ background: 'var(--primary)' }}
                  >
                    {busy && <Loader2 size={11} className="animate-spin" />}
                    Give read-only access
                  </button>
                  <button onClick={() => setPrepFor(null)} className="text-xs text-muted-foreground px-2 py-2">
                    Cancel
                  </button>
                </div>
                {!w.go_live_on && (
                  <p className="text-[11px]" style={{ color: 'var(--warning)' }}>
                    This workspace has no day-one date, so there is nothing for read-only
                    access to expire on. Set one first.
                  </p>
                )}
              </div>
            )}

            {/* Confirm inline rather than in a modal — the workspace it applies to stays
                visible, so you can't confirm against the wrong one. */}
            {pending?.row.id === w.id && (
              <div
                className="rounded-lg p-3 space-y-2.5 mt-1"
                style={{ background: 'color-mix(in srgb, var(--warning) 8%, transparent)' }}
              >
                <p className="text-xs">
                  <strong>{ACTION_LABEL[pending.action]}</strong> — {ACTION_CONSEQUENCE[pending.action]}
                </p>

                {pending.action === 'activate' && (
                  <p className="text-xs text-muted-foreground">
                    They will find <strong>{w.agents} agents</strong> waiting for them
                    {w.industry_agents > 0
                      ? `, ${w.industry_agents} of them tuned to their industry.`
                      : ', none of them tuned to their industry.'}
                  </p>
                )}

                {NEEDS_EMAILS.has(pending.action) && (
                  <div className="grid gap-2 sm:grid-cols-2">
                    <label>
                      <span className="text-[11px] text-muted-foreground">Client&apos;s email</span>
                      <input
                        type="email" value={clientEmail} onChange={(e) => setClientEmail(e.target.value)}
                        className="w-full mt-0.5 text-sm bg-[var(--surface)] border border-border rounded-lg px-2.5 py-1.5"
                      />
                    </label>
                    <label>
                      <span className="text-[11px] text-muted-foreground">Assistant&apos;s email (optional)</span>
                      <input
                        type="email" value={eaEmail} onChange={(e) => setEaEmail(e.target.value)}
                        className="w-full mt-0.5 text-sm bg-[var(--surface)] border border-border rounded-lg px-2.5 py-1.5"
                      />
                    </label>
                  </div>
                )}

                <input
                  value={note} onChange={(e) => setNote(e.target.value)}
                  placeholder="Note (why — the next person to look will want to know)"
                  className="w-full text-sm bg-[var(--surface)] border border-border rounded-lg px-2.5 py-1.5"
                />

                <div className="flex gap-2">
                  <button
                    onClick={run} disabled={busy}
                    className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
                    style={{ background: pending.action === 'offboard' ? 'var(--destructive)' : 'var(--primary)' }}
                  >
                    {busy && <Loader2 size={11} className="animate-spin" />}
                    Yes, {ACTION_LABEL[pending.action].toLowerCase()}
                  </button>
                  <button
                    onClick={() => { setPending(null); setNote(''); }}
                    className="text-xs text-muted-foreground px-2"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
