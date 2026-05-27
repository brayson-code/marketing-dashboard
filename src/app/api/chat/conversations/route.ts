import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';
import { requireUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

interface ConversationRow {
  conversation_id: string;
  last_message_at: number;
  message_count: number;
  unread_count: number;
}

interface MessageRow {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  read_at: number | null;
  created_at: number;
}

export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  try {
    const s = sql();

    const actor = requireUser(request as Request);
    const username = (typeof actor?.username === 'string' && actor.username.trim()) ? actor.username.trim() : 'operator';

    // created_at is timestamptz in Supabase; expose epoch seconds for back-compat.
    const conversations = await s`
      SELECT
        m.conversation_id,
        EXTRACT(EPOCH FROM MAX(m.created_at))::bigint as last_message_at,
        COUNT(*) as message_count,
        SUM(CASE WHEN m.read_at IS NULL AND m.from_agent != ${username} THEN 1 ELSE 0 END) as unread_count
      FROM messages m
      WHERE m.tenant_id = ${tenantId()}
      GROUP BY m.conversation_id
      ORDER BY last_message_at DESC
    ` as unknown as ConversationRow[];

    const withLastMessage = await Promise.all(
      conversations.map(async (conv) => {
        const lastRows = await s`
          SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at,
                 EXTRACT(EPOCH FROM created_at)::bigint as created_at
          FROM messages
          WHERE conversation_id = ${conv.conversation_id} AND tenant_id = ${tenantId()}
          ORDER BY created_at DESC
          LIMIT 1
        ` as unknown as MessageRow[];
        const lastMsg = lastRows[0];

        return {
          id: conv.conversation_id,
          ...conv,
          message_count: Number(conv.message_count),
          unread_count: Number(conv.unread_count),
          last_message: lastMsg
            ? { ...lastMsg, metadata: lastMsg.metadata ?? null }
            : null,
        };
      }),
    );

    return NextResponse.json({ conversations: withLastMessage });
  } catch (error) {
    console.error('GET /api/chat/conversations error:', error);
    return NextResponse.json({ error: 'Failed to fetch conversations' }, { status: 500 });
  }
}
