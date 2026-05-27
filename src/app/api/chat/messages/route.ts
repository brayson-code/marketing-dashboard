import { NextRequest, NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { sendAgentMessage } from '@/lib/command';
import { requireApiEditor, requireApiUser } from '@/lib/api-auth';
import { getAgentIds } from '@/lib/agent-config';
import { requireUser } from '@/lib/auth';
import { logAudit } from '@/lib/audit';

export const dynamic = 'force-dynamic';


interface MessageRow {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export async function GET(req: NextRequest) {
  const auth = requireApiUser(req as Request);
  if (auth) return auth;
  try {
    const s = sql();
    const { searchParams } = req.nextUrl;

    const conversation_id = searchParams.get('conversation_id');
    const limit = Number(searchParams.get('limit')) || 50;
    const since = searchParams.get('since');

    // created_at is timestamptz; expose epoch seconds for back-compat.
    // `since` is an epoch-seconds cursor from the client.
    const messages = await s`
      SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at,
             EXTRACT(EPOCH FROM created_at)::bigint as created_at
      FROM messages
      WHERE tenant_id = ${tenantId()}
      ${conversation_id ? s`AND conversation_id = ${conversation_id}` : s``}
      ${since ? s`AND created_at > to_timestamp(${Number(since)})` : s``}
      ORDER BY created_at ASC
      LIMIT ${limit}
    ` as unknown as MessageRow[];

    const parsed = messages.map(m => ({
      ...m,
      metadata: m.metadata ?? null,
    }));

    return NextResponse.json({ messages: parsed });
  } catch (error) {
    console.error('GET /api/chat/messages error:', error);
    return NextResponse.json({ error: 'Failed to fetch messages' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const auth = requireApiEditor(req as Request);
  if (auth) return auth;
  try {
    const actor = requireUser(req as Request);
    const s = sql();
    const body = await req.json();
    const from = (typeof actor?.username === 'string' && actor.username.trim()) ? actor.username.trim() : 'operator';
    const to = body.to ? (body.to as string).trim() : null;
    const content = (body.content || '').trim();
    const message_type = body.message_type || 'text';
    const conversation_id = body.conversation_id || `conv_${Date.now()}`;

    if (!content) {
      return NextResponse.json({ error: 'content is required' }, { status: 400 });
    }

    // Save the human message
    const insertRows = await s`
      INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type)
      VALUES (${tenantId()}, ${conversation_id}, ${from}, ${to}, ${content}, ${message_type})
      RETURNING id, conversation_id, from_agent, to_agent, content, message_type, metadata,
                EXTRACT(EPOCH FROM created_at)::bigint as created_at
    ` as unknown as MessageRow[];
    const created = insertRows[0];
    if (!created) {
      return NextResponse.json({ error: 'Failed to load created message' }, { status: 500 });
    }
    const parsedMessage = { ...created, metadata: created.metadata ?? null };

    await logAudit({
      actor,
      action: 'chat.message.send',
      target: `conversation:${conversation_id}`,
      detail: { from, to, message_type },
    });

    // If recipient is a known agent, forward via gateway (async, non-blocking)
    if (to && getAgentIds().includes(to) && body.forward !== false) {
      // Fire-and-forget: forward to agent, save response when it comes back
      forwardToAgent(to, content, conversation_id, from).catch(err => {
        console.error(`Failed to forward to ${to}:`, err);
        // Save error as system message
        s`
          INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type)
          VALUES (${tenantId()}, ${conversation_id}, 'system', ${from}, ${`Failed to reach ${to}: ${(err as Error).message?.slice(0, 200)}`}, 'system')
        `.catch(() => {});
      });
    }

    return NextResponse.json({ message: parsedMessage }, { status: 201 });
  } catch (error) {
    console.error('POST /api/chat/messages error:', error);
    return NextResponse.json({ error: 'Failed to send message' }, { status: 500 });
  }
}

async function forwardToAgent(
  agentId: string,
  content: string,
  conversationId: string,
  from: string,
) {
  const { response } = await sendAgentMessage(agentId, `Message from ${from}: ${content}`);

  if (response) {
    await sql()`
      INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type)
      VALUES (${tenantId()}, ${conversationId}, ${agentId}, ${from}, ${response}, 'text')
    `;
  }
}
