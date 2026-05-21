'use client';

import { useCallback, useEffect, useState } from 'react';
import { Network, ArrowRight, Loader2 } from 'lucide-react';

interface A2AParty { id: string; name: string; emoji: string }
interface A2AMessage {
  id: number;
  from: A2AParty;
  to: A2AParty | null;
  content: string;
  phase: string | null;
  created_at: number;
}
interface A2AConversation {
  key: string;
  a: A2AParty;
  b: A2AParty;
  last_at: number;
  message_count: number;
  messages: A2AMessage[];
}

function ago(sec: number): string {
  const s = Math.max(1, Math.floor(Date.now() / 1000 - sec));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
}

const PHASE_STYLE: Record<string, string> = {
  dispatch: 'badge-info',
  result: 'badge-success',
  error: 'badge-warning',
};

export function A2AHistory() {
  const [convs, setConvs] = useState<A2AConversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/boardroom/a2a', { cache: 'no-store' });
      if (!res.ok) return;
      const json = await res.json();
      const list: A2AConversation[] = Array.isArray(json.conversations) ? json.conversations : [];
      setConvs(list);
      setActive((prev) => (prev && list.some((c) => c.key === prev) ? prev : list[0]?.key ?? null));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 10_000);
    return () => clearInterval(id);
  }, [load]);

  const current = convs.find((c) => c.key === active) ?? null;

  if (loading && convs.length === 0) {
    return (
      <div className="panel p-8 flex items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 size={14} className="animate-spin" /> Loading agent conversations…
      </div>
    );
  }

  if (convs.length === 0) {
    return (
      <div className="panel p-8 text-center text-sm text-muted-foreground">
        <Network size={20} className="mx-auto mb-2 text-primary" />
        No agent-to-agent activity yet. When KeyPlayer dispatches a sub-agent, their back-and-forth shows up here.
      </div>
    );
  }

  return (
    <div className="panel flex" style={{ height: 'calc(100vh - 260px)', minHeight: 420 }}>
      {/* Conversation list */}
      <div className="w-56 border-r border-border/60 overflow-y-auto shrink-0">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">Threads</div>
        {convs.map((c) => (
          <button
            key={c.key}
            onClick={() => setActive(c.key)}
            className={`w-full text-left px-3 py-2.5 border-l-2 transition-colors ${
              active === c.key ? 'bg-primary/10 border-primary' : 'border-transparent hover:bg-[var(--surface-2)]'
            }`}
          >
            <div className="text-xs font-medium flex items-center gap-1 truncate">
              <span>{c.a.emoji}</span><span className="truncate">{c.a.name}</span>
              <Network size={10} className="text-muted-foreground shrink-0" />
              <span>{c.b.emoji}</span><span className="truncate">{c.b.name}</span>
            </div>
            <div className="text-[10px] text-muted-foreground mt-0.5">{c.message_count} msgs · {ago(c.last_at)}</div>
          </button>
        ))}
      </div>

      {/* Transcript */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-w-0">
        {!current ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Select a thread</div>
        ) : (
          current.messages.map((m) => (
            <div key={m.id} className="rounded-xl border border-border/60 bg-[var(--surface-2)] p-3">
              <div className="flex items-center gap-1.5 text-[11px] mb-1 flex-wrap">
                <span className="font-medium">{m.from.emoji} {m.from.name}</span>
                {m.to && <><ArrowRight size={11} className="text-muted-foreground" /><span className="font-medium">{m.to.emoji} {m.to.name}</span></>}
                {m.phase && <span className={`badge ${PHASE_STYLE[m.phase] ?? 'badge-neutral'}`}>{m.phase}</span>}
                <span className="text-muted-foreground ml-auto">{ago(m.created_at)}</span>
              </div>
              <div className="text-sm whitespace-pre-wrap break-words leading-snug">{m.content}</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
