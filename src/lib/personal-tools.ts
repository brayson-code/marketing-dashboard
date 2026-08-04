// Personal Life agent tools — the founder's personal side (travel, birthdays, family,
// health, errands), exposed to KeyPlayer and the sub-agents.
//
// WHY THESE EXIST: most real use of the Command Centre happens in a group chat (iMessage
// / Telegram) between the founder, the EA and the orchestrator. "Olivia's birthday is
// the 12th, sort a gift" should become a tracked item with the right lead time without
// anyone opening the web app. Without these tools the orchestrator can talk about the
// founder's personal life but can't actually record anything, so it gets forgotten —
// the exact failure Personal Life was built to stop.
//
// Mirrors native-tools.ts / jobber-tools.ts: one NAMES set + one definitions() + one
// handler dispatched by name. Reads are always safe. The writes are INTERNAL STATE ONLY
// — they create or complete a row the EA can see and undo. Nothing here messages anyone,
// books anything or spends money; anything outbound stays behind the existing
// draft→approval tools.
//
// WIRING (see the note at the top of native-tools.ts — miss one and the tool silently
// never runs, surfacing as "Orchestrator produced no text reply"):
//   orchestrator.ts — buildTools defs, CLIENT_TOOL_NAMES, handleClientToolUse dispatch,
//                     prompt-awareness block
//   subagent.ts     — tool filter, defs, handler dispatch
//
// Every underlying query is tenant-scoped via ./personal (WHERE tenant_id = tenantId()),
// and these handlers run inside a run that already entered the tenant context.

import Anthropic from '@anthropic-ai/sdk';
import {
  listPersonalItems,
  upcomingPersonalItems,
  createPersonalItem,
  completePersonalItem,
  itemHistory,
  isCategory,
  isRecurrence,
  isPriority,
  actByDate,
  DEFAULT_LEAD_DAYS,
  type PersonalItem,
} from './personal';
import { logAudit } from './audit';

export const PERSONAL_READ_TOOL_NAMES = [
  'list_personal_items',
  'read_personal_upcoming',
] as const;

export const PERSONAL_WRITE_TOOL_NAMES = [
  'add_personal_item',
  'complete_personal_item',
] as const;

export const PERSONAL_TOOL_NAMES = new Set<string>([
  ...PERSONAL_READ_TOOL_NAMES,
  ...PERSONAL_WRITE_TOOL_NAMES,
]);

function ok(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content };
}
function err(tool_use_id: string, content: string): Anthropic.ToolResultBlockParam {
  return { type: 'tool_result', tool_use_id, content, is_error: true };
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() ? v.trim() : undefined;
}
function clampLimit(v: unknown, def: number, max: number): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return def;
  return Math.min(Math.floor(n), max);
}

/** One line per item, including the act-by date — the whole point of the feature is that
 *  the agent reasons about when to START, not just when it's due. */
function line(i: PersonalItem): string {
  const by = actByDate(i);
  const due = i.due_at ? new Date(i.due_at).toISOString().slice(0, 10) : 'no date';
  const act = by ? by.toISOString().slice(0, 10) : null;
  const bits = [
    `[${i.category}]`,
    i.title,
    i.person ? `for ${i.person}` : null,
    `due ${due}`,
    act && i.lead_days > 0 ? `start by ${act}` : null,
    i.recurrence !== 'none' ? `repeats ${i.recurrence}` : null,
    i.priority !== 'normal' ? `${i.priority} priority` : null,
    i.status === 'done' ? 'DONE' : null,
    `[id=${i.id}]`,
  ].filter(Boolean);
  return `- ${bits.join(' · ')}`;
}

