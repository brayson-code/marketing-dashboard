import { NextResponse } from 'next/server';
import { listIssues, type IssueStatus } from '@/lib/observability';
import { fixerCapabilities } from '@/lib/fixer';

export const dynamic = 'force-dynamic';

const STATUSES: IssueStatus[] = ['triage', 'assigned', 'fix_proposed', 'in_review', 'resolved', 'ignored'];

// Auth enforced by the Supabase middleware (proxy.ts).
export async function GET(request: Request) {
  const url = new URL(request.url);
  const statusParam = url.searchParams.get('status');
  const status = statusParam && STATUSES.includes(statusParam as IssueStatus) ? (statusParam as IssueStatus) : undefined;
  const issues = await listIssues({ status, limit: Number(url.searchParams.get('limit') ?? 200) });
  return NextResponse.json({ issues, capabilities: fixerCapabilities() });
}
