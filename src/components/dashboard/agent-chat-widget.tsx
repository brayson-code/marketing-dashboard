'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, MessageCircle } from 'lucide-react';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { AgentIcon } from '@/components/agent-icon';
import { toast } from '@/components/ui/toast';
import type { ChatMessage } from '@/types';
import type { Department } from '@/components/agent-orb';

// Overview board tile: the SAME agent chat experience as the left-nav chat panel
// (NavAgentChatWidget), embedded inline in a board cell instead of a floating dialog.
//
// It deliberately reuses the exact same building blocks so it looks identical:
//   - <MessageBubble>  — the thread rendering (avatars, bubbles, code/markdown).
//   - <ChatComposer>   — the auto-growing textarea + mic + send button.
//   - /api/agents      — the roster (flat array), same as the nav panel.
//   - /api/agent-chat  — GET history + POST { agentId, message } → { reply }.
//
// TARGET: the ACTIVE LENS's executive — this widget receives the board's `department`
// prop (the same lens LensTabs drives for HeroAgents/DepartmentRoster/etc., lifted as
// board-level state in <WidgetBoard> and passed to every widget generically) and keeps
// the active agent in lockstep with it: Leadership → the lead exec (AI CEO-equivalent),
// Marketing → the CMO-equivalent, and so on, mirroring the SAME is_executive +
// department match /api/hero-agents already uses to build the lens-filtered hero row —
// no new mapping invented here. A LENS CHANGE ALWAYS WINS: if the operator manually
// picked a different agent from the dropdown, that pick survives only until the next
// lens change, then gets overridden. A lens with no exec seeded on this tenant is a
// no-op (keep the current agent, never crash).
//
// LAYOUT: this is the FLAGSHIP element of the overview board — a full board row
// (registry `defaultSpan: 3`, see dashboard-widgets.ts), designed to feel like
// Claude's own web app rather than a small chat tile: generous height, a
// centered conversation column (max-w-3xl) so line length stays comfortable
// even at full board width, and an elevated Claude-style composer pinned to
// the bottom. The agent roster switcher lives in the header as a small,
// subtle dropdown (Claude's model-picker pattern) instead of a persistent chip
// row competing with the conversation for space.
//
// DELTA vs. the nav panel: `keyplayer` (the Orchestrator) IS reachable here, but NOT via
// /api/agent-chat — that path 502s for it because it isn't a spawnable sub-agent. Instead
// it's offered as a distinct first-class picker option ("KeyPlayer — Orchestrator") whose
// messages route through the Boardroom endpoints (POST /api/boardroom/ask to send, GET
// /api/boardroom/messages for history) — the same orchestrator conversation the Boardroom
// page and iMessage use, so the thread is shared and persistent, not an in-widget-only
// session. It stays excluded from the /api/agents-derived roster (NON_CHATTABLE) and is
// injected separately (see ORCHESTRATOR below). fixer/improver remain fully excluded.
//
// Tenant isolation is enforced server-side; this component never touches sql().

// The command-tile accent — on-brand primary (KeyPlayers green), tinting the header,
// active picker entry, composer focus ring + send button. Matches the "ops" board category.
const ACCENT = 'var(--primary)';

interface AgentItem {
  id: string;
  name: string;
  emoji: string;
  role?: string;
  department?: string | null;
  is_executive?: boolean;
}

// Agents that CANNOT be chatted with 1:1 (kept in lockstep with NavAgentChatWidget):
// keyplayer is the orchestrator (Boardroom-only, not a spawnable sub-agent) and
// fixer/improver are HQ/system agents — spawnSubAgent refuses all three.
const NON_CHATTABLE = new Set<string>(['keyplayer', 'fixer', 'improver']);

