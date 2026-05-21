import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// The agent file-workspace was a server filesystem feature (OpenClaw home dirs).
// The cloud deployment has no persistent server filesystem, so there are no
// workspace roots. Returns an empty list so the page renders a clean empty state.
export async function GET() {
  return NextResponse.json({ instance: 'default', roots: [] });
}
