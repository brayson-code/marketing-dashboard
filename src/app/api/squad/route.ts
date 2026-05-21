import { NextResponse } from 'next/server';
import { getSquad } from '@/lib/squad';

export const dynamic = 'force-dynamic';

// The real agent roster + live stats. Auth enforced by the Supabase middleware.
export async function GET() {
  try {
    const agents = await getSquad();
    return NextResponse.json({ agents });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message, agents: [] }, { status: 500 });
  }
}