export function personalToolDefinitions(): Anthropic.Messages.ToolUnion[] {
  return [
    {
      name: 'list_personal_items',
      description:
        "List the founder's PERSONAL life items — travel, birthdays/gifts, family and household, " +
        'health routines, errands. Read-only. This is the founder\'s personal side, NOT company work ' +
        '(company tasks live in the tasks/goals tools). Each item shows its due date AND its ' +
        '"start by" date, which is when work actually has to begin.',
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['travel', 'dates', 'family', 'health', 'errands'],
            description: 'Filter to one part of their life. Omit for everything.',
          },
          limit: { type: 'number', description: 'Max items to return (default 25, max 100).' },
        },
      },
    },
    {
      name: 'read_personal_upcoming',
      description:
        "The founder's next personal commitments, soonest first — the answer to \"what's coming up " +
        'in their life?\". Read-only. Use this before saying anything about their availability, ' +
        'travel or personal calendar.',
      input_schema: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: 'How many to return (default 5, max 25).' },
        },
      },
    },
    {
      name: 'add_personal_item',
      description:
        "Record something in the founder's personal life so it doesn't get forgotten — a trip to " +
        'book, a birthday, a family commitment, a health appointment, an errand. Creates an ' +
        'internal item the assistant can see; it does NOT book, buy, message or spend anything. ' +
        'Set `lead_days` when work must start before the date (a gift needs ordering the week ' +
        'before; flights need booking weeks ahead) — if omitted a sensible default is applied per ' +
        'category. Use `recurrence: yearly` for birthdays and anniversaries so they roll forward ' +
        'automatically and never need re-creating.',
      input_schema: {
        type: 'object',
        properties: {
          category: {
            type: 'string',
            enum: ['travel', 'dates', 'family', 'health', 'errands'],
            description: 'Which part of their life this belongs to.',
          },
          title: { type: 'string', description: 'What it is, in plain language. e.g. "Olivia\'s birthday".' },
          person: { type: 'string', description: 'Who it concerns, if anyone. e.g. "Olivia".' },
          due_at: { type: 'string', description: 'When it happens, ISO 8601 (e.g. 2026-08-12T00:00:00Z). Omit if there is no fixed date.' },
          lead_days: { type: 'number', description: 'Days BEFORE due_at that work must start (0-365). Omit to use the category default.' },
          recurrence: { type: 'string', enum: ['none', 'weekly', 'monthly', 'yearly'], description: 'Use yearly for birthdays and anniversaries.' },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          details: { type: 'string', description: 'Notes worth remembering — preferences, confirmation numbers, context.' },
        },
        required: ['category', 'title'],
      },
    },
    {
      name: 'complete_personal_item',
      description:
        'Mark a personal item done, recording WHAT HAPPENED. Always pass `note` describing the ' +
        'outcome (the gift given, where they stayed) — that note becomes the permanent history for ' +
        'this item, so next year the assistant can see what was done last time instead of guessing. ' +
        'A recurring item is not closed: it rolls forward to the next occurrence automatically.',
      input_schema: {
        type: 'object',
        properties: {
          id: { type: 'number', description: 'The item id, from list_personal_items.' },
          note: { type: 'string', description: 'What actually happened. e.g. "Cartier bracelet — she loved it".' },
        },
        required: ['id'],
      },
    },
  ];
}

