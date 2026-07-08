'use client';

// Per-agent favicon-style identity badge. A Lucide icon picked semantically per
// agent id, framed in a tinted square in the agent's department color.
// Replaces the emoji-as-identity pattern with something legible at any size.

import {
  Crown, Megaphone, DollarSign, Cog, Heart,
  PenLine, Film, Telescope, Brain, Send, Microscope, Image, CalendarDays, Bot,
  Sparkles, Wand2, Workflow, Command,
} from 'lucide-react';
import { colorForDepartment, type Department } from '@/components/agent-orb';

type LucideIcon = typeof Crown;

// Specific id-based mapping first; falls back to role-based; default Bot.
const BY_ID: Record<string, LucideIcon> = {
  'ai-ceo': Crown,
  'ai-cmo': Megaphone,
  'ai-cro': DollarSign,
  'ai-coo': Cog,
  'ai-cxo': Heart,
  'content-writer': PenLine,
  'hyperframes-agent': Film,
  // The orchestrator — a distinct "command" glyph (Crown is already the AI-CEO), so it
  // reads as the conductor of the squad wherever it appears (chat picker, message icons).
  'keyplayer': Command,
  'lead-research': Telescope,
  'memory-compactor': Brain,
  'outreach-sender': Send,
  'research-analyst': Microscope,
  'thumbnail-generator': Image,
  'calendar-scheduler': CalendarDays,
};

const BY_ROLE: Record<string, LucideIcon> = {
  orchestrator: Bot,
  content: PenLine,
  creative: Wand2,
  outreach: Send,
  research: Telescope,
  scheduler: CalendarDays,
  general: Sparkles,
};

const SIZE_PX: Record<'sm' | 'md' | 'lg', { box: number; icon: number; radius: number }> = {
  sm: { box: 22, icon: 12, radius: 6 },
  md: { box: 32, icon: 16, radius: 8 },
  lg: { box: 44, icon: 22, radius: 10 },
};

export function AgentIcon({
  id,
  role,
  department,
  size = 'md',
  pulse = false,
  asWorkflow = false,
}: {
  id?: string;
  role?: string;
  department?: Department | null;
  size?: 'sm' | 'md' | 'lg';
  pulse?: boolean;
  asWorkflow?: boolean;
}) {
  const Icon =
    (id && BY_ID[id]) ||
    (role && BY_ROLE[role]) ||
    (asWorkflow ? Workflow : Bot);
  const c = colorForDepartment(department ?? undefined);
  const { box, icon, radius } = SIZE_PX[size];

  return (
    <span
      aria-hidden
      className={pulse ? 'agent-icon agent-icon--pulse' : 'agent-icon'}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        width: box,
        height: box,
        borderRadius: radius,
        background: `color-mix(in srgb, ${c} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
        color: c,
        boxShadow: pulse ? `0 0 16px color-mix(in srgb, ${c} 35%, transparent)` : undefined,
        transition: 'box-shadow var(--t-popover) var(--ease-out)',
      }}
    >
      <Icon size={icon} strokeWidth={1.75} />
    </span>
  );
}
