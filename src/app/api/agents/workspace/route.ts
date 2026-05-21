import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The agent file-workspace browser was backed by the server filesystem (OpenClaw
// home dirs), which doesn't exist on the cloud deployment. Return an empty
// listing so the page shows a clean "not available in the cloud" empty state
// instead of crashing. Writes are disabled.
export async function GET() {
  return NextResponse.json({ rootId: null, rootLabel: '', kind: 'workspace', writable: false, entries: [] });
}

export async function POST() {
  return NextResponse.json({ error: 'Workspace writes are not available in the cloud deployment.' }, { status: 403 });
}