// Resolves the ACTIVE LENS's executive from the already-fetched roster — the same
// is_executive + department signal /api/hero-agents filters on, so lens ↔ agent stays
// in lockstep with the hero row without inventing a second mapping. Leadership prefers
// the exec whose OWN department is 'leadership' (the CEO-equivalent, e.g. `ai-ceo`),
// falling back to any executive; every other lens matches its own department's exec.
// Returns null when this tenant hasn't seeded one — callers must leave the current
// agent selected rather than clearing it (never crash on a sparse roster).
function execForDepartment(agents: AgentItem[], department: Department): AgentItem | null {
  if (department === 'leadership') {
    return (
      agents.find((a) => a.is_executive && a.department === 'leadership') ??
      agents.find((a) => a.is_executive) ??
      null
    );
  }
  return agents.find((a) => a.is_executive && a.department === department) ?? null;
}

function parseAgentsResponse(payload: unknown): AgentItem[] {
  const rows: unknown[] = Array.isArray(payload)
    ? payload
    : Array.isArray((payload as { agents?: unknown[] })?.agents)
      ? (payload as { agents: unknown[] }).agents
      : [];
  return rows
    .map((r) => {
      const a = r as Record<string, unknown>;
      return {
        id: String(a.id ?? ''),
        name: String(a.name ?? a.id ?? ''),
        emoji: String(a.emoji ?? '🤖'),
        role: typeof a.role === 'string' ? a.role : undefined,
        department: typeof a.department === 'string' ? a.department : null,
        is_executive: a.is_executive === true,
      } satisfies AgentItem;
    })
    .filter((a) => a.id && !NON_CHATTABLE.has(a.id));
}

// The orchestrator, injected as a first-class picker option (it's filtered OUT of the
// /api/agents roster by NON_CHATTABLE). Chatting with it routes through the Boardroom
// endpoints instead of /api/agent-chat — see loadHistory/handleSend below.
const ORCHESTRATOR_ID = 'keyplayer';
const ORCHESTRATOR: AgentItem = {
  id: ORCHESTRATOR_ID,
  name: 'KeyPlayer',
  emoji: '🎛️',
  role: 'Orchestrator',
  department: 'leadership',
  is_executive: false,
};

const DEPARTMENTS = new Set<string>([
  'leadership', 'marketing', 'revenue', 'operations', 'client_experience',
]);

// Narrow the roster's freeform department string to a known Department (drives AgentIcon's
// color); anything unrecognized → undefined (AgentIcon falls back to the primary accent).
function asDepartment(d: string | null | undefined): Department | undefined {
  return d && DEPARTMENTS.has(d) ? (d as Department) : undefined;
}

/** One boardroom_messages row as returned by GET /api/boardroom/messages. */
interface BoardroomRow {
  id: number;
  direction: 'in' | 'out';
  text: string | null;
  created_at: string | number;
}

// Map the orchestrator's Boardroom history into the shared ChatMessage shape MessageBubble
// renders. direction 'in' = the owner's turn (human), 'out' = KeyPlayer's reply. Blank-text
// rows (e.g. image-only inbound messages) are dropped so the thread has no empty bubbles.
function boardroomToChat(rows: unknown): ChatMessage[] {
  if (!Array.isArray(rows)) return [];
  const out: ChatMessage[] = [];
  for (const r of rows) {
    const m = r as Partial<BoardroomRow>;
    const text = typeof m.text === 'string' ? m.text : '';
    if (!text.trim()) continue;
    const inbound = m.direction === 'in';
    const raw = m.created_at;
    const ts =
      typeof raw === 'number' ? raw
        : typeof raw === 'string' ? Math.floor(Date.parse(raw) / 1000)
          : NaN;
    out.push({
      id: Number(m.id),
      conversation_id: 'boardroom',
      from_agent: inbound ? 'human' : ORCHESTRATOR_ID,
      to_agent: inbound ? ORCHESTRATOR_ID : 'human',
      content: text,
      message_type: 'text',
      metadata: null,
      read_at: null,
      created_at: Number.isFinite(ts) ? ts : Math.floor(Date.now() / 1000),
    });
  }
  return out;
}

