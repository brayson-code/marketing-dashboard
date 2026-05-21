import { NextRequest, NextResponse } from 'next/server';
import { sql, jsonb, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { runOrchestrator } from '@/lib/orchestrator';
import { spawnSubAgent } from '@/lib/subagent';
import { requireApiAdmin } from '@/lib/api-auth';
import { requireAdmin } from '@/lib/auth';
import { logAudit } from '@/lib/audit';
import { getAgentIds } from '@/lib/agent-config';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

type Mode = 'orchestrator' | 'agent_bridge';

interface MessageRow {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  message_type: 'text' | 'system';
  metadata: Record<string, unknown> | null;
  read_at: number | null;
  created_at: number;
}

interface ConversationRow {
  conversation_id: string;
  last_message_at: number;
  message_count: number;
}

function isAgentId(value: unknown, agents: string[]): value is string {
  return typeof value === 'string' && agents.includes(value);
}

function toConversationId(mode: Mode, fromAgent?: string, toAgent?: string): string {
  if (mode === 'orchestrator') return 'mc:orchestrator';
  if (!fromAgent || !toAgent) return 'mc:agent-bridge';
  return `mc:a2a:${fromAgent}:${toAgent}`;
}

function parseBridgeConversation(conversationId: string): { from_agent: string; to_agent: string } | null {
  const match = conversationId.match(/^mc:a2a:([^:]+):([^:]+)$/);
  if (!match) return null;
  return { from_agent: match[1], to_agent: match[2] };
}

export async function GET(request: NextRequest) {
  const auth = requireApiAdmin(request as Request);
  if (auth) return auth;
  try {
    const mode = (request.nextUrl.searchParams.get('mode') || 'orchestrator') as Mode;
    const listOnly = request.nextUrl.searchParams.get('list') === 'true';
    const fromAgent = request.nextUrl.searchParams.get('from_agent') || undefined;
    const toAgent = request.nextUrl.searchParams.get('to_agent') || undefined;
    const limit = Math.min(200, Math.max(1, Number(request.nextUrl.searchParams.get('limit') || 100)));
    const s = sql();
    const agents = getAgentIds();

    if (listOnly) {
      const pattern = mode === 'agent_bridge' ? 'mc:a2a:%' : 'mc:orchestrator';
      const rows = await s`
        SELECT conversation_id, EXTRACT(EPOCH FROM MAX(created_at))::bigint as last_message_at, COUNT(*) as message_count
        FROM messages
        WHERE tenant_id = ${DEFAULT_TENANT_ID} AND conversation_id LIKE ${pattern}
        GROUP BY conversation_id
        ORDER BY last_message_at DESC
        LIMIT 100
      ` as unknown as ConversationRow[];
      const conversations = rows.map((row) => ({
        ...row,
        message_count: Number(row.message_count),
        ...(parseBridgeConversation(row.conversation_id) || {}),
      }));
      return NextResponse.json({ conversations, agents: agents });
    }

    const conversationId = toConversationId(
      mode === 'agent_bridge' ? 'agent_bridge' : 'orchestrator',
      isAgentId(fromAgent, agents) ? fromAgent : undefined,
      isAgentId(toAgent, agents) ? toAgent : undefined,
    );

    const rows = await s`
      SELECT id, conversation_id, from_agent, to_agent, content, message_type, metadata, read_at,
             EXTRACT(EPOCH FROM created_at)::bigint as created_at
      FROM messages
      WHERE conversation_id = ${conversationId} AND tenant_id = ${DEFAULT_TENANT_ID}
      ORDER BY created_at ASC
      LIMIT ${limit}
    ` as unknown as MessageRow[];

    const messages = rows.map((row) => ({
      ...row,
      metadata: row.metadata ?? null,
    }));

    return NextResponse.json({ conversation_id: conversationId, messages, agents: agents });
  } catch (error) {
    return NextResponse.json({ error: `Failed to fetch mission-control chat: ${String(error)}` }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  const auth = requireApiAdmin(request as Request);
  if (auth) return auth;
  try {
    const actor = requireAdmin(request as Request);
    const body = (await request.json()) as {
      mode?: Mode;
      content?: string;
      from_agent?: string;
      to_agent?: string;
      conversation_id?: string;
    };

    const mode: Mode = body.mode === 'agent_bridge' ? 'agent_bridge' : 'orchestrator';
    const content = (body.content || '').trim();
    if (!content) {
      return NextResponse.json({ error: 'content required' }, { status: 400 });
    }

    const fromAgent = body.from_agent;
    const toAgent = body.to_agent;
    const agents = getAgentIds();
    if (mode === 'agent_bridge') {
      if (!isAgentId(fromAgent, agents) || !isAgentId(toAgent, agents)) {
        return NextResponse.json({ error: 'from_agent and to_agent must be valid agent ids' }, { status: 400 });
      }
      if (fromAgent === toAgent) {
        return NextResponse.json({ error: 'from_agent and to_agent must be different' }, { status: 400 });
      }
    }

    const s = sql();
    const now = Math.floor(Date.now() / 1000);
    const conversationId = body.conversation_id || toConversationId(mode, fromAgent, toAgent);

    // metadata is jsonb; match on the `source` key instead of a LIKE on JSON text.
    const lastRows = await s`
      SELECT EXTRACT(EPOCH FROM created_at)::bigint as created_at
      FROM messages
      WHERE tenant_id = ${DEFAULT_TENANT_ID} AND from_agent = ${actor.username}
        AND metadata->>'source' = 'mission-control'
      ORDER BY created_at DESC
      LIMIT 1
    ` as unknown as { created_at?: number }[];
    const lastTs = Number(lastRows[0]?.created_at ?? 0);
    const cooldownSec = 3;
    if (lastTs > 0 && now - lastTs < cooldownSec) {
      return NextResponse.json(
        { error: `Cooldown active. Please wait ${cooldownSec - (now - lastTs)}s before sending another command.` },
        { status: 429 },
      );
    }

    const windowSec = 300;
    const maxPerWindow = 30;
    const recentCountRows = await s`
      SELECT COUNT(*) as c
      FROM messages
      WHERE tenant_id = ${DEFAULT_TENANT_ID} AND from_agent = ${actor.username}
        AND metadata->>'source' = 'mission-control'
        AND created_at >= to_timestamp(${now - windowSec})
    ` as unknown as { c?: string }[];
    const recentCount = Number(recentCountRows[0]?.c ?? 0);
    if (recentCount >= maxPerWindow) {
      return NextResponse.json(
        { error: 'Rate limit exceeded for mission-control sends. Try again in a few minutes.' },
        { status: 429 },
      );
    }

    const metadata = {
      source: 'mission-control',
      mode,
      actor: actor.username,
      from_agent: fromAgent ?? null,
      to_agent: toAgent ?? null,
    };

    await s`
      INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type, metadata)
      VALUES (
        ${DEFAULT_TENANT_ID}, ${conversationId}, ${actor.username},
        ${mode === 'agent_bridge' ? (toAgent ?? null) : 'orchestrator'}, ${content}, 'text', ${jsonb(metadata)}
      )
    `;

    // Drive the REAL agents (the OpenClaw CLI path is retired). Orchestrator mode
    // records the message into the boardroom thread so runOrchestrator picks it up
    // (and so it shows in the iMessage thread); agent_bridge mode spawns the live
    // sub-agent. Both log to agent_tasks + the A2A history.
    let responseText = '';
    if (mode === 'orchestrator') {
      await s`
        INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, status)
        VALUES (${DEFAULT_TENANT_ID}, 'in', 'operator', ${process.env.LOOPMESSAGE_SENDER_NAME ?? 'keyplayers'}, ${content}, 'received')
      `;
      const result = await runOrchestrator();
      if (result.ok) {
        responseText = result.text;
        await s`
          INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, status, metadata)
          VALUES (${DEFAULT_TENANT_ID}, 'out', 'keyplayer', 'operator', ${result.text}, 'delivered', ${jsonb({ usage: result.usage })})
        `;
      } else {
        responseText = `(orchestrator error: ${result.error})`;
      }
    } else {
      const r = await spawnSubAgent(toAgent as string, `Message from ${fromAgent}: ${content}`);
      responseText = r.ok ? (r.text ?? '') : `(sub-agent error: ${r.error})`;
    }

    if (responseText) {
      await s`
        INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type, metadata)
        VALUES (
          ${DEFAULT_TENANT_ID}, ${conversationId},
          ${mode === 'orchestrator' ? 'orchestrator' : (toAgent as string)}, ${actor.username},
          ${responseText}, 'text', ${jsonb(metadata)}
        )
      `;
    }

    await logAudit({
      actor,
      action: mode === 'orchestrator' ? 'mission_control.orchestrator_message' : 'mission_control.agent_bridge_message',
      target: conversationId,
      detail: {
        mode,
        from_agent: fromAgent ?? null,
        to_agent: toAgent ?? null,
      },
    });

    return NextResponse.json({ ok: true, conversation_id: conversationId });
  } catch (error) {
    return NextResponse.json({ error: `Mission-control send failed: ${String(error)}` }, { status: 500 });
  }
}
