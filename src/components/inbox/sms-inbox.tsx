'use client';

import { useEffect, useState } from 'react';
import { Smartphone, Inbox, Loader2 } from 'lucide-react';

interface SmsMsg {
  id: number;
  direction: 'in' | 'out';
  body: string;
  created_at: string;
}
interface Thread {
  contact: string;
  messages: SmsMsg[];
  latest_at: string;
}

// Engagement lane for Twilio SMS — inbound + outbound threaded by contact
// number (source: sms_messages, NOT the Boardroom). Mirrors the Messages lane.
export function SmsInbox() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const r = await fetch('/api/engagement/sms', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancel) return;
        setThreads(Array.isArray(j.conversations) ? j.conversations : []);
        setError(null);
        if (j.conversations?.length) {
          setExpanded((prev) => (prev.size === 0 ? new Set([j.conversations[0].contact]) : prev));
        }
      } catch (e) {
        if (!cancel) setError((e as Error).message);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 60_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  const toggle = (c: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(c)) next.delete(c); else next.add(c);
      return next;
    });

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Smartphone size={14} className="text-[#7c3aed]" />
        <h3 className="section-title">SMS</h3>
        <span className="text-micro text-muted-foreground">Twilio · inbound + sent · auto-refresh 60s</span>
      </div>
      <div className="panel-body space-y-2.5">
        {loading && threads.length === 0 ? (
          <div className="py-8 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading SMS…
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : threads.length === 0 ? (
          <div className="py-8 text-center text-small flex flex-col items-center gap-2">
            <Inbox size={20} className="opacity-40" />
            No SMS yet. Texts your agents send and replies you receive show up here.
          </div>
        ) : (
          threads.map((t) => {
            const isOpen = expanded.has(t.contact);
            const latest = t.messages[t.messages.length - 1];
            return (
              <div
                key={t.contact}
                className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] overflow-hidden"
              >
                <button
                  type="button"
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/20 transition-colors duration-150"
                  onClick={() => toggle(t.contact)}
                >
                  <span
                    className="w-7 h-7 rounded-full grid place-items-center shrink-0 mt-0.5"
                    style={{ background: 'color-mix(in srgb, #7c3aed 16%, transparent)', color: '#7c3aed' }}
                  >
                    <Smartphone size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold truncate">{t.contact}</span>
                      <span className="text-micro text-muted-foreground">{relTime(t.latest_at)}</span>
                      <span className="ml-auto text-micro text-muted-foreground">
                        {t.messages.length} {t.messages.length === 1 ? 'msg' : 'msgs'}
                      </span>
                    </div>
                    {!isOpen && latest && (
                      <div className="text-xs mt-0.5 truncate text-muted-foreground">
                        {latest.direction === 'out' ? 'You: ' : ''}{latest.body}
                      </div>
                    )}
                  </div>
                  <span className="text-muted-foreground text-[10px] shrink-0 self-center ml-1">{isOpen ? '▲' : '▼'}</span>
                </button>
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border/30">
                    {t.messages.map((m) => (
                      <div key={m.id} className={`mt-2 ${m.direction === 'out' ? 'pl-16 pr-1' : 'pl-10 pr-7'}`}>
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-micro text-muted-foreground">
                            {m.direction === 'out' ? 'Sent' : 'Received'} · {relTime(m.created_at)}
                          </span>
                        </div>
                        <div
                          className="text-xs whitespace-pre-wrap leading-relaxed rounded-lg px-3 py-2"
                          style={m.direction === 'out'
                            ? { background: 'color-mix(in srgb, #7c3aed 14%, transparent)' }
                            : { background: 'var(--surface-1)' }}
                        >
                          {m.body || <span className="text-muted-foreground italic">(empty)</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function relTime(iso: string): string {
  if (!iso) return '';
  const epochSec = Math.floor(new Date(iso).getTime() / 1000);
  const s = Math.max(1, Math.floor(Date.now() / 1000 - epochSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