export function AgentChatWidget({ department }: { department: Department }) {
  const [agents, setAgents] = useState<AgentItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(true);
  const [agentsError, setAgentsError] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(-1);
  // Guards the one-time "pick SOME agent so the operator can type immediately" bootstrap
  // below from re-firing after the first resolution — every resolution after that is a
  // deliberate lens-change switch, not a fallback pick.
  const initializedRef = useRef(false);

  // The picker's full option list: the Orchestrator first (injected — it's not in the
  // /api/agents roster), then the chattable sub-agents. `agents` (sub-agents only) still
  // drives the lens-lockstep resolution below, so a lens change never auto-picks the
  // orchestrator — it's a deliberate manual choice that then routes elsewhere.
  const pickerAgents = useMemo<AgentItem[]>(() => [ORCHESTRATOR, ...agents], [agents]);

  const activeAgent = activeId ? pickerAgents.find((a) => a.id === activeId) ?? null : null;
  const isOrchestrator = activeAgent?.id === ORCHESTRATOR_ID;

  // Load the roster once on mount (same source as the nav panel).
  useEffect(() => {
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(false);
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((payload) => {
        if (cancelled) return;
        setAgents(parseAgentsResponse(payload));
      })
      .catch(() => {
        if (!cancelled) setAgentsError(true);
      })
      .finally(() => {
        if (!cancelled) setAgentsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Keep the active agent in lockstep with the board's lens. First resolution (roster
  // just loaded, nothing picked yet) falls back to any executive / the first chattable
  // agent so the operator can type immediately, even if THIS lens has no exec of its
  // own. Every resolution after that fires only on a real department change and always
  // wins over a manual dropdown pick — unless the new lens has no seeded exec, in which
  // case we leave the current agent alone (no crash, no clearing the selection).
  useEffect(() => {
    // Wait for the roster fetch to settle so the first resolution sees the real squad
    // (and only then falls back to the orchestrator when there are no sub-agents at all).
    if (agentsLoading) return;
    const exec = execForDepartment(agents, department);
    if (!initializedRef.current) {
      initializedRef.current = true;
      // Prefer this lens's exec, then any exec, then the first chattable sub-agent, and
      // finally the Orchestrator — which is always present, so the tile is usable even on
      // a tenant with no seeded sub-agents (or when /api/agents fails to load).
      const fallback = exec ?? agents.find((a) => a.is_executive) ?? agents[0] ?? ORCHESTRATOR;
      setActiveId(fallback.id);
      return;
    }
    if (exec) setActiveId(exec.id);
  }, [department, agents, agentsLoading]);

  const loadHistory = useCallback(async (agentId: string) => {
    setHistoryLoading(true);
    setNeedsKey(false);
    try {
      // The orchestrator's thread is the shared Boardroom conversation — a different
      // endpoint + shape than the per-sub-agent /api/agent-chat history.
      if (agentId === ORCHESTRATOR_ID) {
        const res = await fetch('/api/boardroom/messages?limit=100', { cache: 'no-store' });
        if (!res.ok) {
          setMessages([]);
          return;
        }
        const data = await res.json();
        setMessages(boardroomToChat(data?.messages));
        return;
      }
      const res = await fetch(`/api/agent-chat?agentId=${encodeURIComponent(agentId)}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = await res.json();
      setMessages(Array.isArray(data?.messages) ? data.messages : []);
    } catch {
      setMessages([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!activeAgent) {
      setMessages([]);
      return;
    }
    loadHistory(activeAgent.id);
  }, [activeAgent, loadHistory]);

  // Keep the newest message in view by scrolling ONLY the internal thread container —
  // never Element.scrollIntoView(), which walks up and scrolls the page/window too. When
  // this widget sits at the TOP of the overview, that ancestor-scroll is exactly what
  // yanked the whole page down on load (history arrives → effect fires → page jumps).
  // Setting container.scrollTop is self-contained and can't move the page.
  useEffect(() => {
    const c = scrollRef.current;
    if (c) c.scrollTop = c.scrollHeight;
  }, [messages, thinking]);

  // Close the agent picker on an outside click or Escape — it's a small
  // dropdown, not a modal, so it should feel light and dismiss easily.
  useEffect(() => {
    if (!pickerOpen) return;
    function onPointerDown(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) setPickerOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setPickerOpen(false);
    }
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, [pickerOpen]);

  const handleSend = useCallback(
    async (text: string) => {
      if (!activeAgent || thinking) return;
      const agentId = activeAgent.id;

      tempIdRef.current -= 1;
      const tempId = tempIdRef.current;
      const optimistic: ChatMessage = {
        id: tempId,
        conversation_id: `agent_${agentId}`,
        from_agent: 'human',
        to_agent: agentId,
        content: text,
        message_type: 'text',
        metadata: null,
        read_at: null,
        created_at: Math.floor(Date.now() / 1000),
        pendingStatus: 'sending',
      };
      setMessages((prev) => [...prev, optimistic]);
      setThinking(true);
      setNeedsKey(false);

      // ── Orchestrator: route through the Boardroom, not /api/agent-chat ──────────────
      // POST /api/boardroom/ask runs a full orchestrator turn and always replies with
      // JSON ({ ok, reply, error }) — even on 429/502/503 — so we never parse nothing.
      if (agentId === ORCHESTRATOR_ID) {
        try {
          const res = await fetch('/api/boardroom/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ text }),
          });
          const data = await res.json().catch(() => null);
          if (res.ok && data?.ok) {
            const replyText = typeof data.reply === 'string' ? data.reply : '';
            setMessages((prev) => {
              const cleared = prev.map((m) =>
                m.id === tempId ? { ...m, pendingStatus: undefined } : m,
              );
              if (!replyText) return cleared;
              tempIdRef.current -= 1;
              const replyMsg: ChatMessage = {
                id: tempIdRef.current,
                conversation_id: 'boardroom',
                from_agent: ORCHESTRATOR_ID,
                to_agent: 'human',
                content: replyText,
                message_type: 'text',
                metadata: null,
                read_at: null,
                created_at: Math.floor(Date.now() / 1000),
              };
              return [...cleared, replyMsg];
            });
            return;
          }
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, pendingStatus: 'failed' as const } : m)),
          );
          toast.error(
            typeof data?.error === 'string' && data.error
              ? data.error
              : 'KeyPlayer could not respond. Try again.',
          );
        } catch {
          setMessages((prev) =>
            prev.map((m) => (m.id === tempId ? { ...m, pendingStatus: 'failed' as const } : m)),
          );
          toast.error('Network error — message not sent.');
        } finally {
          setThinking(false);
        }
        return;
      }

      try {
        const res = await fetch('/api/agent-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, message: text }),
        });

        if (res.ok) {
          const data = await res.json();
          const replyText =
            typeof data?.reply === 'string'
              ? data.reply
              : typeof data?.reply?.content === 'string'
                ? data.reply.content
                : '';
          setMessages((prev) => {
            const cleared = prev.map((m) =>
              m.id === tempId ? { ...m, pendingStatus: undefined } : m,
            );
            if (!replyText) return cleared;
            tempIdRef.current -= 1;
            const replyMsg: ChatMessage = {
              id: tempIdRef.current,
              conversation_id: `agent_${agentId}`,
              from_agent: agentId,
              to_agent: 'human',
              content: replyText,
              message_type: 'text',
              metadata: null,
              read_at: null,
              created_at: Math.floor(Date.now() / 1000),
            };
            return [...cleared, replyMsg];
          });
          return;
        }

        let errCode = '';
        try {
          const body = await res.json();
          errCode = String(body?.error ?? '');
        } catch {
          /* no JSON body */
        }
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pendingStatus: 'failed' as const } : m)),
        );
        if (res.status === 400 && errCode === 'connect_anthropic') {
          setNeedsKey(true);
        } else {
          toast.error('Could not reach that agent. Try again.');
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) => (m.id === tempId ? { ...m, pendingStatus: 'failed' as const } : m)),
        );
        toast.error('Network error — message not sent.');
      } finally {
        setThinking(false);
      }
    },
    [activeAgent, thinking],
  );

  const headerTint = `color-mix(in srgb, ${ACCENT} 10%, transparent)`;
  const headerBorder = `color-mix(in srgb, ${ACCENT} 24%, transparent)`;

  return (
    <div className="card flex flex-col overflow-hidden" style={{ height: 'clamp(560px, 68vh, 820px)' }}>
      {/* Header — accent dot + title on the left; a small, subtle agent
          picker (Claude's model-switcher pattern) on the right, instead of a
          persistent chip row that would compete with the conversation. */}
      <div
        className="flex shrink-0 items-center gap-2 px-5 py-3.5"
        style={{ background: headerTint, borderBottom: `1px solid ${headerBorder}` }}
      >
        <span
          className="h-2 w-2 shrink-0 rounded-full"
          style={{ background: ACCENT, boxShadow: `0 0 8px ${ACCENT}` }}
        />
        <MessageCircle size={15} style={{ color: ACCENT }} className="shrink-0" />
        <h3 className="truncate text-sm font-semibold" style={{ color: ACCENT }}>
          Command Chat
        </h3>

        <div className="relative ml-auto" ref={pickerRef}>
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            disabled={agentsLoading}
            aria-haspopup="listbox"
            aria-expanded={pickerOpen}
            className="flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-muted/50 hover:text-foreground active:scale-95 disabled:cursor-not-allowed disabled:opacity-50"
            style={{
              transition:
                'background-color var(--t-press) var(--ease-out), color var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)',
            }}
          >
            {activeAgent ? (
              // Keyed on the agent id so a switch — whether from a lens change or a
              // manual pick — remounts this span and replays the fade-in, a subtle
              // "the target just changed" cue instead of the label silently swapping.
              <span key={activeAgent.id} className="flex items-center gap-1.5 animate-in">
                <AgentIcon
                  id={activeAgent.id}
                  role={activeAgent.role}
                  department={asDepartment(activeAgent.department)}
                  size="sm"
                />
                <span className="max-w-[110px] truncate">{activeAgent.name}</span>
              </span>
            ) : (
              <span>{agentsLoading ? 'Loading…' : 'Select agent'}</span>
            )}
            <ChevronDown
              size={12}
              className="shrink-0"
              style={{
                transform: pickerOpen ? 'rotate(180deg)' : 'none',
                transition: 'transform var(--t-press) var(--ease-out)',
              }}
            />
          </button>

          {pickerOpen && pickerAgents.length > 0 && (
            <div
              role="listbox"
              aria-label="Choose an agent"
              className="glass-strong animate-in absolute right-0 top-[calc(100%+6px)] z-20 max-h-64 w-56 overflow-y-auto rounded-xl border border-border/60 p-1.5 shadow-xl"
            >
              {pickerAgents.map((a) => {
                const active = a.id === activeId;
                const isOrch = a.id === ORCHESTRATOR_ID;
                return (
                  <button
                    key={a.id}
                    type="button"
                    role="option"
                    aria-selected={active}
                    onClick={() => {
                      setActiveId(a.id);
                      setPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs active:scale-[0.98]"
                    style={{
                      background: active ? `color-mix(in srgb, ${ACCENT} 14%, transparent)` : 'transparent',
                      color: active ? ACCENT : 'var(--foreground)',
                      transition: 'background-color var(--t-press) var(--ease-out)',
                    }}
                  >
                    <AgentIcon id={a.id} role={a.role} department={asDepartment(a.department)} size="sm" />
                    <span className="min-w-0 flex-1 truncate font-medium">
                      {a.name}
                      {isOrch && <span className="text-muted-foreground/70"> — Orchestrator</span>}
                    </span>
                    {isOrch ? (
                      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/60">orch</span>
                    ) : a.is_executive ? (
                      <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/60">exec</span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {agentsError && (
        <div className="shrink-0 border-b border-border/40 px-5 py-2 text-[11px] text-destructive">
          Couldn’t load the rest of your squad — the Orchestrator is still available.
        </div>
      )}

      {/* Body — a centered conversation column (max-w-3xl) inside the
          full-width tile, so line length stays comfortable no matter how wide
          the board row is. */}
      <div className="flex min-h-0 flex-1 flex-col">
        {!activeAgent ? (
          <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
            <p className="text-sm text-muted-foreground/60">
              {agentsLoading ? 'Loading…' : 'Select an agent to start chatting.'}
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto">
              <div className="mx-auto flex w-full max-w-3xl flex-col px-6 py-8 sm:px-10">
                {historyLoading ? (
                  <div className="flex flex-1 items-center justify-center py-20">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70" />
                  </div>
                ) : messages.length === 0 ? (
                  <div className="flex flex-1 flex-col items-center justify-center gap-3 py-20 text-center">
                    <AgentIcon
                      id={activeAgent.id}
                      role={activeAgent.role}
                      department={asDepartment(activeAgent.department)}
                      size="lg"
                    />
                    <p className="text-base font-medium text-foreground/90">Chat with {activeAgent.name}</p>
                    <p className="max-w-sm text-sm text-muted-foreground/60">
                      {activeAgent.role ? `${activeAgent.role} · ` : ''}
                      {isOrchestrator
                        ? 'Ask anything — this is your Orchestrator, and this thread is shared with the Boardroom + iMessage.'
                        : 'Ask a question or hand off a task — replies land here and in the nav panel.'}
                    </p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {messages.map((m) => (
                      <MessageBubble
                        key={m.id}
                        message={m}
                        isHuman={m.from_agent === 'human' || m.from_agent === 'operator'}
                        isGrouped={false}
                        // Give the active agent's own bubbles its distinct identity icon
                        // (all assistant replies in this thread come from the selected agent).
                        agentId={activeAgent.id}
                        agentRole={activeAgent.role}
                        agentDepartment={asDepartment(activeAgent.department)}
                      />
                    ))}
                  </div>
                )}
                {thinking && (
                  <div className="mt-3 flex items-center gap-2 pl-9 text-[11px] text-muted-foreground/70">
                    <span className="flex gap-0.5">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-current" />
                    </span>
                    <span>{activeAgent.name} is thinking…</span>
                  </div>
                )}
              </div>
            </div>

            {/* Connect-key notice */}
            {needsKey && (
              <div className="mx-auto w-full max-w-3xl px-6 pb-2 sm:px-10">
                <div className="rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                  Connect your Anthropic key in <span className="font-semibold">Connections</span> to chat with agents.
                </div>
              </div>
            )}

            {/* Composer — a Claude-style elevated, rounded bar: a soft fade
                above it so the last message doesn't hard-cut against it, then
                the composer itself centered in the same max-w-3xl column. */}
            <div className="relative shrink-0 px-6 pb-6 sm:px-10">
              <div
                aria-hidden
                className="pointer-events-none absolute inset-x-0 -top-8 h-8"
                style={{ background: 'linear-gradient(to bottom, transparent, var(--card))' }}
              />
              <div className="relative mx-auto w-full max-w-3xl">
                <div
                  className="rounded-2xl"
                  style={{ boxShadow: `0 12px 32px -16px color-mix(in srgb, ${ACCENT} 35%, transparent)` }}
                >
                  <ChatComposer
                    onSend={handleSend}
                    busy={thinking}
                    accentVar={ACCENT}
                    placeholder={`Message ${activeAgent.name}…`}
                  />
                </div>
                <p className="mt-2 text-center text-[10px] text-muted-foreground/40">
                  {activeAgent.name} can loop in the rest of the squad when a task needs it.
                </p>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
