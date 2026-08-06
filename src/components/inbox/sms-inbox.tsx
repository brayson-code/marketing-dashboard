'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Smartphone, Send, Inbox, Loader2, AlertCircle, Plus, UserPlus, X } from 'lucide-react';

// ─── Types ───────────────────────────────────────────────────────────────────

interface SmsMsg {
  id: number;
  direction: 'in' | 'out';
  channel?: 'sms' | 'imessage';
  body: string;
  created_at: string;
}

interface Thread {
  contact: string;
  messages: SmsMsg[];
  latest_at: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  if (!iso) return '';
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

function formatTime(iso: string): string {
  if (!iso) return '';
  return new Date(iso).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

// ─── Left pane: contact list ──────────────────────────────────────────────────

interface ContactRowProps {
  thread: Thread;
  selected: boolean;
  onSelect: () => void;
  displayName?: string;
}

function ContactRow({ thread, selected, onSelect, displayName }: ContactRowProps) {
  const latest = thread.messages[thread.messages.length - 1];
  return (
    <button
      type="button"
      onClick={onSelect}
      className="w-full flex items-start gap-3 px-3 py-3 text-left transition-colors duration-150 active:scale-[0.99]"
      style={{
        background: selected
          ? 'color-mix(in srgb, var(--primary) 10%, transparent)'
          : 'transparent',
        borderLeft: selected ? '2px solid var(--primary)' : '2px solid transparent',
      }}
    >
      {/* Avatar */}
      <span
        className="w-8 h-8 rounded-full grid place-items-center shrink-0 mt-0.5 text-xs font-bold"
        style={{
          background: 'color-mix(in srgb, #7c3aed 16%, transparent)',
          color: '#7c3aed',
        }}
      >
        <Smartphone size={14} />
      </span>

      {/* Info */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 justify-between">
          <span className="text-xs font-semibold truncate">{displayName || thread.contact}</span>
          <span className="text-[10px] text-muted-foreground shrink-0">{relTime(thread.latest_at)}</span>
        </div>
        {latest && (
          <div className="text-[11px] text-muted-foreground mt-0.5 truncate">
            {latest.direction === 'out' ? 'You: ' : ''}{latest.body || '(empty)'}
          </div>
        )}
      </div>
    </button>
  );
}

// ─── Right pane: thread + composer ───────────────────────────────────────────

interface ThreadPaneProps {
  thread: Thread;
  onSent: (optimistic: SmsMsg) => void;
  displayName?: string;
}

function ThreadPane({ thread, onSent, displayName }: ThreadPaneProps) {
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [thread.messages.length]);

  // Focus composer when thread changes.
  useEffect(() => {
    textareaRef.current?.focus();
    setSendError(null);
    setDraft('');
  }, [thread.contact]);

  const handleSend = useCallback(async () => {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setSendError(null);
    // Optimistic bubble.
    const optimistic: SmsMsg = {
      id: Date.now() * -1, // negative id so it won't collide
      direction: 'out',
      body,
      created_at: new Date().toISOString(),
    };
    onSent(optimistic);
    setDraft('');
    try {
      const res = await fetch('/api/engagement/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: thread.contact, body }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setSendError(json.error ?? `Error ${res.status}`);
      }
    } catch (e) {
      setSendError((e as Error).message);
    } finally {
      setSending(false);
    }
  }, [draft, sending, thread.contact, onSent]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = draft.trim().length > 0 && !sending;

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      {/* Thread header */}
      <div
        className="flex items-center gap-2 px-4 py-2.5 border-b shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <span
          className="w-7 h-7 rounded-full grid place-items-center"
          style={{ background: 'color-mix(in srgb, #7c3aed 16%, transparent)', color: '#7c3aed' }}
        >
          <Smartphone size={13} />
        </span>
        <div>
          <div className="text-xs font-semibold">{displayName || thread.contact}</div>
          <div className="text-[10px] text-muted-foreground">
            {displayName ? `${thread.contact} · ` : ''}{thread.messages.length} message{thread.messages.length !== 1 ? 's' : ''}
          </div>
        </div>
      </div>

      {/* Bubbles */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-2">
        {thread.messages.map((m) => {
          const isOut = m.direction === 'out';
          return (
            <div key={m.id} className={`flex ${isOut ? 'justify-end' : 'justify-start'}`}>
              <div
                className="max-w-[75%] rounded-2xl px-3.5 py-2 text-sm leading-snug"
                style={
                  isOut
                    ? {
                        background: 'color-mix(in srgb, #7c3aed 72%, transparent)',
                        color: '#fff',
                      }
                    : {
                        background: 'var(--surface-2)',
                        color: 'var(--foreground)',
                        border: '1px solid color-mix(in srgb, var(--border) 60%, transparent)',
                      }
                }
              >
                <div className="whitespace-pre-wrap break-words">
                  {m.body || <span style={{ opacity: 0.6, fontStyle: 'italic' }}>(empty)</span>}
                </div>
                <div
                  className="text-[10px] mt-1"
                  style={{ opacity: 0.7, textAlign: isOut ? 'right' : 'left' }}
                >
                  {m.channel === 'imessage' ? 'iMessage · ' : ''}{formatTime(m.created_at)}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Error banner */}
      {sendError && (
        <div className="mx-4 mb-1 text-[11px] text-destructive flex items-center gap-1.5">
          <AlertCircle size={12} className="shrink-0" />
          {sendError}
        </div>
      )}

      {/* Composer */}
      <div
        className="border-t shrink-0 p-3"
        style={{ borderColor: 'var(--border)' }}
      >
        <form
          onSubmit={(e) => { e.preventDefault(); handleSend(); }}
          className="flex gap-2 items-end"
        >
          <textarea
            ref={textareaRef}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={2}
            placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
            disabled={sending}
            className="flex-1 resize-none text-sm"
            style={{ minHeight: '60px', maxHeight: '120px' }}
          />
          <button
            type="submit"
            disabled={!canSend}
            className="btn btn-primary shrink-0"
          >
            {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}
            <span className="sr-only">Send</span>
          </button>
        </form>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyThread() {
  return (
    <div className="flex-1 flex flex-col items-center justify-center gap-2 text-muted-foreground">
      <Smartphone size={28} style={{ opacity: 0.25 }} />
      <span className="text-sm">Select a conversation</span>
    </div>
  );
}

// ─── Main export ──────────────────────────────────────────────────────────────

export function SmsInbox() {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [selectedContact, setSelectedContact] = useState<string | null>(null);
  const [contacts, setContacts] = useState<Record<string, string>>({});
  const [composing, setComposing] = useState(false);

  const load = useCallback(async (keepSelected?: string) => {
    try {
      const r = await fetch('/api/engagement/sms', { cache: 'no-store' });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { conversations?: Thread[] };
      const convos: Thread[] = Array.isArray(j.conversations) ? j.conversations : [];
      setThreads(convos);
      setFetchError(null);
      // Auto-select first on initial load; preserve selection on refresh.
      setSelectedContact((prev) => {
        if (keepSelected && convos.some((t) => t.contact === keepSelected)) return keepSelected;
        if (prev && convos.some((t) => t.contact === prev)) return prev;
        return convos.length > 0 ? convos[0].contact : null;
      });
    } catch (e) {
      setFetchError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadContacts = useCallback(async () => {
    try {
      const r = await fetch('/api/engagement/contacts', { cache: 'no-store' });
      const j = (await r.json()) as { contacts?: Array<{ phone: string; name: string | null }> };
      const map: Record<string, string> = {};
      for (const c of j.contacts ?? []) if (c.name) map[c.phone] = c.name;
      setContacts(map);
    } catch {
      /* saved contacts are optional decoration — ignore failures */
    }
  }, []);

  useEffect(() => {
    load();
    loadContacts();
    // No stale-closure arg needed — load()'s setSelectedContact(prev => …) keeps
    // the LIVE selection (the `prev` branch) on every refresh.
    const id = setInterval(() => { load(); loadContacts(); }, 30_000);
    return () => clearInterval(id);
  }, [load, loadContacts]);

  // Optimistic append: add a sent bubble to the active thread immediately.
  const handleSent = useCallback((contact: string, msg: SmsMsg) => {
    setThreads((prev) =>
      prev.map((t) =>
        t.contact === contact
          ? { ...t, messages: [...t.messages, msg], latest_at: msg.created_at }
          : t,
      ),
    );
  }, []);

  // After composing a brand-new message: clear selection so load() auto-selects
  // the newest thread (the one we just texted), and refresh saved contacts.
  const handleComposeSent = useCallback(async () => {
    setComposing(false);
    setSelectedContact(null);
    await Promise.all([load(), loadContacts()]);
  }, [load, loadContacts]);

  const activeThread = threads.find((t) => t.contact === selectedContact) ?? null;
  const nameFor = (phone: string): string | undefined => contacts[phone];

  // ── Loading / error states ──

  if (loading && threads.length === 0) {
    return (
      <div className="panel">
        <div className="panel-header flex items-center gap-2">
          <Smartphone size={14} className="text-[#7c3aed]" />
          <h3 className="section-title">SMS</h3>
        </div>
        <div className="panel-body py-10 flex items-center justify-center gap-2 text-small">
          <Loader2 size={14} className="animate-spin" /> Loading SMS…
        </div>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="panel">
        <div className="panel-header flex items-center gap-2">
          <Smartphone size={14} className="text-[#7c3aed]" />
          <h3 className="section-title">SMS</h3>
        </div>
        <div className="panel-body py-6 text-center text-small text-destructive">{fetchError}</div>
      </div>
    );
  }

  // ── Two-pane layout (rendered even with zero threads, so "New" always works) ──

  return (
    <div className="panel overflow-hidden" style={{ height: 'calc(100dvh - 220px)', minHeight: 480, display: 'flex', flexDirection: 'column' }}>
      {/* Panel header */}
      <div className="panel-header flex items-center gap-2 shrink-0">
        <Smartphone size={14} className="text-[#7c3aed]" />
        <h3 className="section-title">SMS</h3>
        <span className="text-micro text-muted-foreground">Twilio · auto-refresh 30s</span>
        <button
          type="button"
          onClick={() => { setComposing(true); setSelectedContact(null); }}
          className="btn btn-primary btn-sm ml-auto inline-flex items-center gap-1"
          title="New message"
        >
          <Plus size={13} /> New
        </button>
      </div>

      {/* Two-pane body */}
      <div className="flex flex-1 overflow-hidden">
        {/* LEFT — contact list */}
        <div
          className="shrink-0 overflow-y-auto"
          style={{
            width: 240,
            borderRight: '1px solid var(--border)',
          }}
        >
          {threads.length === 0 ? (
            <div className="px-4 py-8 text-center text-[11px] text-muted-foreground flex flex-col items-center gap-2">
              <Inbox size={18} className="opacity-40" />
              <span>No conversations yet. Tap <strong>New</strong> to text someone.</span>
            </div>
          ) : (
            threads.map((t) => (
              <ContactRow
                key={t.contact}
                thread={t}
                selected={!composing && t.contact === selectedContact}
                onSelect={() => { setComposing(false); setSelectedContact(t.contact); }}
                displayName={nameFor(t.contact)}
              />
            ))
          )}
        </div>

        {/* RIGHT — thread / composer / new message */}
        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {composing ? (
            <ComposeNew onSent={handleComposeSent} onCancel={() => setComposing(false)} />
          ) : activeThread ? (
            <ThreadPane
              thread={activeThread}
              onSent={(msg) => handleSent(activeThread.contact, msg)}
              displayName={nameFor(activeThread.contact)}
            />
          ) : (
            <EmptyThread />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── New-message composer ─────────────────────────────────────────────────────

function ComposeNew({ onSent, onCancel }: { onSent: () => void; onCancel: () => void }) {
  const [to, setTo] = useState('');
  const [name, setName] = useState('');
  const [body, setBody] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSend = to.trim().length > 0 && body.trim().length > 0 && !sending;

  const send = async () => {
    if (!canSend) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/engagement/sms/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: to.trim(), body: body.trim() }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) {
        setError(json.error ?? `Error ${res.status}`);
        return;
      }
      // Save the contact name if provided (best-effort — non-blocking).
      if (name.trim()) {
        await fetch('/api/engagement/contacts', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ phone: to.trim(), name: name.trim() }),
        }).catch(() => {});
      }
      onSent();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="flex flex-col" style={{ height: '100%' }}>
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b shrink-0" style={{ borderColor: 'var(--border)' }}>
        <div className="text-xs font-semibold">New message</div>
        <button type="button" onClick={onCancel} className="btn btn-ghost btn-sm" title="Cancel"><X size={13} /></button>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">To · phone number</span>
          <input
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder="(415) 555-0123 or +14155550123"
            className="w-full text-sm"
            autoFocus
            inputMode="tel"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground inline-flex items-center gap-1">
            <UserPlus size={11} /> Save as contact (optional)
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Contact name"
            className="w-full text-sm"
          />
        </label>
        <label className="block space-y-1">
          <span className="text-[11px] text-muted-foreground">Message</span>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={5}
            placeholder="Type your message…"
            className="w-full resize-none text-sm"
          />
        </label>
        {error && (
          <div className="text-[11px] text-destructive flex items-center gap-1.5">
            <AlertCircle size={12} className="shrink-0" /> {error}
          </div>
        )}
      </div>

      <div className="border-t shrink-0 p-3 flex justify-end" style={{ borderColor: 'var(--border)' }}>
        <button type="button" onClick={send} disabled={!canSend} className="btn btn-primary inline-flex items-center gap-1.5">
          {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
        </button>
      </div>
    </div>
  );
}