export async function handlePersonalTool(
  toolUse: Anthropic.ToolUseBlock,
  sourceAgent = 'keyplayer',
): Promise<Anthropic.ToolResultBlockParam> {
  const id = toolUse.id;
  const input = (toolUse.input ?? {}) as Record<string, unknown>;
  const audit = (action: string, detail: Record<string, unknown>) =>
    void logAudit({ actor: null, action, target: sourceAgent, detail }).catch(() => {});

  try {
    switch (toolUse.name) {
      case 'list_personal_items': {
        const cat = str(input.category);
        if (cat && !isCategory(cat)) {
          return err(id, 'list_personal_items: `category` must be one of travel, dates, family, health, errands.');
        }
        const limit = clampLimit(input.limit, 25, 100);
        const items = await listPersonalItems(cat && isCategory(cat) ? cat : undefined);
        if (items.length === 0) {
          return ok(id, cat ? `Nothing recorded under ${cat}.` : 'Nothing recorded in the founder\'s personal life yet.');
        }
        const shown = items.slice(0, limit);
        const more = items.length > shown.length
          ? `\n(+${items.length - shown.length} more; raise limit to see them)` : '';
        return ok(id, `${items.length} personal item(s), showing ${shown.length}:\n${shown.map(line).join('\n')}${more}`);
      }

      case 'read_personal_upcoming': {
        const limit = clampLimit(input.limit, 5, 25);
        const items = await upcomingPersonalItems(limit);
        if (items.length === 0) return ok(id, 'Nothing upcoming in the founder\'s personal life.');
        return ok(id, `Coming up:\n${items.map(line).join('\n')}`);
      }

      case 'add_personal_item': {
        const category = str(input.category);
        const title = str(input.title);
        if (!category || !isCategory(category)) {
          return err(id, 'add_personal_item: `category` is required and must be one of travel, dates, family, health, errands.');
        }
        if (!title) return err(id, 'add_personal_item: `title` is required.');

        const rawLead = input.lead_days;
        if (rawLead !== undefined
          && (!Number.isFinite(Number(rawLead)) || Number(rawLead) < 0 || Number(rawLead) > 365)) {
          return err(id, 'add_personal_item: `lead_days` must be a number between 0 and 365.');
        }
        // A date that won't parse is worse than no date — it would silently land as null
        // and the item would never surface at the right time.
        const due = str(input.due_at);
        if (due && Number.isNaN(new Date(due).getTime())) {
          return err(id, 'add_personal_item: `due_at` must be an ISO 8601 date, e.g. 2026-08-12T00:00:00Z.');
        }
        const rec = str(input.recurrence);
        if (rec && !isRecurrence(rec)) return err(id, 'add_personal_item: `recurrence` must be none, weekly, monthly or yearly.');
        const pri = str(input.priority);
        if (pri && !isPriority(pri)) return err(id, 'add_personal_item: `priority` must be low, normal or high.');

        const item = await createPersonalItem({
          category,
          title,
          person: str(input.person) ?? null,
          details: str(input.details) ?? null,
          due_at: due ?? null,
          lead_days: rawLead === undefined ? undefined : Number(rawLead),
          recurrence: rec && isRecurrence(rec) ? rec : 'none',
          priority: pri && isPriority(pri) ? pri : 'normal',
        });
        audit('agent.personal.create', { id: item.id, category: item.category, title: item.title });
        const by = actByDate(item);
        const when = by && item.lead_days > 0
          ? ` Work on it from ${by.toISOString().slice(0, 10)} (${item.lead_days} days before).`
          : '';
        const defaulted = rawLead === undefined && item.lead_days === DEFAULT_LEAD_DAYS[item.category]
          ? ` Lead time defaulted to ${item.lead_days} days for ${item.category}.` : '';
        return ok(id, `Recorded "${item.title}" under ${item.category} [id=${item.id}].${when}${defaulted} (Internal record only — nothing was booked, bought or sent.)`);
      }

      case 'complete_personal_item': {
        const itemId = Number(input.id);
        if (!Number.isFinite(itemId)) return err(id, 'complete_personal_item: numeric `id` is required.');
        const note = str(input.note) ?? null;
        const item = await completePersonalItem(itemId, note);
        if (!item) return err(id, `complete_personal_item: no personal item with id ${itemId}.`);
        audit('agent.personal.complete', { id: itemId, note });
        const past = await itemHistory(itemId);
        const historyLine = past.length > 1
          ? ` History now has ${past.length} entries.`
          : '';
        if (item.status === 'open' && item.due_at) {
          return ok(id, `Done, and recorded in history${note ? ` ("${note}")` : ''}. This one repeats, so it rolled forward to ${new Date(item.due_at).toISOString().slice(0, 10)}.${historyLine}`);
        }
        return ok(id, `Marked done and recorded in history${note ? ` ("${note}")` : ''}.${historyLine}`);
      }

      default:
        return err(id, `Unknown personal tool: ${toolUse.name}`);
    }
  } catch (e) {
    return err(id, `personal tool failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
