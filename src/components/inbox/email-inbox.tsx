'use client';

import { useEffect, useState } from 'react';
import { Mail, Sparkles, Loader2, CheckCircle2, Inbox, Send, Pencil } from 'lucide-react';

interface InboundMessage {
  id: number; account_id: string; message_id: string; from_addr: string;
  to_addr: string | null; subject: string | null; body_text: string | null;
  received_at: number; replied: boolean; draft_id: number | null;
}

// Email triage lane (AgentMail). Lists inbound emails to the tenant's inboxes;
// each is one click from an outreach-sender drafted reply that lands in /drafts.
// Approving there sends it back out threaded, through the tenant's own AgentMail
// account. Same pattern as the YouTube/IG comment lanes, for email.
export function EmailInbox() {
  const [messages, setMessages] = useState<InboundMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Per-message reply state: the drafted reply id + preview so the owner can
  // approve + send the reply WITHOUT leaving Engagement (1 click).
  type RowState = { state: 'idle' | 'drafting' | 'drafted' | 'sending' | 'sent'; draftId?: number; preview?: string };
  const [rowState, setRowState] = useState<Record<number, RowState>>({});

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const r = await fetch('/api/integrations/agentmail/messages?max=30', { cache: 'no-store' });
        const j = await r.json();
        if (cancel) return;
        setConnected(!!j.connected);
        setError(j.error ?? null);
        setMessages(Array.isArray(j.messages) ? j.messages : []);
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

  const draftReply = async (m: InboundMessage) => {
    setRowState((s) => ({ ...s, [m.id]: { state: 'drafting' } }));
    try {
      const r = await fetch(`/api/integrations/agentmail/messages/${m.id}/draft-reply`, { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error ?? `Draft failed (${r.status})`);
      setRowState((s) => ({ ...s, [m.id]: { state: 'drafted', draftId: j.draft_id, preview: j.preview } }));
    } catch (e) {
      setRowState((s) => ({ ...s, [m.id]: { state: 'idle' } }));
      setError((e as Error).message);
    }
  };

  // 1-click approve + send, straight from the Engagement view — approve the
  // draft, then execute the 'send' action (routes through AgentMail, threaded).
  const approveSend = async (id: number, draftId: number) => {
    setRowState((s) => ({ ...s, [id]: { ...s[id], state: 'sending' } }));
    try {
      const approve = await fetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve', draft_id: draftId }),
      });
      if (!approve.ok) throw new Error('approve failed');
      const send = await fetch('/api/drafts', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'send', draft_id: draftId }),
      });
      const j = await send.json().catch(() => ({}));
      if (!send.ok) throw new Error(j.error ?? 'send failed');
      setRowState((s) => ({ ...s, [id]: { ...s[id], state: 'sent' } }));
    } catch (e) {
      setRowState((s) => ({ ...s, [id]: { ...s[id], state: 'drafted' } }));
      setError((e as Error).message);
    }
  };

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Mail size={14} className="text-[#6366f1]" />
        <h3 className="section-title">Email inbox</h3>
        <span className="text-micro text-muted-foreground">AgentMail · auto-refresh 60s</span>
      </div>
      <div className="panel-body space-y-2.5">
        {loading && messages.length === 0 ? (
          <div className="py-8 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading email…
          </div>
        ) : connected === false ? (
          <div className="py-6 text-center text-small">
            AgentMail not connected. Add your API key in <a href="/connections" className="underline">Connections</a>, then spawn an inbox from Outreach.
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : messages.length === 0 ? (
          <div className="py-8 text-center text-small flex flex-col items-center gap-2">
            <Inbox size={20} className="opacity-40" />
            No inbound email yet. Replies to your agents&rsquo; outreach show up here.
          </div>
        ) : (
          messages.map((m) => {
            const rs: RowState = m.replied ? { state: 'sent' } : (rowState[m.id] ?? { state: 'idle' });
            return (
              <div key={m.id} className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-3 flex items-start gap-3">
                <span className="w-7 h-7 rounded-full grid place-items-center shrink-0"
                  style={{ background: 'color-mix(in srgb, #6366f1 16%, transparent)', color: '#6366f1' }}>
                  <Mail size={13} />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold truncate">{m.from_addr}</span>
                    <span className="text-micro text-muted-foreground">{relTime(m.received_at)}</span>
                  </div>
                  {m.subject && <div className="text-[11px] font-medium mt-0.5 truncate">{m.subject}</div>}
                  <div className="text-xs mt-1 whitespace-pre-wrap leading-relaxed line-clamp-4 text-muted-foreground">{m.body_text}</div>
                  <div className="mt-2">
                    {rs.state === 'sent' ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-[var(--primary)]">
                        <CheckCircle2 size={12} /> Reply sent
                      </span>
                    ) : rs.state === 'drafting' ? (
                      <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Loader2 size={12} className="animate-spin" /> Drafting reply…
                      </span>
                    ) : (rs.state === 'drafted' || rs.state === 'sending') ? (
                      <div className="space-y-2">
                        {rs.preview && (
                          <div className="text-[11px] text-foreground/85 whitespace-pre-wrap leading-relaxed rounded-md border border-border/50 bg-[var(--surface-1)] p-2 max-h-44 overflow-y-auto">
                            {rs.preview}
                          </div>
                        )}
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => rs.draftId != null && approveSend(m.id, rs.draftId)}
                            disabled={rs.state === 'sending' || rs.draftId == null}
                            className="btn btn-primary btn-sm inline-flex items-center gap-1"
                          >
                            {rs.state === 'sending' ? <Loader2 size={12} className="animate-spin" /> : <Send size={12} />} Approve &amp; send
                          </button>
                          {rs.draftId != null && (
                            <a href={`/drafts#draft-${rs.draftId}`} className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground underline">
                              <Pencil size={11} /> Edit in Drafts
                            </a>
                          )}
                        </div>
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => draftReply(m)}
                        className="inline-flex items-center gap-1.5 text-[11px] font-medium rounded px-2 py-1 border border-border/60 hover:bg-muted/30"
                      >
                        <Sparkles size={11} /> Draft reply
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

function relTime(epochSec: number): string {
  if (!epochSec) return '';
  const s = Math.max(1, Math.floor(Date.now() / 1000 - epochSec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}
