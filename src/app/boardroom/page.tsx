'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Phone, AlertCircle, ArrowDownToLine, ArrowUpFromLine, MessageSquare, Network, Sparkles } from 'lucide-react';
import { AgentChat } from '@/components/chat/agent-chat';
import { MissionControlChat } from '@/components/chat/mission-control-chat';

type Tab = 'imessage' | 'mission' | 'a2a';

type Direction = 'in' | 'out';

interface BoardroomMessage {
  id: number;
  direction: Direction;
  sender: string;
  recipient: string | null;
  text: string;
  loop_message_id: string | null;
  status: string | null;
  // Supabase returns timestamptz as ISO strings; tolerate legacy unix numbers too.
  created_at: string | number;
}

interface BoardroomResponse {
  configured: boolean;
  owner_phone: string | null;
  messages: BoardroomMessage[];
}

function formatTs(ts: string | number): string {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : Date.parse(ts));
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function IMessageThread() {
  const [data, setData] = useState<BoardroomResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/boardroom/messages?limit=200', { cache: 'no-store' });
      const json = (await res.json()) as BoardroomResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data?.messages.length]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!draft.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/boardroom/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft.trim(), agent: 'owner' }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `Send failed (${res.status})`);
      } else {
        setDraft('');
        await load();
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const messages = data?.messages ?? [];
  const configured = data?.configured ?? false;
  const ownerPhone = data?.owner_phone;

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground flex-wrap">
        {ownerPhone && (
          <span className="badge badge-neutral inline-flex items-center gap-1.5">
            <Phone size={11} /> {ownerPhone}
          </span>
        )}
        <span className={`badge ${configured ? 'badge-success' : 'badge-warning'}`}>
          {configured ? 'LoopMessage connected' : 'Not configured'}
        </span>
      </div>

      {!configured && (
        <div className="panel p-3 flex items-start gap-2 text-xs">
          <AlertCircle size={14} className="text-warning mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">LoopMessage is not configured.</div>
            <div className="text-muted-foreground mt-1">
              Set <code className="text-foreground">LOOPMESSAGE_AUTH_KEY</code> and <code className="text-foreground">KEYPLAYERS_OWNER_PHONE</code> in <code className="text-foreground">.env.local</code> and restart.
            </div>
          </div>
        </div>
      )}

      <div className="panel flex flex-col" style={{ height: 'calc(100vh - 260px)', minHeight: 400 }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              No messages yet. Send the first one below — or wait for an agent to ping you.
            </div>
          )}
          {messages.map((m) => {
            const mine = m.direction === 'in';
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                    mine
                      ? 'bg-[var(--bubble-mine)] text-[var(--bubble-mine-foreground)]'
                      : 'bg-[var(--surface-2)] text-foreground border border-border/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] opacity-80 mb-0.5">
                    {mine ? <ArrowUpFromLine size={10} /> : <ArrowDownToLine size={10} />}
                    <span className="font-medium">{mine ? 'You' : m.sender || 'agent'}</span>
                    <span>·</span>
                    <span>{formatTs(m.created_at)}</span>
                    {m.status && !mine && <><span>·</span><span>{m.status}</span></>}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.text}</div>
                </div>
              </div>
            );
          })}
        </div>

        <form onSubmit={handleSend} className="border-t border-border/60 p-3 flex gap-2 items-end">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleSend(e as unknown as React.FormEvent);
              }
            }}
            placeholder={configured ? `Message ${ownerPhone ?? 'owner'} via iMessage…` : 'Configure LoopMessage to enable sending'}
            disabled={!configured || sending}
            rows={2}
            className="flex-1 resize-none"
          />
          <button
            type="submit"
            disabled={!configured || sending || !draft.trim()}
            className="btn btn-primary"
          >
            <Send size={14} /> {sending ? 'Sending…' : 'Send'}
          </button>
        </form>

        {error && (
          <div className="px-4 pb-3 text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle size={12} /> {error}
          </div>
        )}
      </div>
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: typeof MessageSquare; description: string }[] = [
  { id: 'imessage', label: 'iMessage', icon: MessageSquare, description: 'You ↔ orchestrator over iMessage' },
  { id: 'mission', label: 'Mission Control', icon: Sparkles, description: 'Operator ↔ orchestrator (in-app)' },
  { id: 'a2a', label: 'Agent ↔ Agent', icon: Network, description: 'Bridge threads between agents' },
];

export default function BoardroomPage() {
  const [tab, setTab] = useState<Tab>('imessage');
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Boardroom</h1>
        <p className="text-xs text-muted-foreground">{active.description}</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab inline-flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'imessage' && <IMessageThread />}
      {tab === 'mission' && <MissionControlChat />}
      {tab === 'a2a' && <AgentChat />}
    </div>
  );
}
