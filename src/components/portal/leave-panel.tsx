'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarRange, Loader2, Check, X, AlertTriangle, Plane, HeartPulse, ShieldAlert,
} from 'lucide-react';
import {
  workingDays, remaining, checkRequest,
  type LeaveRequest,
} from '@/lib/leave-catalog';
import { ENTITLEMENTS, type LeaveKind } from '@/lib/service-policy';

// Requesting and approving time off.
//
// The assistant asks; the client decides. Both see the same list, because the assistant
// needs to know where a request got to and the client needs to see what they agreed to.
//
// Imports the CATALOG, never leave.ts — that pulls in the DB client.

const ICON: Record<LeaveKind, typeof Plane> = {
  vacation: Plane, sick: HeartPulse, emergency: ShieldAlert,
};

const STATUS_TONE: Record<string, string> = {
  pending: 'var(--warning)',
  approved: 'var(--primary)',
  declined: 'var(--destructive)',
  cancelled: 'var(--muted-foreground)',
};

function fmt(iso: string) {
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function LeavePanel({
  isVa,
  workingDayNames,
  accrued,
  inProbation,
}: {
  isVa: boolean;
  workingDayNames: string[];
  /** Days accrued per kind, from the same accrual the page already computed. */
  accrued: Record<LeaveKind, number>;
  inProbation: boolean;
}) {
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [kind, setKind] = useState<LeaveKind>('vacation');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/leave');
      if (res.ok) setRequests((await res.json()).requests ?? []);
    } catch { /* the empty state is honest enough */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const today = new Date().toISOString().slice(0, 10);
  const days = useMemo(
    () => (from && to ? workingDays(from, to, workingDayNames) : 0),
    [from, to, workingDayNames],
  );
  const left = useMemo(
    () => remaining({ accrued: accrued[kind] ?? 0, requests, kind }),
    [accrued, kind, requests],
  );
  const check = useMemo(
    () => (days > 0 ? checkRequest({ days, startsOn: from, inProbation, remaining: left, today }) : null),
    [days, from, inProbation, left, today],
  );

  const post = async (body: Record<string, unknown>, key: string) => {
    setBusy(key);
    setError(null);
    try {
      const res = await fetch('/api/leave', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.error ?? 'That did not work.'); return false; }
      await load();
      return true;
    } finally { setBusy(null); }
  };

  const submit = async () => {
    const ok = await post({ action: 'request', kind, starts_on: from, ends_on: to, note: note || null }, 'new');
    if (ok) { setFrom(''); setTo(''); setNote(''); }
  };

  const pending = requests.filter(r => r.status === 'pending');
  const decided = requests.filter(r => r.status !== 'pending');

  if (loading) return null;

  return (
    <div className="panel p-4 space-y-3">
      <div>
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <CalendarRange size={14} className="text-[var(--primary)]" /> Time off
        </p>
        <p className="text-xs text-muted-foreground">
          {isVa
            ? 'Request time off here so it is on the record, not just in a chat.'
            : 'Requests from your assistant. Approving one puts it on the record.'}
        </p>
      </div>

      {error && (
        <p className="text-xs flex items-start gap-1.5" style={{ color: 'var(--destructive)' }}>
          <AlertTriangle size={12} className="mt-0.5 shrink-0" /> {error}
        </p>
      )}

      {isVa && (
        <div className="rounded-lg bg-[var(--surface-2)] p-3 space-y-2">
          <div className="grid gap-2 sm:grid-cols-3">
            <label>
              <span className="text-[11px] text-muted-foreground">Type</span>
              <select
                value={kind} onChange={(e) => setKind(e.target.value as LeaveKind)}
                className="w-full mt-0.5 text-sm bg-[var(--surface)] border border-border rounded-lg px-2 py-1.5"
              >
                {ENTITLEMENTS.map(e => (
                  <option key={e.kind} value={e.kind}>{e.label}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="text-[11px] text-muted-foreground">From</span>
              <input
                type="date" value={from} min={today} onChange={(e) => setFrom(e.target.value)}
                className="w-full mt-0.5 text-sm bg-[var(--surface)] border border-border rounded-lg px-2 py-1.5"
              />
            </label>
            <label>
              <span className="text-[11px] text-muted-foreground">To</span>
              <input
                type="date" value={to} min={from || today} onChange={(e) => setTo(e.target.value)}
                className="w-full mt-0.5 text-sm bg-[var(--surface)] border border-border rounded-lg px-2 py-1.5"
              />
            </label>
          </div>

          <input
            value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="Anything they should know (optional)"
            className="w-full text-sm bg-[var(--surface)] border border-border rounded-lg px-2.5 py-1.5"
          />

          {/* Say what this costs BEFORE they send it, not after it is declined. */}
          {days > 0 && (
            <p className="text-xs">
              {days} working {days === 1 ? 'day' : 'days'} ·{' '}
              <span className="text-muted-foreground">{left} accrued and unused</span>
            </p>
          )}
          {check?.error && (
            <p className="text-xs" style={{ color: 'var(--destructive)' }}>{check.error}</p>
          )}
          {check?.warning && (
            <p className="text-xs" style={{ color: 'var(--warning)' }}>{check.warning}</p>
          )}

          <button
            onClick={submit}
            disabled={busy === 'new' || !check?.ok}
            className="text-xs font-medium inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-white disabled:opacity-40"
            style={{ background: 'var(--primary)' }}
          >
            {busy === 'new' && <Loader2 size={11} className="animate-spin" />}
            Request it
          </button>
        </div>
      )}

      {pending.length === 0 && decided.length === 0 ? (
        <p className="text-xs text-muted-foreground">Nothing requested yet.</p>
      ) : (
        <div className="space-y-1">
          {[...pending, ...decided].map(r => {
            const Icon = ICON[r.kind] ?? Plane;
            return (
              <div key={r.id} className="flex items-start gap-2 py-1.5 border-b border-border/25 last:border-0">
                <Icon size={12} className="mt-1 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs">
                    {fmt(r.starts_on)}{r.ends_on !== r.starts_on && ` – ${fmt(r.ends_on)}`}
                    <span className="text-muted-foreground"> · {r.days} {r.days === 1 ? 'day' : 'days'}</span>
                    {r.unpaid && <span style={{ color: 'var(--warning)' }}> · unpaid</span>}
                  </p>
                  {r.note && <p className="text-[11px] text-muted-foreground">{r.note}</p>}
                  <p className="text-[11px]" style={{ color: STATUS_TONE[r.status] }}>
                    {r.status}
                    {r.decided_by && ` by ${r.decided_by}`}
                    {!isVa && r.requester_email && r.status === 'pending' && ` · ${r.requester_email}`}
                  </p>
                </div>

                {r.status === 'pending' && (
                  <div className="flex gap-1 shrink-0">
                    {/* Only the client decides; only the requester withdraws. The API
                        enforces both against the live session. */}
                    {!isVa ? (
                      <>
                        <button
                          onClick={() => post({ action: 'approve', id: r.id }, r.id)}
                          disabled={busy === r.id}
                          className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
                          style={{ borderColor: 'var(--primary)', color: 'var(--primary)' }}
                        >
                          <Check size={10} /> Approve
                        </button>
                        <button
                          onClick={() => post({ action: 'decline', id: r.id }, r.id)}
                          disabled={busy === r.id}
                          className="text-[11px] px-2 py-1 rounded-lg border inline-flex items-center gap-1"
                          style={{ borderColor: 'var(--border)', color: 'var(--muted-foreground)' }}
                        >
                          <X size={10} /> Decline
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => post({ action: 'cancel', id: r.id }, r.id)}
                        disabled={busy === r.id}
                        className="text-[11px] text-muted-foreground px-2 py-1"
                      >
                        Withdraw
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
