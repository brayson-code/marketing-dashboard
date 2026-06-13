'use client';

import { useEffect, useState } from 'react';
import { MessageSquare, Inbox, Loader2, Paperclip } from 'lucide-react';

interface Message {
  id: number;
  text: string;
  created_at: string;
  attachments: unknown;
  status: string | null;
}

interface Conversation {
  sender: string;
  messages: Message[];
  latest_at: string;
}

// Engagement inbox lane for SMS/iMessage (boardroom_messages, direction='in').
// Read-only v1: displays inbound conversations grouped by sender, newest
// conversation first, messages shown oldest-to-newest within each thread.
// Mirrors the Email lane idiom — panel + auto-refresh + connected/empty states.
export function MessagesInbox() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        const r = await fetch('/api/engagement/messages', { cache: 'no-store' });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = await r.json();
        if (cancel) return;
        setConversations(Array.isArray(j.conversations) ? j.conversations : []);
        setError(null);
        // Auto-expand the first conversation (most recent) on initial load.
        if (!cancel && j.conversations?.length) {
          setExpanded((prev) => {
            if (prev.size === 0) return new Set([j.conversations[0].sender]);
            return prev;
          });
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

  const toggleExpand = (sender: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(sender)) next.delete(sender);
      else next.add(sender);
      return next;
    });
  };

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <MessageSquare size={14} className="text-[#10b981]" />
        <h3 className="section-title">Messages</h3>
        <span className="text-micro text-muted-foreground">SMS / iMessage · auto-refresh 60s</span>
      </div>
      <div className="panel-body space-y-2.5">
        {loading && conversations.length === 0 ? (
          <div className="py-8 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading messages…
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : conversations.length === 0 ? (
          <div className="py-8 text-center text-small flex flex-col items-center gap-2">
            <Inbox size={20} className="opacity-40" />
            No inbound SMS or iMessages yet. Replies to your agents&rsquo; outreach show up here.
          </div>
        ) : (
          conversations.map((conv) => {
            const isOpen = expanded.has(conv.sender);
            const latest = conv.messages[conv.messages.length - 1];
            return (
              <div
                key={conv.sender}
                className="rounded-lg border border-border/50 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] overflow-hidden"
              >
                {/* Conversation header — click to expand/collapse */}
                <button
                  type="button"
                  className="w-full flex items-start gap-3 p-3 text-left hover:bg-muted/20 transition-colors duration-150"
                  onClick={() => toggleExpand(conv.sender)}
                >
                  <span
                    className="w-7 h-7 rounded-full grid place-items-center shrink-0 mt-0.5"
                    style={{ background: 'color-mix(in srgb, #10b981 16%, transparent)', color: '#10b981' }}
                  >
                    <MessageSquare size={13} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-semibold truncate">{conv.sender}</span>
                      <span className="text-micro text-muted-foreground">{relTime(conv.latest_at)}</span>
                      <span className="ml-auto text-micro text-muted-foreground">
                        {conv.messages.length} {conv.messages.length === 1 ? 'msg' : 'msgs'}
                      </span>
                    </div>
                    {!isOpen && latest && (
                      <div className="text-xs mt-0.5 truncate text-muted-foreground">
                        {latest.text}
                      </div>
                    )}
                  </div>
                  <span className="text-muted-foreground text-[10px] shrink-0 self-center ml-1">
                    {isOpen ? '▲' : '▼'}
                  </span>
                </button>

                {/* Expanded thread */}
                {isOpen && (
                  <div className="px-3 pb-3 space-y-2 border-t border-border/30">
                    {conv.messages.map((m) => (
                      <div key={m.id} className="mt-2 pl-10">
                        <div className="flex items-center gap-2 mb-0.5">
                          <span className="text-micro text-muted-foreground">{relTime(m.created_at)}</span>
                          {m.status && m.status !== 'received' && (
                            <span className="text-micro text-muted-foreground opacity-60">{m.status}</span>
                          )}
                        </div>
                        <div className="text-xs whitespace-pre-wrap leading-relaxed bg-[var(--surface-1)] rounded-lg px-3 py-2">
                          {m.text || <span className="text-muted-foreground italic">(empty)</span>}
                        </div>
                        {hasAttachments(m.attachments) && (
                          <div className="mt-1 flex items-center gap-1 text-micro text-muted-foreground">
                            <Paperclip size={10} />
                            {attachmentCount(m.attachments)} attachment{attachmentCount(m.attachments) !== 1 ? 's' : ''}
                          </div>
                        )}
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

function hasAttachments(a: unknown): boolean {
  return Array.isArray(a) && a.length > 0;
}

function attachmentCount(a: unknown): number {
  return Array.isArray(a) ? a.length : 0;
}
