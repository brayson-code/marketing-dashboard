import { NextResponse } from 'next/server';
import { listTasks } from '@/lib/agent-tasks';

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), 200);
  const tasks = await listTasks(limit);
  const running = tasks.filter((t) => t.status === 'running').length;
  return NextResponse.json({ tasks, counts: { running, total: tasks.length } });
}
