'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { MessageBubble } from '@/components/chat/message-bubble';
import { ChatComposer } from '@/components/chat/chat-composer';
import { toast } from '@/components/ui/toast';
import type { ChatMessage } from '@/types';

// The per-section agent chat that floats out of the left nav. Each nav section
// (Home, Agents, Creative, Marketing, Revenue, Insights, Ops, General) chats
// with a curated slice of the squad, tinted with that section's accent color.
//
// Flow:
//   - On open, fetch GET /api/agents and filter to this section's agents using
//     the SECTION→AGENTS map (executives for Agents/Home/General; department
//     "marketing" for Creative/Marketing; "revenue" for Revenue; "operations"
//     for Insights/Ops) plus an always-present "All agents" chip.
//   - Picking an agent loads its history (GET /api/agent-chat?agentId=…) and
//     lets you send (POST /api/agent-chat { agentId, message }).
//   - Optimistic user append → "thinking…" → reply. A 400 connect_anthropic
//     surfaces a Connections notice; other errors toast.
//
// Tenant isolation is enforced server-side; this component never touches sql().

interface Props {
  sectionLabel: string;
  /** CSS color value (e.g. "var(--dept-marketing)") used to tint the header + active chip. */
  accentVar: string;
  open: boolean;
  onClose: () => void;
}

interface AgentItem {
  id: string;
  name: string;
  emoji: string;
  role?: string;
  department?: string | null;
  is_executive?: boolean;
}

// Which department(s) / executive flag each section talks to. "executives"
// means is_executive === true (the C-suite). The keyplayer orchestrator is NOT
// chattable here (see NON_CHATTABLE) — it lives in the Boardroom.
type SectionFilter = { executives?: boolean; departments?: string[] };

function sectionFilterFor(label: string): SectionFilter {
  const key = label.trim().toLowerCase();
  switch (key) {
    case 'creative':
    case 'marketing':
      return { departments: ['marketing'] };
    case 'revenue':
      return { departments: ['revenue'] };
    case 'insights':
    case 'ops':
    case 'operations':
      return { departments: ['operations'] };
    case 'agents':
    case 'home':
    case 'general':
    default:
      // Executives (the C-suite) reachable from leadership-flavored sections;
      // "All agents" always offers the rest.
      return { executives: true };
  }
}

// Agents that CANNOT be chatted with here: keyplayer is the orchestrator (its home is
// the Boardroom and it can't run as a sub-agent), and fixer/improver are HQ/system
// agents. spawnSubAgent can't run these, so they must never appear as a chat target —
// excluded at the roster source below, so they're absent from every section + "All agents".
const NON_CHATTABLE = new Set<string>(['keyplayer', 'fixer', 'improver']);

function filterAgents(all: AgentItem[], filter: SectionFilter): AgentItem[] {
  if (filter.executives) {
    return all.filter((a) => a.is_executive);
  }
  if (filter.departments) {
    return all.filter((a) => a.department && filter.departments!.includes(a.department));
  }
  return all;
}

// Normalize whatever /api/agents returns ({ agents: [...] } or a flat array)
// into AgentItem[].
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

const ALL_AGENTS = '__all__';

