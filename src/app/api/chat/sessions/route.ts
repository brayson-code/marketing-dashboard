import { NextResponse } from 'next/server';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { requireApiUser } from '@/lib/api-auth';

/**
 * GET /api/chat/sessions
 * Returns a list of synced agent sessions with message counts and previews.
 */
export async function GET(request: Request) {
  const auth = requireApiUser(request as Request);
  if (auth) return auth;
  const s = sql();

  // created_at is timestamptz; expose epoch seconds for back-compat.
  const rows = await s`
    SELECT
      conversation_id,
      COUNT(*) as message_count,
      EXTRACT(EPOCH FROM MAX(created_at))::bigint as last_message_at,
      EXTRACT(EPOCH FROM MIN(created_at))::bigint as first_message_at
    FROM messages
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND conversation_id LIKE 'session:%'
    GROUP BY conversation_id
    ORDER BY last_message_at DESC
  ` as unknown as Array<{
    conversation_id: string;
    message_count: number;
    last_message_at: number;
    first_message_at: number;
  }>;

  const sessions = await Promise.all(rows.map(async row => {

    // Parse conversation_id: "session:{instanceId}:{agentId}:{sessionId}" (back-compat: "session:{agentId}:{sessionId}")
    const parts = row.conversation_id.split(':');
    const instanceId = parts[1] || 'default';
    const agentId = parts.length >= 4 ? (parts[2] || 'unknown') : (parts[1] || 'unknown');
    const sessionId = parts.length >= 4 ? (parts[3] || '') : (parts[2] || '');

    // Get first user message as preview
    const firstRows = await s`
      SELECT content FROM messages
      WHERE conversation_id = ${row.conversation_id} AND tenant_id = ${DEFAULT_TENANT_ID}
        AND from_agent = 'operator'
      ORDER BY created_at ASC LIMIT 1
    ` as unknown as { content: string }[];
    const firstMsg = firstRows[0];

    const preview = firstMsg?.content
      ? firstMsg.content.slice(0, 100) + (firstMsg.content.length > 100 ? '...' : '')
      : undefined;

    return {
      instance_id: instanceId,
      agent_id: agentId,
      session_id: sessionId,
      conversation_id: row.conversation_id,
      message_count: Number(row.message_count),
      last_message_at: row.last_message_at,
      first_message_at: row.first_message_at,
      preview,
    };
  }));

  return NextResponse.json({ sessions });
}

export const dynamic = 'force-dynamic';
