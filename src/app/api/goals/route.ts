import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { loadGoals, createGoal, updateGoalStatus, appendProgress, type GoalStatus } from '@/lib/goals';
import { sql, tenantId } from '@/lib/db/client';

export async function GET() {
  enterTenant(await resolveTenant());
  return NextResponse.json({ goals: await loadGoals() });
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  let body: {
    action?: string;
    title?: string;
    success?: string;
    due?: string;
    goal_id?: string;
    status?: GoalStatus;
    note?: string;
    is_north_star?: boolean;
    priority?: string;
    category?: string;
    owner_agent?: string;
  };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body.action === 'create') {
    if (!body.title || !body.success) {
      return NextResponse.json({ error: 'title and success are required' }, { status: 400 });
    }
    // Build metadata from the optional flags, dropping undefined keys so they
    // don't show up as JSON `null`s on the goal row.
    const metaSrc: Record<string, unknown> = {
      is_north_star: body.is_north_star,
      priority: body.priority,
      category: body.category,
      owner_agent: body.owner_agent,
    };
    const metadata: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(metaSrc)) {
      if (v !== undefined) metadata[k] = v;
    }

    // North Star is exclusive — at most one goal per tenant may carry the flag.
    // Clear it on any sibling goal BEFORE inserting the new one so a partial
    // failure can't leave two north stars in the same tenant.
    if (body.is_north_star === true) {
      await sql()`
        UPDATE goals
        SET metadata = metadata - 'is_north_star'
        WHERE tenant_id = ${tenantId()}
          AND metadata ? 'is_north_star'
      `;
    }

    const g = await createGoal({
      title: body.title,
      success: body.success,
      due: body.due || null,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
    return NextResponse.json({ ok: true, goal: g });
  }

  if (body.action === 'progress') {
    if (!body.goal_id || !body.note) return NextResponse.json({ error: 'goal_id and note are required' }, { status: 400 });
    const g = await appendProgress(body.goal_id, body.note);
    if (!g) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    return NextResponse.json({ ok: true, goal: g });
  }

  if (body.action === 'set_status') {
    if (!body.goal_id || !body.status) return NextResponse.json({ error: 'goal_id and status are required' }, { status: 400 });
    const g = await updateGoalStatus(body.goal_id, body.status, body.note);
    if (!g) return NextResponse.json({ error: 'Goal not found' }, { status: 404 });
    return NextResponse.json({ ok: true, goal: g });
  }

  return NextResponse.json({ error: 'Unknown action. Use: create | progress | set_status' }, { status: 400 });
}