export function NavAgentChatWidget({ sectionLabel, accentVar, open, onClose }: Props) {
  const [allAgents, setAllAgents] = useState<AgentItem[]>([]);
  const [agentsLoading, setAgentsLoading] = useState(false);
  const [agentsError, setAgentsError] = useState(false);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [needsKey, setNeedsKey] = useState(false);

  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(-1);

  const filter = sectionFilterFor(sectionLabel);
  const sectionAgents = filterAgents(allAgents, filter);
  // The active chip can be "All agents" (a meta view of the whole roster) or a
  // single agent id.
  const showingAll = activeId === ALL_AGENTS;
  const chipAgents = showingAll ? allAgents : sectionAgents;
  const activeAgent = activeId && activeId !== ALL_AGENTS ? allAgents.find((a) => a.id === activeId) ?? null : null;

  // Load the roster whenever the panel opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setAgentsLoading(true);
    setAgentsError(false);
    fetch('/api/agents')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((payload) => {
        if (cancelled) return;
        setAllAgents(parseAgentsResponse(payload));
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
  }, [open]);

  // Auto-select THE RESPECTIVE lead agent when the panel opens, so the user can start
  // typing immediately. Prefer the section's executive (CMO for Marketing, CRO for
  // Revenue, COO for Ops, the lead exec for Agents) over an arbitrary first match.
  useEffect(() => {
    if (!open) return;
    if (activeId) return;
    if (sectionAgents.length === 0) return;
    const lead = sectionAgents.find((a) => a.is_executive) ?? sectionAgents[0];
    setActiveId(lead.id);
  }, [open, activeId, sectionAgents]);

  // Load history when the active *agent* changes (the "All agents" meta view
  // has no thread of its own).
  const loadHistory = useCallback(async (agentId: string) => {
    setHistoryLoading(true);
    setNeedsKey(false);
    try {
      const res = await fetch(`/api/agent-chat?agentId=${encodeURIComponent(agentId)}`);
      if (!res.ok) {
        setMessages([]);
        return;
      }
      const data = await res.json();
      const list: ChatMessage[] = Array.isArray(data?.messages) ? data.messages : [];
      setMessages(list);
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

  // Auto-scroll to the newest message.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

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

      try {
        const res = await fetch('/api/agent-chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ agentId, message: text }),
        });

        if (res.ok) {
          const data = await res.json();
          // The route returns { reply: <string> } (the agent's text). Tolerate a
          // pre-built message object too, but the live contract is a string.
          const replyText =
            typeof data?.reply === 'string'
              ? data.reply
              : typeof data?.reply?.content === 'string'
                ? data.reply.content
                : '';
          setMessages((prev) => {
            // Clear the pending flag on the optimistic user message.
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

        // Non-OK: figure out why.
        let errCode = '';
        try {
          const body = await res.json();
          errCode = String(body?.error ?? '');
        } catch {
          /* no JSON body */
        }
        // Mark the user message as failed.
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

  if (!open) return null;

  const headerTint = `color-mix(in srgb, ${accentVar} 14%, transparent)`;
  const headerBorder = `color-mix(in srgb, ${accentVar} 30%, transparent)`;

  return (
    <div
      role="dialog"
      aria-label={`${sectionLabel} agents chat`}
      className="card glass-strong fixed bottom-6 left-[5.5rem] z-[90] flex w-[360px] flex-col overflow-hidden"
      style={{
        maxHeight: 'min(560px, calc(100vh - 3rem))',
        animation: 'slide-in-right var(--t-popover) var(--ease-out) both',
      }}
    >
      {/* Header */}
      <div
        className="flex shrink-0 items-center justify-between gap-2 px-4 py-3"
        style={{ background: headerTint, borderBottom: `1px solid ${headerBorder}` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ background: accentVar, boxShadow: `0 0 8px ${accentVar}` }}
          />
          <h3 className="truncate text-sm font-semibold" style={{ color: accentVar }}>
            {sectionLabel} agents
          </h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close chat"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/50 hover:text-foreground active:scale-95"
          style={{ transition: 'background-color var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)' }}
        >
          <X size={15} />
        </button>
      </div>

      {/* Agent chips */}
      <div className="shrink-0 border-b border-border/40 px-3 py-2.5">
        {agentsLoading ? (
          <div className="text-[11px] text-muted-foreground/60">Loading agents…</div>
        ) : agentsError ? (
          <div className="text-[11px] text-destructive">Couldn’t load agents.</div>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {chipAgents.map((a) => {
              const active = a.id === activeId;
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setActiveId(a.id)}
                  className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium active:scale-95"
                  style={{
                    borderColor: active ? accentVar : 'var(--border)',
                    background: active ? `color-mix(in srgb, ${accentVar} 16%, transparent)` : 'transparent',
                    color: active ? accentVar : 'var(--muted-foreground)',
                    transition:
                      'background-color var(--t-press) var(--ease-out), border-color var(--t-press) var(--ease-out), color var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)',
                  }}
                >
                  <span aria-hidden>{a.emoji}</span>
                  <span className="truncate max-w-[120px]">{a.name}</span>
                </button>
              );
            })}
            {/* Always-present escape hatch to reach the whole roster. */}
            <button
              type="button"
              onClick={() => setActiveId(ALL_AGENTS)}
              className="flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium active:scale-95"
              style={{
                borderColor: showingAll ? accentVar : 'var(--border)',
                background: showingAll ? `color-mix(in srgb, ${accentVar} 16%, transparent)` : 'transparent',
                color: showingAll ? accentVar : 'var(--muted-foreground)',
                transition:
                  'background-color var(--t-press) var(--ease-out), border-color var(--t-press) var(--ease-out), color var(--t-press) var(--ease-out), transform var(--t-press) var(--ease-out)',
              }}
            >
              All agents
            </button>
          </div>
        )}
      </div>

      {/* Body */}
      <div className="flex min-h-0 flex-1 flex-col">
        {showingAll ? (
          <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
            <p className="text-xs text-muted-foreground/60">
              Pick any agent above to start a conversation.
            </p>
          </div>
        ) : !activeAgent ? (
          <div className="flex flex-1 items-center justify-center px-6 py-8 text-center">
            <p className="text-xs text-muted-foreground/60">
              {sectionAgents.length === 0 && !agentsLoading
                ? 'No agents in this section yet — try “All agents”.'
                : 'Select an agent to start chatting.'}
            </p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-3">
              {historyLoading ? (
                <div className="flex h-full items-center justify-center">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-muted-foreground/30 border-t-muted-foreground/70" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full items-center justify-center px-4 text-center">
                  <p className="text-xs text-muted-foreground/50">
                    Say hi to {activeAgent.name} {activeAgent.emoji}
                  </p>
                </div>
              ) : (
                <>
                  {messages.map((m) => (
                    <MessageBubble
                      key={m.id}
                      message={m}
                      isHuman={m.from_agent === 'human' || m.from_agent === 'operator'}
                      isGrouped={false}
                    />
                  ))}
                </>
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
              <div ref={bottomRef} />
            </div>

            {/* Connect-key notice */}
            {needsKey && (
              <div className="mx-3 mb-2 rounded-lg border border-warning/30 bg-warning/10 px-3 py-2 text-[11px] text-warning">
                Connect your Anthropic key in <span className="font-semibold">Connections</span> to chat with agents.
              </div>
            )}

            {/* Composer */}
            <div className="shrink-0 border-t border-border/40 p-3">
              <ChatComposer
                onSend={handleSend}
                busy={thinking}
                accentVar={accentVar}
                placeholder={`Message ${activeAgent.name}…`}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
