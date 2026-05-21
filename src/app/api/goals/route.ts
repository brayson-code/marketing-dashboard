import { NextResponse } from 'next/server';
import { loadGoals, createGoal, updateGoalStatus, appendProgress, type GoalStatus } from '@/lib/goals';

export async function GET() {
  return NextResponse.json({ goals: await loadGoals() });
}

export async function POST(request: Request) {
  let body: { action?: string; title?: string; success?: string; due?: string; goal_id?: string; status?: GoalStatus; note?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  if (body.action === 'create') {
    if (!body.title || !body.success) {
      return NextResponse.json({ error: 'title and success are required' }, { status: 400 });
    }
    const g = await createGoal({ title: body.title, success: body.success, due: body.due || null });
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
