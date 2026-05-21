import { NextResponse } from 'next/server';
import { getIssue, updateIssue } from '@/lib/observability';
import { openFixPr } from '@/lib/fixer';
import { isGitHubConfigured } from '@/lib/github';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// Approve a proposed fix → open the draft PR from the EXACT stored patch (no LLM
// re-run). Requires a GitHub token with write access; with a read-only token
// this returns a clear error explaining what's needed.
export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const issue = await getIssue(id);
  if (!issue) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const files = Array.isArray(issue.proposed_patch) ? issue.proposed_patch.filter((f) => f && f.path && typeof f.new_content === 'string') : [];
  if (files.length === 0) {
    return NextResponse.json({ error: 'No proposed patch on this issue. Run the Fixer first.' }, { status: 400 });
  }
  if (!isGitHubConfigured()) {
    return NextResponse.json({ error: 'GitHub is not configured (set GITHUB_TOKEN).' }, { status: 400 });
  }

  try {
    const prUrl = await openFixPr({
      issueId: id,
      issueTitle: issue.title,
      files,
      rootCause: issue.root_cause ?? '',
      summary: issue.suggested_fix?.split('\n')[0] ?? issue.title,
    });
    const updated = await updateIssue(id, { status: 'in_review', pr_url: prUrl });
    return NextResponse.json({ ok: true, pr_url: prUrl, issue: updated });
  } catch (err) {
    // Most common: token lacks Contents/Pull-requests WRITE (your token is read-only).
    return NextResponse.json({ error: `Could not open PR: ${(err as Error).message.slice(0, 200)}` }, { status: 502 });
  }
}
