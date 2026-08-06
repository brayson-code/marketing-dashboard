'use client';

import { memo, useCallback, useEffect, useState, type ReactNode } from 'react';
import { Network, ArrowRight, Loader2, Send, ChevronRight, CheckCircle2, AlertTriangle, GitBranch } from 'lucide-react';
import { hashBlock } from './markdown-memo';

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

function clockTime(sec: number): string {
  return new Date(sec * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/* ---------- Compact markdown renderer ----------
 * Ported from MessageBubble.renderContent (bold/italic/inline-code/code-fence)
 * and extended with headings, bullet/numbered lists and blockquotes so an agent's
 * reply reads as a real chat message instead of raw `##` / `**` noise. Kept
 * line-based and client-safe (the docs <Markdown> is a server component that
 * touches the filesystem, which doesn't belong in this tight chat layout).
 *
 * STREAMING MEMOIZATION: this is the one chat surface that actually re-renders
 * full message text on a recurring tick — the Boardroom poll (`setInterval(load,
 * 10_000)` below) refetches the WHOLE conversation transcript and replaces state
 * wholesale, so every open thread's markdown would otherwise get re-parsed every
 * 10s even though almost all of it is unchanged history. `parseBlocks` below
 * turns a message's markdown into a "stable prefix" of block descriptors, and
 * `MemoBlock` (a value-keyed React.memo, see markdown-memo.tsx) skips the actual
 * parse+JSX build (`renderBlockContent`, which calls the inline formatter) for
 * any block whose text didn't change — only genuinely new/changed blocks pay the
 * parse cost. ReplyBubble/DispatchRow are additionally memoized per-message
 * below, so unchanged historical messages skip this component entirely on most
 * ticks; MemoBlock is the second line of defense for a message that DOES
 * re-render (e.g. its `grouped` flag flipped because a neighbor was inserted). */
function renderInline(text: string, keyBase: string): ReactNode[] {
  // Split out inline code first so ** / * inside code isn't touched.
  const parts = text.split(/(`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`')) {
      return (
        <code key={`${keyBase}-c${i}`} className="rounded bg-black/20 px-1 py-0.5 font-mono text-[0.85em]">
          {part.slice(1, -1)}
        </code>
      );
    }
    return (
      <span key={`${keyBase}-s${i}`}>
        {part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((seg, j) => {
          if (seg.startsWith('**') && seg.endsWith('**'))
            return <strong key={j} className="font-semibold text-foreground">{seg.slice(2, -2)}</strong>;
          if (seg.startsWith('*') && seg.endsWith('*'))
            return <em key={j} className="text-foreground/90">{seg.slice(1, -1)}</em>;
          return seg;
        })}
      </span>
    );
  });
}

// A single markdown block, in RAW (unparsed) form. `parseBlocks` only ever
// determines block BOUNDARIES (line-scanning, cheap); it never calls the inline
// formatter — that's deferred to `renderBlockContent`, which only runs inside a
// memoized `MemoBlock` so it's skippable per-block (see the memoization note
// above `renderInline`).
type Block =
  | { kind: 'code'; text: string }
  | { kind: 'heading'; text: string }
  | { kind: 'hr' }
  | { kind: 'quote'; text: string }
  | { kind: 'ul' | 'ol'; items: string[] }
  | { kind: 'para'; lines: string[] };

function parseBlocks(content: string): Block[] {
  const blocks: Block[] = [];
  const lines = content.replace(/\r\n/g, '\n').split('\n');
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Code fence
    if (/^```/.test(line.trim())) {
      const buf: string[] = [];
      i++;
      while (i < lines.length && !/^```/.test(lines[i].trim())) { buf.push(lines[i]); i++; }
      i++; // closing fence
      blocks.push({ kind: 'code', text: buf.join('\n') });
      continue;
    }

    // Headings → emphasised line (kept small to stay chat-compact)
    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      blocks.push({ kind: 'heading', text: h[2] });
      i++;
      continue;
    }

    // Horizontal rule
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) {
      blocks.push({ kind: 'hr' });
      i++;
      continue;
    }

    // Blockquote
    if (/^>\s?/.test(line)) {
      const buf: string[] = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
      blocks.push({ kind: 'quote', text: buf.join(' ') });
      continue;
    }

    // Unordered list
    if (/^\s*[-*+]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*[-*+]\s+/, '')); i++; }
      blocks.push({ kind: 'ul', items });
      continue;
    }

    // Ordered list
    if (/^\s*\d+[.)]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) { items.push(lines[i].replace(/^\s*\d+[.)]\s+/, '')); i++; }
      blocks.push({ kind: 'ol', items });
      continue;
    }

    // Blank line → paragraph break
    if (line.trim() === '') { i++; continue; }

    // Paragraph: gather consecutive plain lines
    const buf: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== '' &&
      !/^```/.test(lines[i].trim()) &&
      !/^(#{1,6})\s+/.test(lines[i]) &&
      !/^>\s?/.test(lines[i]) &&
      !/^\s*[-*+]\s+/.test(lines[i]) &&
      !/^\s*\d+[.)]\s+/.test(lines[i]) &&
      !/^\s*([-*_])\1{2,}\s*$/.test(lines[i])
    ) { buf.push(lines[i]); i++; }
    blocks.push({ kind: 'para', lines: buf });
  }

  return blocks;
}

// The actual parse: inline formatting (`renderInline`) + JSX construction. This
// is the work MemoBlock exists to skip for an unchanged block.
function renderBlockContent(b: Block, keyBase: string): ReactNode {
  switch (b.kind) {
    case 'code':
      return (
        <pre className="my-1.5 overflow-x-auto whitespace-pre-wrap rounded-md bg-black/30 px-3 py-2 font-mono text-[12px] leading-relaxed">
          {b.text}
        </pre>
      );
    case 'heading':
      return (
        <div className="mt-2 mb-0.5 text-[13px] font-semibold tracking-tight text-foreground first:mt-0">
          {renderInline(b.text, `${keyBase}-h`)}
        </div>
      );
    case 'hr':
      return <hr className="my-2 border-border/50" />;
    case 'quote':
      return (
        <blockquote className="my-1.5 border-l-2 border-primary/40 pl-3 text-foreground/75">
          {renderInline(b.text, `${keyBase}-q`)}
        </blockquote>
      );
    case 'ul':
      return (
        <ul className="my-1.5 ml-4 list-disc space-y-0.5 marker:text-muted-foreground">
          {b.items.map((it, idx) => <li key={idx} className="leading-snug">{renderInline(it, `${keyBase}-ul-${idx}`)}</li>)}
        </ul>
      );
    case 'ol':
      return (
        <ol className="my-1.5 ml-4 list-decimal space-y-0.5 marker:text-muted-foreground">
          {b.items.map((it, idx) => <li key={idx} className="leading-snug">{renderInline(it, `${keyBase}-ol-${idx}`)}</li>)}
        </ol>
      );
    case 'para':
      return (
        <p className="my-1 leading-snug first:mt-0 last:mb-0">
          {b.lines.map((ln, idx) => (
            <span key={idx}>
              {renderInline(ln, `${keyBase}-p-${idx}`)}
              {idx < b.lines.length - 1 && <br />}
            </span>
          ))}
        </p>
      );
  }
}

// Value-equality (not reference-equality) comparison: two block descriptors
// built on separate parses of the SAME unchanged source text always compare
// equal here, which is what lets MemoBlock bail out below.
function blocksEqual(a: Block, b: Block): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case 'hr':
      return true;
    case 'code':
    case 'heading':
    case 'quote':
      return a.text === (b as typeof a).text;
    case 'ul':
    case 'ol': {
      const bb = b as typeof a;
      return a.items.length === bb.items.length && a.items.every((it, idx) => it === bb.items[idx]);
    }
    case 'para': {
      const bb = b as typeof a;
      return a.lines.length === bb.lines.length && a.lines.every((ln, idx) => ln === bb.lines[idx]);
    }
  }
}

function blockSourceText(b: Block): string {
  switch (b.kind) {
    case 'code':
    case 'heading':
    case 'quote':
      return `${b.kind}:${b.text}`;
    case 'hr':
      return 'hr';
    case 'ul':
    case 'ol':
      return `${b.kind}:${b.items.join(' ')}`;
    case 'para':
      return `para:${b.lines.join(' ')}`;
  }
}

// The completed-block unit: memoized BY VALUE, so a re-render (e.g. the parent
// message re-rendering because a sibling's `grouped` flag changed) skips
// `renderBlockContent` — and the `renderInline` parse inside it — for every
// block whose text is unchanged from last time.
const MemoBlock = memo(
  function MarkdownBlock({ block, blockKey }: { block: Block; blockKey: string }) {
    return <>{renderBlockContent(block, blockKey)}</>;
  },
  (prev, next) => blocksEqual(prev.block, next.block),
);

const CompactMarkdown = memo(function CompactMarkdown({ content }: { content: string }) {
  const blocks = parseBlocks(content);
  return (
    <div className="text-[13px] text-foreground/90">
      {blocks.map((b, i) => (
        <MemoBlock key={`${i}-${hashBlock(blockSourceText(b))}`} block={b} blockKey={`b${i}`} />
      ))}
    </div>
  );
});

/* ---------- Decision / handoff detection ----------
 * Best-effort only: surface a chip when a *result* reads like the agent made a
 * call (recommended / decided / approved) or handed work back. We never fabricate
 * a decision — if no cue matches, no chip is shown. */
const DECISION_CUES = [
  /\b(recommend(?:ation|ed|s)?)\b/i,
  /\b(decision|decided|i'?ll go with|we should|propose|proposal)\b/i,
  /\b(approv(?:e|ed|al)|sign[- ]?off|green[- ]?light|go ahead)\b/i,
  /\b(next step|hand(?:ing| it)? (?:back|off)|over to you|recommended action)\b/i,
];
function decisionKind(m: A2AMessage): { label: string; icon: ReactNode } | null {
  if (m.phase !== 'result') return null;
  const t = m.content || '';
  if (/\b(approv|sign[- ]?off|green[- ]?light|go ahead)\b/i.test(t))
    return { label: 'Approval', icon: <CheckCircle2 size={11} /> };
  if (/\b(hand(?:ing| it)? (?:back|off)|over to you|next step)\b/i.test(t))
    return { label: 'Handoff', icon: <GitBranch size={11} /> };
  if (DECISION_CUES.some((re) => re.test(t)))
    return { label: 'Decision', icon: <CheckCircle2 size={11} /> };
  return null;
}

function Avatar({ party, dim }: { party: A2AParty; dim?: boolean }) {
  return (
    <div
      className={`grid h-7 w-7 shrink-0 place-items-center rounded-full border text-[14px] leading-none ${
        dim ? 'border-border/50 bg-[var(--surface-2)] opacity-80' : 'border-border/60 bg-[var(--surface-2)]'
      }`}
      title={party.name}
    >
      <span>{party.emoji || party.name.charAt(0).toUpperCase()}</span>
    </div>
  );
}

/* A "dispatch" message: KeyPlayer assigned a task to a sub-agent. The task body
 * is usually huge, so it's collapsed behind a "show task" expander by default.
 *
 * Memoized on the message's own identity+content: the Boardroom poll refetches
 * the FULL transcript every 10s, so without this every already-rendered
 * dispatch row (and its collapsed CompactMarkdown) would re-render on every
 * tick even though its message never changes. `open` is local state, so
 * toggling "show task" still re-renders normally — memo only compares props. */
function DispatchRowImpl({ m }: { m: A2AMessage }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="my-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="group flex w-full items-center gap-1.5 rounded-lg border border-border/50 bg-[var(--surface-1)] px-2.5 py-1.5 text-left text-[11px] text-muted-foreground transition-colors duration-[var(--t-press)] [transition-timing-function:var(--ease-out)] hover:bg-[var(--surface-2)] active:scale-[0.99]"
      >
        <span className="text-[13px] leading-none">{m.from.emoji}</span>
        <span className="font-medium text-foreground/80">{m.from.name}</span>
        <ArrowRight size={11} className="shrink-0 opacity-60" />
        <span className="text-[13px] leading-none">{m.to?.emoji}</span>
        <span className="font-medium text-foreground/80">{m.to?.name}</span>
        <span className="text-muted-foreground">— assigned a task</span>
        <span className="ml-auto flex items-center gap-1 whitespace-nowrap">
          <span className="text-muted-foreground/70">{open ? 'hide' : 'show task'}</span>
          <ChevronRight size={12} className={`transition-transform duration-[var(--t-press)] [transition-timing-function:var(--ease-out)] ${open ? 'rotate-90' : ''}`} />
        </span>
      </button>
      {open && (
        <div className="mt-1 rounded-lg border border-border/50 bg-[var(--surface-1)] px-3 py-2">
          <CompactMarkdown content={m.content} />
        </div>
      )}
    </div>
  );
}
const DispatchRow = memo(
  DispatchRowImpl,
  (prev, next) => prev.m.id === next.m.id && prev.m.content === next.m.content,
);

/* A normal "result"/"error" reply: rendered bubble, directional by sender.
 * Memoized for the same reason as DispatchRow above — this is what actually
 * skips CompactMarkdown (and, per-block, renderInline) for the bulk of a long
 * thread's history on every 10s poll tick. */
function ReplyBubbleImpl({ m, grouped, isOrchestrator }: { m: A2AMessage; grouped: boolean; isOrchestrator: boolean }) {
  const isError = m.phase === 'error';
  const decision = decisionKind(m);
  // Orchestrator replies hug the left; sub-agent replies hug the right.
  const right = !isOrchestrator;

  return (
    <div className={`flex gap-2 ${right ? 'flex-row-reverse' : 'flex-row'} ${grouped ? 'mt-0.5' : 'mt-3'}`}>
      {grouped ? <div className="w-7 shrink-0" /> : <Avatar party={m.from} />}
      <div className={`flex min-w-0 max-w-[82%] flex-col ${right ? 'items-end' : 'items-start'}`}>
        {!grouped && (
          <div className={`mb-0.5 flex items-center gap-1.5 ${right ? 'flex-row-reverse' : 'flex-row'}`}>
            <span className="text-[11px] font-medium text-foreground/80">{m.from.name}</span>
            <span className="text-[10px] text-muted-foreground/50">{clockTime(m.created_at)}</span>
          </div>
        )}

        {decision && (
          <div className={`mb-1 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
            decision.label === 'Approval'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-400'
              : decision.label === 'Handoff'
                ? 'border-amber-500/30 bg-amber-500/10 text-amber-400'
                : 'border-primary/30 bg-primary/10 text-primary'
          }`}>
            {decision.icon}
            {decision.label}
          </div>
        )}

        <div className={`min-w-0 rounded-xl px-3 py-2 ${
          isError
            ? 'border border-destructive/40 bg-destructive/10 text-destructive'
            : `border border-border/60 bg-[var(--surface-2)] text-foreground ${right ? 'rounded-tr-sm' : 'rounded-tl-sm'}`
        }`}>
          {isError && (
            <div className="mb-1 flex items-center gap-1.5 text-[11px] font-medium">
              <AlertTriangle size={12} /> Error
            </div>
          )}
          <CompactMarkdown content={m.content} />
        </div>
      </div>
    </div>
  );
}
const ReplyBubble = memo(
  ReplyBubbleImpl,
  (prev, next) =>
    prev.m.id === next.m.id &&
    prev.m.content === next.m.content &&
    prev.m.phase === next.m.phase &&
    prev.grouped === next.grouped &&
    prev.isOrchestrator === next.isOrchestrator,
);

export function A2AHistory() {
  const [convs, setConvs] = useState<A2AConversation[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

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
  // You message the non-orchestrator agent in the pair (the sub-agent).
  const target = current ? (current.a.id !== 'keyplayer' ? current.a : current.b) : null;

  async function send() {
    if (!input.trim() || sending || !target) return;
    setSending(true);
    setNotice(null);
    try {
      const res = await fetch('/api/boardroom/a2a', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ to: target.id, content: input.trim() }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice(json.error || `Failed (${res.status})`);
      } else {
        setInput('');
        setNotice(`Dispatched to ${target.name}. Its reply will appear here shortly…`);
        setTimeout(load, 4000);
        setTimeout(load, 12000);
      }
    } catch (e) {
      setNotice((e as Error).message);
    } finally {
      setSending(false);
    }
  }

  if (loading && convs.length === 0) {
    return (
      <div className="panel flex items-center justify-center gap-2 p-8 text-sm text-muted-foreground">
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
    <div className="panel flex flex-col md:flex-row" style={{ height: 'calc(100dvh - 260px)', minHeight: 420 }}>
      {/* Conversation list — above the thread on a phone, beside it from md up. */}
      <div className="w-full md:w-64 max-h-40 md:max-h-none shrink-0 overflow-y-auto border-b md:border-b-0 md:border-r border-border/60">
        <div className="px-3 py-2 text-[10px] uppercase tracking-wide text-muted-foreground">Boardroom threads</div>
        {convs.map((c) => {
          const last = c.messages[c.messages.length - 1];
          const preview = last ? last.content.replace(/[#*`>_-]/g, '').replace(/\s+/g, ' ').trim() : '';
          const isActive = active === c.key;
          return (
            <button
              key={c.key}
              onClick={() => setActive(c.key)}
              className={`flex w-full items-start gap-2 border-l-2 px-3 py-2.5 text-left transition-colors duration-[var(--t-press)] [transition-timing-function:var(--ease-out)] active:scale-[0.99] ${
                isActive ? 'border-primary bg-primary/10' : 'border-transparent hover:bg-[var(--surface-2)]'
              }`}
            >
              <div className="flex shrink-0 -space-x-1.5">
                <span className="grid h-6 w-6 place-items-center rounded-full border border-border/60 bg-[var(--surface-2)] text-[12px] leading-none">{c.a.emoji}</span>
                <span className="grid h-6 w-6 place-items-center rounded-full border border-border/60 bg-[var(--surface-1)] text-[12px] leading-none">{c.b.emoji}</span>
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 truncate text-xs font-medium">
                  <span className="truncate">{c.a.name}</span>
                  <ArrowRight size={9} className="shrink-0 text-muted-foreground" />
                  <span className="truncate">{c.b.name}</span>
                </div>
                {preview && <div className="mt-0.5 truncate text-[11px] text-muted-foreground/80">{preview}</div>}
                <div className="mt-0.5 text-[10px] text-muted-foreground/60">{c.message_count} msgs · {ago(c.last_at)}</div>
              </div>
            </button>
          );
        })}
      </div>

      {/* Transcript + composer */}
      <div className="flex min-w-0 flex-1 flex-col">
        {current && (
          <div className="flex items-center gap-2 border-b border-border/60 px-4 py-2.5">
            <span className="text-[15px] leading-none">{current.a.emoji}</span>
            <span className="text-sm font-medium">{current.a.name}</span>
            <Network size={12} className="text-muted-foreground" />
            <span className="text-[15px] leading-none">{current.b.emoji}</span>
            <span className="text-sm font-medium">{current.b.name}</span>
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-4">
          {!current ? (
            <div className="flex h-full items-center justify-center text-xs text-muted-foreground">Select a thread</div>
          ) : (
            current.messages.map((m, idx) => {
              if (m.phase === 'dispatch') return <DispatchRow key={m.id} m={m} />;
              const prev = current.messages[idx - 1];
              const grouped = !!prev && prev.phase !== 'dispatch' && prev.from.id === m.from.id;
              const isOrchestrator = m.from.id === 'keyplayer';
              return <ReplyBubble key={m.id} m={m} grouped={grouped} isOrchestrator={isOrchestrator} />;
            })
          )}
        </div>

        {current && target && (
          <form
            onSubmit={(e) => { e.preventDefault(); send(); }}
            className="space-y-1.5 border-t border-border/60 p-3"
          >
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); send(); } }}
                placeholder={`Send a task to ${target.emoji} ${target.name}…`}
                rows={2}
                disabled={sending}
                className="flex-1 resize-none"
              />
              <button type="submit" className="btn btn-primary" disabled={sending || !input.trim()}>
                {sending ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />} Send
              </button>
            </div>
            {notice && <div className="text-[11px] text-muted-foreground">{notice}</div>}
          </form>
        )}
      </div>
    </div>
  );
}
