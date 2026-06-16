'use client';

import { useEffect, useRef, useState } from 'react';
import { HelpCircle, X, Send, Loader2, Sparkles } from 'lucide-react';

interface Msg { role: 'user' | 'assistant'; content: string }

const STARTERS = [
  'How do I connect my accounts?',
  'Why isn’t my agent posting?',
  'How do approvals work?',
  'How do I set a budget cap?',
];

// ── tiny markdown: links [text](href), **bold**, and "- " bullet lists ──────────
function inline(text: string, keyBase: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  const re = /\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) nodes.push(text.slice(last, m.index));
    if (m[1] && m[2]) {
      const href = m[2];
      const external = /^https?:\/\//.test(href);
      nodes.push(
        <a
          key={`${keyBase}-l${i}`}
          href={href}
          {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
          className="text-[var(--primary)] underline underline-offset-2 hover:opacity-80"
        >
          {m[1]}
        </a>,
      );
    } else if (m[3]) {
      nodes.push(<strong key={`${keyBase}-b${i}`}>{m[3]}</strong>);
    }
    last = re.lastIndex;
    i++;
  }
  if (last < text.length) nodes.push(text.slice(last));
  return nodes;
}

function Rich({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: React.ReactNode[] = [];
  let bullets: string[] = [];
  const flush = (k: number) => {
    if (!bullets.length) return;
    blocks.push(
      <ul key={`ul${k}`} className="list-disc pl-4 space-y-0.5 my-1">
        {bullets.map((b, j) => <li key={j}>{inline(b, `ul${k}-${j}`)}</li>)}
      </ul>,
    );
    bullets = [];
  };
  lines.forEach((line, idx) => {
    const t = line.trim();
    if (/^[-*]\s+/.test(t)) { bullets.push(t.replace(/^[-*]\s+/, '')); return; }
    flush(idx);
    if (t) blocks.push(<p key={idx} className="my-1">{inline(t, `p${idx}`)}</p>);
  });
  flush(lines.length);
  return <>{blocks}</>;
}

export function HelpWidget() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  useEffect(() => { if (open) setTimeout(() => inputRef.current?.focus(), 50); }, [open]);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    const next = [...messages, { role: 'user' as const, content: q }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      const res = await fetch('/api/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: next }),
      });
      const j = await res.json();
      const answer = j.answer || j.error || 'Sorry — something went wrong. Try again or email support@keyplayershq.com.';
      setMessages((m) => [...m, { role: 'assistant', content: answer }]);
    } catch {
      setMessages((m) => [...m, { role: 'assistant', content: 'I couldn’t reach the help service. Please try again in a moment.' }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Open help"
          className="fixed z-40 bottom-20 sm:bottom-5 right-4 sm:right-5 h-12 w-12 rounded-full grid place-items-center text-white shadow-lg"
          style={{
            background: 'var(--primary)',
            transition: 'transform var(--t-press, 120ms) var(--ease-out, ease-out), box-shadow var(--t-popover,200ms) var(--ease-out,ease-out)',
          }}
          onMouseDown={(e) => (e.currentTarget.style.transform = 'scale(0.94)')}
          onMouseUp={(e) => (e.currentTarget.style.transform = '')}
          onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
        >
          <HelpCircle size={22} />
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          className="fixed z-40 bottom-20 sm:bottom-5 right-4 sm:right-5 flex flex-col rounded-2xl border overflow-hidden animate-in"
          style={{
            width: 'min(380px, calc(100vw - 2rem))',
            height: 'min(560px, calc(100vh - 7rem))',
            background: 'var(--surface-1)',
            borderColor: 'var(--border)',
            boxShadow: '0 20px 50px -12px rgba(0,0,0,0.35)',
          }}
        >
          {/* Header */}
          <div className="flex items-center gap-2 px-3.5 py-3 border-b" style={{ borderColor: 'var(--border)' }}>
            <div className="h-7 w-7 rounded-lg grid place-items-center text-white shrink-0" style={{ background: 'var(--primary)' }}>
              <Sparkles size={14} />
            </div>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight">Help</div>
              <div className="text-[11px] text-muted-foreground leading-tight">Ask anything about the Command Center</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close help" className="ml-auto p-1.5 rounded-md hover:bg-[var(--surface-2)] text-muted-foreground">
              <X size={16} />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-3.5 py-3 space-y-3 text-sm">
            {messages.length === 0 && (
              <div className="space-y-3">
                <p className="text-muted-foreground">
                  Hi! I can answer questions about connecting accounts, agents, approvals, billing, and more — grounded in the docs.
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {STARTERS.map((s) => (
                    <button
                      key={s}
                      onClick={() => send(s)}
                      className="text-xs px-2.5 py-1.5 rounded-full border hover:bg-[var(--surface-2)]"
                      style={{ borderColor: 'var(--border)' }}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className="max-w-[85%] rounded-2xl px-3 py-2 leading-relaxed"
                  style={
                    m.role === 'user'
                      ? { background: 'var(--primary)', color: '#fff' }
                      : { background: 'var(--surface-2)', color: 'var(--foreground)' }
                  }
                >
                  {m.role === 'user' ? m.content : <Rich text={m.content} />}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl px-3 py-2.5" style={{ background: 'var(--surface-2)' }}>
                  <Loader2 size={15} className="animate-spin text-muted-foreground" />
                </div>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t p-2.5" style={{ borderColor: 'var(--border)' }}>
            <div className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(input); }
                }}
                rows={1}
                placeholder="Ask a question…"
                className="flex-1 resize-none bg-transparent text-sm outline-none max-h-28 px-2 py-1.5"
              />
              <button
                onClick={() => send(input)}
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="h-8 w-8 shrink-0 rounded-lg grid place-items-center text-white disabled:opacity-40"
                style={{ background: 'var(--primary)', transition: 'transform var(--t-press,120ms) var(--ease-out,ease-out)' }}
                onMouseDown={(e) => !e.currentTarget.disabled && (e.currentTarget.style.transform = 'scale(0.92)')}
                onMouseUp={(e) => (e.currentTarget.style.transform = '')}
                onMouseLeave={(e) => (e.currentTarget.style.transform = '')}
              >
                <Send size={14} />
              </button>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1.5 px-2">Answers come from the docs and may be imperfect.</p>
          </div>
        </div>
      )}
    </>
  );
}

export default HelpWidget;
