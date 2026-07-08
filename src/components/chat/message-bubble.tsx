'use client';

import { memo } from 'react';
import type { ChatMessage } from '@/types';
import { AgentIcon } from '@/components/agent-icon';
import type { Department } from '@/components/agent-orb';

const AGENT_THEMES: Record<string, { bg: string; text: string; border: string }> = {
  hermes: { bg: 'bg-amber-500/10', text: 'text-amber-400', border: 'border-amber-500/20' },
  apollo: { bg: 'bg-blue-500/10', text: 'text-blue-400', border: 'border-blue-500/20' },
  system: { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-border' },
  nyk: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' },
  human: { bg: 'bg-primary/10', text: 'text-primary', border: 'border-primary/20' },
};

function getTheme(name: string) {
  return AGENT_THEMES[name.toLowerCase()] || { bg: 'bg-muted/50', text: 'text-muted-foreground', border: 'border-border' };
}

function formatTime(ts: number): string {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function renderContent(text: string) {
  const parts = text.split(/(```[\s\S]*?```|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith('```') && part.endsWith('```')) {
      const code = part.slice(3, -3).replace(/^\w+\n/, '');
      return <pre key={i} className="bg-black/30 rounded-md px-3 py-2 my-1 text-xs font-mono overflow-x-auto whitespace-pre-wrap">{code}</pre>;
    }
    if (part.startsWith('`') && part.endsWith('`')) {
      return <code key={i} className="bg-black/20 rounded px-1 py-0.5 text-xs font-mono">{part.slice(1, -1)}</code>;
    }
    return (
      <span key={i}>
        {part.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g).map((seg, j) => {
          if (seg.startsWith('**') && seg.endsWith('**'))
            return <strong key={j} className="font-semibold">{seg.slice(2, -2)}</strong>;
          if (seg.startsWith('*') && seg.endsWith('*'))
            return <em key={j}>{seg.slice(1, -1)}</em>;
          return seg;
        })}
      </span>
    );
  });
}

interface Props {
  message: ChatMessage;
  isHuman: boolean;
  isGrouped: boolean;
  // When supplied for an AGENT (non-human) message, render that agent's distinct
  // identity icon (AgentIcon) in the avatar slot instead of the initial-letter circle.
  // Passed as scalars (not a node) so the memo boundary below can keep its O(1) bail-out.
  // Absent → the original letter avatar, so every other MessageBubble caller is unaffected.
  agentId?: string;
  agentRole?: string;
  agentDepartment?: Department | null;
}

// MEMOIZATION NOTE: a message here always arrives complete (one JSON reply, no
// token-by-token growth — see src/components/chat/markdown-memo.tsx for how
// streaming actually arrives across this app's chat surfaces) and this list is
// re-fetched once per agent switch, not on a recurring poll. So there's no
// "growing tail" within a single message to split into stable/unstable blocks
// — a static message keeps its current (unmemoized-inline) render path.
//
// What DOES churn a lot here: every send/receive flips `thinking`, and every new
// message appended re-creates the `messages` array, both of which re-render the
// WHOLE list — including every already-rendered bubble whose props never
// changed. Without a memo boundary, React still re-invokes each bubble's render
// (and re-parses its markdown) on every one of those ticks. Wrapping the export
// in `memo` with a value comparator turns that into an O(1) bail-out for every
// bubble except the one that actually changed.
function MessageBubbleImpl({ message, isHuman, isGrouped, agentId, agentRole, agentDepartment }: Props) {
  const theme = getTheme(message.from_agent);
  // Show the agent's distinct icon only for its own (non-human) bubbles when a caller
  // opts in by passing the agent's identity.
  const showAgentIcon = !isHuman && (agentId != null || agentDepartment != null || agentRole != null);

  if (message.message_type === 'system') {
    return (
      <div className="flex justify-center my-3">
        <div className="text-[11px] text-muted-foreground/70 bg-muted/30 px-3 py-1 rounded-full border border-border/30">
          {message.content}
        </div>
      </div>
    );
  }

  if (message.message_type === 'handoff') {
    return (
      <div className="flex justify-center my-3">
        <div className="flex items-center gap-2 text-[11px] text-amber-400/80 bg-amber-500/5 px-3 py-1.5 rounded-full border border-amber-500/20">
          <span>{message.from_agent}</span>
          <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><path d="M5 3l6 5-6 5" /></svg>
          <span>{message.to_agent}</span>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex gap-2 ${isHuman ? 'flex-row-reverse' : 'flex-row'} ${isGrouped ? 'mt-0.5' : 'mt-3'}`}>
      {!isGrouped ? (
        showAgentIcon ? (
          <span className="w-7 h-7 flex items-center justify-center shrink-0">
            <AgentIcon id={agentId} role={agentRole} department={agentDepartment ?? undefined} size="sm" />
          </span>
        ) : (
          <div className={`w-7 h-7 rounded-full flex items-center justify-center shrink-0 text-[10px] font-bold ${theme.bg} ${theme.text} border ${theme.border}`}>
            {message.from_agent.charAt(0).toUpperCase()}
          </div>
        )
      ) : (
        <div className="w-7 shrink-0" />
      )}

      <div className={`max-w-[80%] min-w-0 ${isHuman ? 'items-end' : 'items-start'}`}>
        {!isGrouped && (
          <div className={`flex items-center gap-1.5 mb-0.5 ${isHuman ? 'flex-row-reverse' : 'flex-row'}`}>
            <span className={`text-[11px] font-medium ${theme.text}`}>{message.from_agent}</span>
            {message.to_agent && (
              <span className="text-[10px] text-muted-foreground/50 flex items-center gap-0.5">
                <svg width="8" height="8" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M5 3l6 5-6 5" /></svg>
                {message.to_agent}
              </span>
            )}
            <span className="text-[10px] text-muted-foreground/40">{formatTime(message.created_at)}</span>
          </div>
        )}

        <div className={`rounded-xl px-3 py-2 text-sm leading-relaxed ${
          isHuman
            ? 'bg-primary text-primary-foreground rounded-tr-sm'
            : `bg-muted/30 text-foreground ${isGrouped ? 'rounded-tl-sm' : 'rounded-tl-sm'}`
        } ${message.pendingStatus === 'sending' ? 'opacity-60' : ''}`}>
          <div className="whitespace-pre-wrap break-words">{renderContent(message.content)}</div>
        </div>
        {message.pendingStatus === 'failed' && (
          <span className="text-[10px] text-destructive mt-0.5 block">Failed to send</span>
        )}
      </div>
    </div>
  );
}

export const MessageBubble = memo(MessageBubbleImpl, (prev, next) =>
  prev.message.id === next.message.id &&
  prev.message.content === next.message.content &&
  prev.message.pendingStatus === next.message.pendingStatus &&
  prev.message.to_agent === next.message.to_agent &&
  prev.message.from_agent === next.message.from_agent &&
  prev.isHuman === next.isHuman &&
  prev.isGrouped === next.isGrouped &&
  prev.agentId === next.agentId &&
  prev.agentRole === next.agentRole &&
  prev.agentDepartment === next.agentDepartment,
);
