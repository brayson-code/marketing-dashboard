import { NextResponse, after } from 'next/server';
import { sql, DEFAULT_TENANT_ID } from '@/lib/db/client';
import { squadRoster } from '@/lib/squad';
import { spawnSubAgent, SUBAGENT_REGISTRY } from '@/lib/subagent';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

// Agent-to-agent conversation history. KeyPlayer logs every sub-agent dispatch +
// result to the `messages` table under conversation_id "mc:a2a:<from>:<to>"
// (see logA2A in subagent.ts). This surfaces those threads so you can watch how
// the agents talk to each other. Read-only; auth enforced by middleware.
interface Row {
  id: number;
  conversation_id: string;
  from_agent: string;
  to_agent: string | null;
  content: string;
  message_type: string;
  metadata: Record<string, unknown> | null;
  created_at: number;
}

export async function GET(request: Request) {
  const limit = Math.min(Number(new URL(request.url).searchParams.get('limit') ?? 600), 1500);

  const rows = (await sql()`
    SELECT id, conversation_id, from_agent, to_agent, content, message_type,
           metadata, EXTRACT(EPOCH FROM created_at)::bigint AS created_at
    FROM messages
    WHERE tenant_id = ${DEFAULT_TENANT_ID} AND conversation_id LIKE 'mc:a2a:%'
    ORDER BY created_at ASC
    LIMIT ${limit}
  `) as unknown as Row[];

  const labels = new Map(squadRoster().map((a) => [a.id, { name: a.name, emoji: a.emoji }]));
  const label = (id: string) => labels.get(id) ?? { name: id.replace(/[-_]/g, ' '), emoji: '🤖' };

  // Group into conversations keyed by the unordered agent pair, so dispatch
  // (A→B) and result (B→A) collapse into one thread.
  const convs = new Map<string, {
    key: string; a: string; b: string; messages: Row[]; last_at: number;
  }>();

  for (const r of rows) {
    const parts = r.conversation_id.split(':'); // mc, a2a, from, to
    const from = parts[2] ?? r.from_agent;
    const to = parts[3] ?? (r.to_agent ?? 'keyplayer');
    const key = [from, to].sort().join('::');
    if (!convs.has(key)) convs.set(key, { key, a: [from, to].sort()[0], b: [from, to].sort()[1], messages: [], last_at: 0 });
    const c = convs.get(key)!;
    c.messages.push(r);
    if (r.created_at > c.last_at) c.last_at = r.created_at;
  }

  const conversations = [...convs.values()]
    .sort((x, y) => y.last_at - x.last_at)
    .map((c) => ({
      key: c.key,
      a: { id: c.a, ...label(c.a) },
      b: { id: c.b, ...label(c.b) },
      last_at: c.last_at,
      message_count: c.messages.length,
      messages: c.messages.map((m) => ({
        id: m.id,
        from: { id: m.from_agent, ...label(m.from_agent) },
        to: m.to_agent ? { id: m.to_agent, ...label(m.to_agent) } : null,
        content: m.content,
        phase: (m.metadata && typeof m.metadata === 'object' ? (m.metadata as { phase?: string }).phase : undefined) ?? null,
        created_at: m.created_at,
      })),
    }));

  return NextResponse.json({ conversations });
}

// Send a message INTO an agent pair: dispatch the target sub-agent with the
// operator's message as its task. spawnSubAgent logs the dispatch + result to
// the mc:a2a:keyplayer:<to> thread, so it appears in the A2A history. The run is
// slow (a full agent turn), so kick it off with after() and return immediately.
export async function POST(request: Request) {
  let body: { to?: string; content?: string };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const to = (body.to ?? '').trim();
  const content = (body.content ?? '').trim();
  if (!content) return NextResponse.json({ error: 'content is required' }, { status: 400 });
  if (!SUBAGENT_REGISTRY[to]) {
    return NextResponse.json({ error: `Unknown sub-agent "${to}". Valid: ${Object.keys(SUBAGENT_REGISTRY).join(', ')}` }, { status: 400 });
  }

  after(async () => {
    try {
      await spawnSubAgent(to, content);
    } catch (err) {
      console.error('[a2a] dispatch failed:', (err as Error).message);
    }
  });

  return NextResponse.json({ ok: true, dispatched: to }, { status: 202 });
}
