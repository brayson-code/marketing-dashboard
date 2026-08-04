// Personal Life — the founder's personal side of the Command Centre (North Star §12).
//
// Deliberately separate from tasks (company work) and CRM (sales pipeline): this is
// travel, birthdays, family logistics, health reminders and errands — the things an
// Executive Assistant carries so the founder doesn't have to remember them.
//
// Every query scopes by tenantId() — the backend connects as a role that BYPASSES RLS,
// so tenant isolation is this file's job, not the database's (see db/client.ts header).

import { sql, tenantId } from './db/client';

export const PERSONAL_CATEGORIES = ['travel', 'dates', 'family', 'health', 'errands'] as const;
export type PersonalCategory = (typeof PERSONAL_CATEGORIES)[number];

export const RECURRENCES = ['none', 'weekly', 'monthly', 'yearly'] as const;
export type Recurrence = (typeof RECURRENCES)[number];

export const PRIORITIES = ['low', 'normal', 'high'] as const;
export type Priority = (typeof PRIORITIES)[number];

export interface PersonalItem {
  id: number;
  category: PersonalCategory;
  title: string;
  details: string | null;
  person: string | null;
  due_at: string | null;
  /** Days before due_at that work must start. The "act by" date is due_at - lead_days. */
  lead_days: number;
  recurrence: Recurrence;
  status: 'open' | 'done';
  priority: Priority;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

/** One completed occurrence — what actually happened, and when. */
export interface PersonalOccurrence {
  id: number;
  item_id: number;
  occurred_at: string;
  note: string | null;
}

/**
 * When work has to START, not when the event happens. A birthday on the 12th with 7
 * days of lead time must be acted on by the 5th; reminding an assistant on the 12th is
 * already too late. Null when the item has no date at all.
 */
export function actByDate(item: Pick<PersonalItem, 'due_at' | 'lead_days'>): Date | null {
  if (!item.due_at) return null;
  const due = new Date(item.due_at);
  if (Number.isNaN(due.getTime())) return null;
  return new Date(due.getTime() - item.lead_days * 86_400_000);
}

/** Sensible default lead times, so an EA doesn't have to think about it for the common
 *  cases. Travel needs booking weeks out; a gift needs ordering the week before. */
export const DEFAULT_LEAD_DAYS: Record<PersonalCategory, number> = {
  travel: 21,
  dates: 7,
  family: 2,
  health: 7,
  errands: 0,
};

const CATEGORY_SET = new Set<string>(PERSONAL_CATEGORIES);
const RECURRENCE_SET = new Set<string>(RECURRENCES);
const PRIORITY_SET = new Set<string>(PRIORITIES);

export function isCategory(v: unknown): v is PersonalCategory {
  return typeof v === 'string' && CATEGORY_SET.has(v);
}
export function isRecurrence(v: unknown): v is Recurrence {
  return typeof v === 'string' && RECURRENCE_SET.has(v);
}
export function isPriority(v: unknown): v is Priority {
  return typeof v === 'string' && PRIORITY_SET.has(v);
}

/** All items for the tenant, optionally filtered to one category. Open items first,
 *  then soonest due (undated last), so the list reads as "what needs attention". */
export async function listPersonalItems(category?: PersonalCategory): Promise<PersonalItem[]> {
  const rows = category
    ? await sql()`
        SELECT * FROM personal_items
        WHERE tenant_id = ${tenantId()} AND category = ${category}
        ORDER BY status ASC, due_at ASC NULLS LAST, id DESC
      `
    : await sql()`
        SELECT * FROM personal_items
        WHERE tenant_id = ${tenantId()}
        ORDER BY status ASC, due_at ASC NULLS LAST, id DESC
      `;
  return rows as unknown as PersonalItem[];
}

/** The next N open, dated items across every category — powers "Coming up". */
export async function upcomingPersonalItems(limit = 5): Promise<PersonalItem[]> {
  const rows = await sql()`
    SELECT * FROM personal_items
    WHERE tenant_id = ${tenantId()} AND status = 'open' AND due_at IS NOT NULL
    ORDER BY due_at ASC
    LIMIT ${limit}
  `;
  return rows as unknown as PersonalItem[];
}

export async function createPersonalItem(input: {
  category: PersonalCategory;
  title: string;
  details?: string | null;
  person?: string | null;
  due_at?: string | null;
  lead_days?: number;
  recurrence?: Recurrence;
  priority?: Priority;
}): Promise<PersonalItem> {
  // No explicit lead time → fall back to the category default, so "flight to Phoenix"
  // automatically starts chasing the assistant three weeks out.
  const lead = Number.isFinite(input.lead_days as number)
    ? Math.max(0, Math.min(365, Math.trunc(input.lead_days as number)))
    : DEFAULT_LEAD_DAYS[input.category];
  const rows = await sql()`
    INSERT INTO personal_items
      (tenant_id, category, title, details, person, due_at, lead_days, recurrence, priority)
    VALUES (
      ${tenantId()}, ${input.category}, ${input.title},
      ${input.details ?? null}, ${input.person ?? null}, ${input.due_at ?? null},
      ${lead}, ${input.recurrence ?? 'none'}, ${input.priority ?? 'normal'}
    )
    RETURNING *
  `;
  return rows[0] as unknown as PersonalItem;
}

/** Everything that has happened for one item, newest first — the gift history. */
export async function itemHistory(itemId: number): Promise<PersonalOccurrence[]> {
  const rows = await sql()`
    SELECT id, item_id, occurred_at, note
    FROM personal_item_log
    WHERE tenant_id = ${tenantId()} AND item_id = ${itemId}
    ORDER BY occurred_at DESC
  `;
  return rows as unknown as PersonalOccurrence[];
}

/** History for many items in one round trip, keyed by item id (avoids N+1 on the list). */
export async function historyForItems(
  itemIds: number[],
): Promise<Record<number, PersonalOccurrence[]>> {
  if (itemIds.length === 0) return {};
  const rows = (await sql()`
    SELECT id, item_id, occurred_at, note
    FROM personal_item_log
    WHERE tenant_id = ${tenantId()} AND item_id = ANY(${itemIds}::bigint[])
    ORDER BY occurred_at DESC
  `) as unknown as PersonalOccurrence[];
  const out: Record<number, PersonalOccurrence[]> = {};
  for (const r of rows) (out[r.item_id] ??= []).push(r);
  return out;
}

/** Roll a recurring due date forward from the date just completed. Keeps the original
 *  day-of-month/weekday by leaning on Postgres interval arithmetic at write time. */
function nextDueExpr(recurrence: Recurrence): string | null {
  switch (recurrence) {
    case 'weekly': return '1 week';
    case 'monthly': return '1 month';
    case 'yearly': return '1 year';
    default: return null;
  }
}

/**
 * Complete an item. A one-off is marked done. A RECURRING one (a birthday, an annual
 * checkup) is NOT closed — it rolls forward to the next occurrence and stays open, which
 * is the whole point of tracking it: the EA should never have to re-create next year's
 * birthday by hand.
 */
export async function completePersonalItem(
  id: number,
  note?: string | null,
): Promise<PersonalItem | null> {
  const existing = await sql()`
    SELECT recurrence, due_at FROM personal_items
    WHERE tenant_id = ${tenantId()} AND id = ${id} LIMIT 1
  `;
  const row = existing[0] as unknown as { recurrence: Recurrence; due_at: string | null } | undefined;
  if (!row) return null;

  // Record the occurrence BEFORE the row changes. This is what makes gift history
  // possible at all — a recurring item rolls forward and would otherwise erase every
  // trace of what was actually done last time.
  await sql()`
    INSERT INTO personal_item_log (tenant_id, item_id, occurred_at, note)
    VALUES (${tenantId()}, ${id}, ${row.due_at ?? new Date().toISOString()}, ${note ?? null})
  `;

  const step = nextDueExpr(row.recurrence);
  if (step && row.due_at) {
    const rolled = await sql()`
      UPDATE personal_items
      SET due_at = due_at + ${step}::interval, updated_at = now()
      WHERE tenant_id = ${tenantId()} AND id = ${id}
      RETURNING *
    `;
    return (rolled[0] ?? null) as unknown as PersonalItem | null;
  }

  const done = await sql()`
    UPDATE personal_items
    SET status = 'done', completed_at = now(), updated_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING *
  `;
  return (done[0] ?? null) as unknown as PersonalItem | null;
}

export async function reopenPersonalItem(id: number): Promise<PersonalItem | null> {
  const rows = await sql()`
    UPDATE personal_items
    SET status = 'open', completed_at = NULL, updated_at = now()
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING *
  `;
  return (rows[0] ?? null) as unknown as PersonalItem | null;
}

export async function deletePersonalItem(id: number): Promise<boolean> {
  const rows = await sql()`
    DELETE FROM personal_items
    WHERE tenant_id = ${tenantId()} AND id = ${id}
    RETURNING id
  `;
  return rows.length > 0;
}
