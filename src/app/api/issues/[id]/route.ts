import { NextResponse } from 'next/server';
import { getIssue, getIssueEvents, getIssueTask, updateIssue, type IssueStatus, type IssuePriority } from '@/lib/observability';

export const dynamic = 'force-dynamic';

const STATUSES: IssueStatus[] = ['triage', 'assigned', 'fix_proposed', 'in_review', 'resolved', 'ignored'];
const PRIORITIES: IssuePriority[] = ['low', 'med', 'high', 'urgent'];

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const issue = await getIssue(id);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  const events = await getIssueEvents(id, 20);
  // The Fixer run for this issue (so the UI can show "what went wrong").
  const task = issue.task_id ? await getIssueTask(issue.task_id) : null;
  const hasPatch = Array.isArray(issue.proposed_patch) && issue.proposed_patch.length > 0;
  return NextResponse.json({ issue, events, task, hasPatch });
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let body: { status?: string; priority?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const fields: { status?: IssueStatus; priority?: IssuePriority } = {};
  if (body.status && STATUSES.includes(body.status as IssueStatus)) fields.status = body.status as IssueStatus;
  if (body.priority && PRIORITIES.includes(body.priority as IssuePriority)) fields.priority = body.priority as IssuePriority;
  if (!fields.status && !fields.priority) return NextResponse.json({ error: 'Nothing to update' }, { status: 400 });

  const issue = await updateIssue(id, fields);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ ok: true, issue });
}
