import {
  listDrafts,
  approveDraft,
  rejectDraft,
  publishContent,
  sendEmail,
  confirmMeeting,
  getDraft,
} from './drafts';
import { listActiveGoals, updateGoalStatus } from './goals';

export type Intent =
  | { type: 'approve'; id: number }
  | { type: 'reject'; id: number }
  | { type: 'publish'; id: number }
  | { type: 'send'; id: number }
  | { type: 'confirm'; id: number }
  | { type: 'list_drafts' }
  | { type: 'list_goals' }
  | { type: 'goal_done'; goalId: string }
  | { type: 'help' };

const NUM = '#?(\\d+)';

const PATTERNS: Array<{ rx: RegExp; build: (m: RegExpMatchArray) => Intent }> = [
  // Approve / reject — accept many natural variants.
  { rx: new RegExp(`^(?:approve|approved|ok|okay|yes|yup|yep|go|👍|✓|✅)\\s+(?:draft\\s+)?${NUM}\\s*\\.?$`, 'i'), build: (m) => ({ type: 'approve', id: Number(m[1]) }) },
  { rx: new RegExp(`^(?:reject|rejected|no|nope|kill|cancel|👎|✗|❌)\\s+(?:draft\\s+)?${NUM}\\s*\\.?$`, 'i'), build: (m) => ({ type: 'reject', id: Number(m[1]) }) },

  // Execute shortcuts (these imply approval if pending).
  { rx: new RegExp(`^publish\\s+(?:draft\\s+)?${NUM}\\s*\\.?$`, 'i'), build: (m) => ({ type: 'publish', id: Number(m[1]) }) },
  { rx: new RegExp(`^send\\s+(?:draft\\s+|email\\s+)?${NUM}\\s*\\.?$`, 'i'), build: (m) => ({ type: 'send', id: Number(m[1]) }) },
  { rx: new RegExp(`^(?:confirm|book)\\s+(?:draft\\s+|meeting\\s+)?${NUM}\\s*\\.?$`, 'i'), build: (m) => ({ type: 'confirm', id: Number(m[1]) }) },

  // Listings
  { rx: /^(?:drafts?|pending|queue|inbox)\.?$/i, build: () => ({ type: 'list_drafts' }) },
  { rx: /^goals?\.?$/i, build: () => ({ type: 'list_goals' }) },

  // Goal done
  { rx: /^(?:goal\s+)?done\s+(g-[\w-]+)\.?$/i, build: (m) => ({ type: 'goal_done', goalId: m[1] }) },

  // Help
  { rx: /^(?:help|commands?|\?)\.?$/i, build: () => ({ type: 'help' }) },
];

export function parseIntent(text: string): Intent | null {
  const trimmed = text.trim();
  if (trimmed.length === 0 || trimmed.length > 100) return null;
  for (const { rx, build } of PATTERNS) {
    const m = trimmed.match(rx);
    if (m) return build(m);
  }
  return null;
}

const HELP_TEXT = `📋 KeyPlayers commands

• drafts — list pending drafts
• approve <id> — approve a pending draft
• reject <id> — reject a pending draft
• publish <id> — publish an approved content post
• send <id> — send an approved email
• confirm <id> — confirm an approved meeting
• goals — list active goals
• done <goal-id> — mark a goal complete

Anything else routes to KeyPlayer for a full conversation.`;

export interface IntentResult {
  reply: string;
  acted: boolean;
}

export async function executeIntent(intent: Intent): Promise<IntentResult> {
  switch (intent.type) {
    case 'help':
      return { reply: HELP_TEXT, acted: true };

    case 'list_drafts': {
      const pending = await listDrafts({ status: 'pending', limit: 20 });
      if (pending.length === 0) return { reply: 'No drafts awaiting your review. 🟢', acted: true };
      const lines = pending.map((d) => `#${d.id} [${d.type}] ${d.title}`);
      return { reply: `${pending.length} pending:\n${lines.join('\n')}\n\nReply "approve <id>" or "reject <id>".`, acted: true };
    }

    case 'list_goals': {
      const active = await listActiveGoals();
      if (active.length === 0) return { reply: 'No active goals. 🎯', acted: true };
      const lines = active.map((g) => `${g.id} — ${g.title}${g.due ? ` (due ${g.due})` : ''} [${g.status}]`);
      return { reply: `${active.length} active:\n${lines.join('\n')}`, acted: true };
    }

    case 'approve': {
      const before = await getDraft(intent.id);
      if (!before) return { reply: `No draft #${intent.id}.`, acted: false };
      if (before.status !== 'pending') return { reply: `Draft #${intent.id} is already ${before.status}, not pending.`, acted: false };
      const d = await approveDraft(intent.id);
      return { reply: `✓ Approved draft #${intent.id} — "${d?.title}". Reply "${execHint(d?.type)} ${intent.id}" to execute.`, acted: true };
    }

    case 'reject': {
      const before = await getDraft(intent.id);
      if (!before) return { reply: `No draft #${intent.id}.`, acted: false };
      if (before.status !== 'pending') return { reply: `Draft #${intent.id} is already ${before.status}, not pending.`, acted: false };
      const d = await rejectDraft(intent.id);
      return { reply: `✗ Rejected draft #${intent.id} — "${d?.title}".`, acted: true };
    }

    case 'publish':
    case 'send':
    case 'confirm': {
      const before = await getDraft(intent.id);
      if (!before) return { reply: `No draft #${intent.id}.`, acted: false };
      // Auto-approve if still pending, so single-step execution is possible.
      if (before.status === 'pending') await approveDraft(intent.id);
      const fn = intent.type === 'publish' ? publishContent : intent.type === 'send' ? sendEmail : confirmMeeting;
      const r = await fn(intent.id);
      if (!r.ok) return { reply: `Could not ${intent.type} #${intent.id}: ${r.error}`, acted: false };
      const verb = intent.type === 'publish' ? 'Published' : intent.type === 'send' ? 'Sent' : 'Confirmed';
      const note = r.draft?.execution_note ? ` (${r.draft.execution_note})` : '';
      return { reply: `${verb} #${intent.id} — "${r.draft?.title}".${note}`, acted: true };
    }

    case 'goal_done': {
      const g = await updateGoalStatus(intent.goalId, 'done', 'marked done by owner via iMessage');
      if (!g) return { reply: `No goal ${intent.goalId}.`, acted: false };
      return { reply: `✓ Goal "${g.title}" marked done. Revert from /goals if needed.`, acted: true };
    }
  }
}

function execHint(type?: string): string {
  if (type === 'content_post') return 'publish';
  if (type === 'email') return 'send';
  if (type === 'meeting') return 'confirm';
  return 'publish'; // safe default
}
