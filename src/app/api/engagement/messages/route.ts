import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

interface InboundRow {
  id: number;
  sender: string;
  text: string;
  status: string | null;
  attachments: unknown;
  created_at: string; // ISO string from Postgres timestamptz
}

interface Conversation {
  sender: string;
  messages: Array<{ id: number; text: string; created_at: string; attachments: unknown; status: string | null }>;
  latest_at: string;
}

export async function GET(_req: Request) {
  enterTenant(await resolveTenant());

  const rows = (await sql()`
    SELECT id, sender, text, status, attachments, created_at
    FROM boardroom_messages
    WHERE tenant_id = ${tenantId()}
      AND direction = 'in'
    ORDER BY created_at DESC, id DESC
    LIMIT 50
  `) as unknown as InboundRow[];

  // Group into conversations keyed by sender. We iterate newest-first so the
  // first time we see a sender is their most-recent message — use that for
  // `latest_at`. Then reverse each conversation's messages to chronological
  // order (oldest first within a thread).
  const convMap = new Map<string, Conversation>();
  for (const row of rows) {
    const key = row.sender ?? 'unknown';
    const rawCa: unknown = row.created_at;
    const createdAt = rawCa instanceof Date ? rawCa.toISOString() : String(rawCa);
    if (!convMap.has(key)) {
      convMap.set(key, { sender: key, messages: [], latest_at: createdAt });
    }
    convMap.get(key)!.messages.push({
      id: row.id,
      text: row.text,
      created_at: createdAt,
      attachments: row.attachments,
      status: row.status,
    });
  }

  // Reverse message list per conversation so it reads oldest → newest.
  const conversations: Conversation[] = [];
  for (const conv of convMap.values()) {
    conv.messages.reverse();
    conversations.push(conv);
  }

  // Sort conversations by most-recent message descending.
  conversations.sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));

  return NextResponse.json({ conversations });
}
