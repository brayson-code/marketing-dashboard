import { NextResponse } from 'next/server';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { sendIMessage, getOwnerPhone, isLoopMessageConfigured } from '@/lib/loopmessage';

interface BoardroomRow {
  id: number;
  direction: 'in' | 'out';
  sender: string;
  recipient: string | null;
  text: string;
  loop_message_id: string | null;
  status: string | null;
  metadata: Record<string, unknown> | null;
  attachments: unknown;
  created_at: Date;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Number(url.searchParams.get('limit') ?? 100), 500);

  const rows = (await sql()`
    SELECT * FROM boardroom_messages
    WHERE tenant_id = ${DEFAULT_TENANT_ID}
    ORDER BY created_at DESC, id DESC
    LIMIT ${limit}
  `) as unknown as BoardroomRow[];

  return NextResponse.json({
    configured: isLoopMessageConfigured(),
    owner_phone: getOwnerPhone(),
    messages: rows.reverse(),
  });
}

export async function POST(request: Request) {
  let body: { text?: string; recipient?: string; agent?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = body.text?.trim();
  if (!text) return NextResponse.json({ error: 'text is required' }, { status: 400 });

  const result = await sendIMessage(text, {
    recipient: body.recipient,
    agent: body.agent ?? 'owner',
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: result.status ?? 502 });
  }

  return NextResponse.json({ ok: true, message_id: result.messageId, status: result.status });
}
