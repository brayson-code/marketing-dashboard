import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import {
  listPersonalItems,
  createPersonalItem,
  completePersonalItem,
  reopenPersonalItem,
  deletePersonalItem,
  historyForItems,
  isCategory,
  isRecurrence,
  isPriority,
} from '@/lib/personal';

// Personal Life items (North Star §12). Mirrors the goals route: tenant entered first,
// an `action` discriminator on POST, and validation at the boundary — the domain lib
// trusts its inputs.

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const raw = new URL(request.url).searchParams.get('category');
  // No ?category → list everything. A category that isn't in the catalog is a client
  // bug, not an empty list, so say so rather than silently returning all items.
  if (raw !== null && !isCategory(raw)) {
    return NextResponse.json({ error: 'Unknown category' }, { status: 400 });
  }
  const category = raw === null ? undefined : raw;
  const items = await listPersonalItems(category);
  // History comes back with the list in ONE query (not one per row) so the page can show
  // "what did we do last year?" inline without an N+1.
  const history = await historyForItems(items.map((i) => i.id));
  return NextResponse.json({ items, history });
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  let body: {
    action?: string;
    id?: number;
    category?: string;
    title?: string;
    details?: string;
    person?: string;
    due_at?: string | null;
    lead_days?: number;
    recurrence?: string;
    priority?: string;
    note?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const action = body.action ?? 'create';

  if (action === 'create') {
    if (!isCategory(body.category)) {
      return NextResponse.json({ error: 'A valid category is required' }, { status: 400 });
    }
    const title = body.title?.trim();
    if (!title) {
      return NextResponse.json({ error: 'title is required' }, { status: 400 });
    }
    if (body.recurrence !== undefined && !isRecurrence(body.recurrence)) {
      return NextResponse.json({ error: 'Unknown recurrence' }, { status: 400 });
    }
    if (body.priority !== undefined && !isPriority(body.priority)) {
      return NextResponse.json({ error: 'Unknown priority' }, { status: 400 });
    }
    if (body.lead_days !== undefined
      && (!Number.isFinite(body.lead_days) || body.lead_days < 0 || body.lead_days > 365)) {
      return NextResponse.json({ error: 'lead_days must be between 0 and 365' }, { status: 400 });
    }
    const item = await createPersonalItem({
      category: body.category,
      title,
      details: body.details?.trim() || null,
      person: body.person?.trim() || null,
      due_at: body.due_at || null,
      lead_days: body.lead_days,
      recurrence: isRecurrence(body.recurrence) ? body.recurrence : 'none',
      priority: isPriority(body.priority) ? body.priority : 'normal',
    });
    return NextResponse.json({ item }, { status: 201 });
  }

  if (typeof body.id !== 'number') {
    return NextResponse.json({ error: 'id is required' }, { status: 400 });
  }

  if (action === 'complete') {
    // The optional note is what turns completion into history ("gave her the bracelet").
    const item = await completePersonalItem(body.id, body.note?.trim() || null);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item });
  }

  if (action === 'reopen') {
    const item = await reopenPersonalItem(body.id);
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ item });
  }

  if (action === 'delete') {
    const ok = await deletePersonalItem(body.id);
    if (!ok) return NextResponse.json({ error: 'Not found' }, { status: 404 });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 });
}
