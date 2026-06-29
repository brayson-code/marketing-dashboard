import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';
import { NO_TENANT_ID } from '@/lib/tenant';
import { getSquad } from '@/lib/squad';
import { spawnSubAgent } from '@/lib/subagent';

// Session-authed, tenant-scoped 1:1 agent chat that runs the agent IN-PROCESS via
// spawnSubAgent (the Anthropic SDK path), NOT the dead `openclaw` CLI bridge.
//
// History reuses the existing `messages` table, one thread per agent:
//   conversation_id = `agent_<agentId>`
//   user turn  → from_agent "operator", to_agent <agentId>
//   agent turn → from_agent <agentId>, to_agent "operator"
//
// Any authenticated workspace member may use it — the only gate is a REAL tenant
// (NO_TENANT_ID → 403) and that agentId is an actual agent of THIS tenant's roster
// (so the endpoint can never spawn an arbitrary agent type).

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const OPERATOR = 'operator';

function conversationIdFor(agentId: string): string {
  return `agent_${agentId}`;
}

interface MessageRow {
  id: number;
  from_agent: string;
  to_agent: string | null;
  content: string;
  created_at: number;
}

// GET ?agentId=<id> → recent thread history (oldest first, capped at 50).
export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'no_tenant' }, { status: 403 });
  }

  const agentId = (new URL(request.url).searchParams.get('agentId') ?? '').trim();
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }

  const rows = (await sql()`
    SELECT id, from_agent, to_agent, content,
           EXTRACT(EPOCH FROM created_at)::bigint AS created_at
    FROM messages
    WHERE tenant_id = ${tenantId()} AND conversation_id = ${conversationIdFor(agentId)}
    ORDER BY created_at ASC
    LIMIT 50
  `) as unknown as MessageRow[];

  return NextResponse.json({ messages: rows });
}

// POST { agentId, message } → persist the user turn, run the agent in-process,
// persist + return the reply.
export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'no_tenant' }, { status: 403 });
  }

  let body: { agentId?: unknown; message?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  const agentId = typeof body.agentId === 'string' ? body.agentId.trim() : '';
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!agentId) {
    return NextResponse.json({ error: 'agentId is required' }, { status: 400 });
  }
  if (!message) {
    return NextResponse.json({ error: 'message is required' }, { status: 400 });
  }

  // Validate agentId against THIS tenant's live roster. getSquad() already filters
  // by tenantId() + audience, so an agent not in it is either unknown or not
  // available to this workspace — either way we refuse to spawn it.
  const squad = await getSquad();
  if (!squad.some((a) => a.id === agentId)) {
    return NextResponse.json({ error: 'unknown_agent' }, { status: 404 });
  }

  // Persist the user's message first so the thread is intact even if the run fails.
  await sql()`
    INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type)
    VALUES (${tenantId()}, ${conversationIdFor(agentId)}, ${OPERATOR}, ${agentId}, ${message}, 'text')
  `;

  // Run the agent IN-PROCESS (Anthropic SDK + BYO key), bounded to a short loop.
  const r = await spawnSubAgent(agentId, message, undefined, { maxTurns: 6 });
  if (!r.ok) {
    const err = r.error ?? '';
    // No Anthropic key connected for this workspace → ask them to connect one.
    // Honor the shared `connect_anthropic` token AND spawnSubAgent's own
    // human-readable missing-key signature ("No Anthropic key — connect one …").
    if (err.includes('connect_anthropic') || /no anthropic key|connect (one|your).*anthropic/i.test(err)) {
      return NextResponse.json({ error: 'connect_anthropic' }, { status: 400 });
    }
    return NextResponse.json({ error: 'agent_failed' }, { status: 502 });
  }

  const reply = r.text ?? '';
  await sql()`
    INSERT INTO messages (tenant_id, conversation_id, from_agent, to_agent, content, message_type)
    VALUES (${tenantId()}, ${conversationIdFor(agentId)}, ${agentId}, ${OPERATOR}, ${reply}, 'text')
  `;

  return NextResponse.json({ reply });
}
