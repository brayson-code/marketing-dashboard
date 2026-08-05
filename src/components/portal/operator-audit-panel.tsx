'use client';

import { useCallback, useState } from 'react';
import { History, Loader2, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';
import { describe, type AuditRow } from '@/lib/operator-audit-catalog';

// What operators have actually done, in sentences.
//
// Collapsed by default: this is the thing you open when something is wrong, not
// something to scroll past every time you set a client up.
//
// Imports the CATALOG, never operator-audit.ts — that pulls in the DB client.

export function OperatorAuditPanel() {
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);

  // Fetched on the CLICK, not in an effect. Opening the panel is an event, not state
  // React needs synchronising with something external — and setState synchronously in
  // an effect body cascades renders. Most visits never open this at all, and it reads
  // across every workspace, so it should not run on mount either.
  const toggle = useCallback(async () => {
    const next = !open;
    setOpen(next);
    if (!next || loaded) return;
    setLoading(true);
    try {
      const res = await fetch('/api/operator-audit');
      const data = res.ok ? await res.json() : null;
      setRows(data?.entries ?? []);
    } catch {
      /* the empty state reads "nothing recorded yet"; a retry is one more click */
    } finally {
      setLoaded(true);
      setLoading(false);
    }
  }, [open, loaded]);

  return (
    <div className="panel overflow-hidden">
      <button
        onClick={toggle}
        className="w-full px-4 py-3 flex items-center gap-2 text-left"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={14} className="text-muted-foreground" />
              : <ChevronRight size={14} className="text-muted-foreground" />}
        <History size={14} className="text-[var(--primary)]" />
        <span className="text-sm font-semibold">What we&apos;ve done</span>
        <span className="text-xs text-muted-foreground">
          Every setup action, newest first
        </span>
      </button>

      {open && (
        <div className="px-4 pb-3">
          {loading ? (
            <p className="text-xs text-muted-foreground flex items-center gap-1.5 py-2">
              <Loader2 size={12} className="animate-spin" /> Loading…
            </p>
          ) : rows.length === 0 ? (
            <p className="text-xs text-muted-foreground py-2">Nothing recorded yet.</p>
          ) : (
            <div className="space-y-0.5">
              {rows.map(r => {
                const failed = r.detail?.ok === false;
                return (
                  <div
                    key={r.id}
                    className="py-1.5 border-b border-border/25 last:border-0 flex items-start gap-2"
                  >
                    {failed && (
                      <AlertTriangle size={11} className="mt-1 shrink-0" style={{ color: 'var(--destructive)' }} />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-xs" style={failed ? { color: 'var(--destructive)' } : undefined}>
                        {describe(r)}
                        {r.workspace && (
                          <span className="text-muted-foreground"> — {r.workspace}</span>
                        )}
                      </p>
                      <p className="text-[10px] text-muted-foreground">
                        {r.actor ?? 'someone'} · {new Date(r.ts).toLocaleString()}
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
