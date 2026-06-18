import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { sql, jsonb, tenantId } from '@/lib/db/client';
import { runOrchestrator } from '@/lib/orchestrator';
import { parseAttachments } from '@/lib/vision';
import { rateLimit } from '@/lib/rate-limit';

// (usage is returned by runOrchestrator and stored on the assistant message)

export const dynamic = 'force-dynamic';
// Vision downloads + a full orchestrator turn can take a while; give it room.
export const maxDuration = 300;

// In-app chat with KeyPlayer (the orchestrator), with image support. This mirrors
// what the LoopMessage webhook does for MMS, but in the boardroom: we record the
// owner's message (with any uploaded image attachments) as an inbound boardroom
// message, run the orchestrator — which now "sees" the images — then store and
// return its reply. Auth is enforced by the Supabase middleware (proxy.ts).
export async function POST(request: Request) {
  enterTenant(await resolveTenant());

  // Per-tenant rate limit — each call runs a full orchestrator turn (multiple LLM
  // calls + sub-agent spawns), the most expensive path in the app, and was
  // unguarded (audit finding #5). 12 turns/min per workspace is well above
  // conversational pace while braking a runaway client or a stuck retry loop.
  const rl = rateLimit('boardroom-ask', tenantId(), { windowMs: 60_000, max: 12 });
  if (!rl.ok) {
    return NextResponse.json(
      { ok: false, error: 'You\'re sending messages faster than I can think — give me a moment.' },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfterSec) } },
    );
  }

  let body: { text?: string; attachments?: unknown };
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const text = (body.text ?? '').trim();
  const attachments = parseAttachments(body.attachments);
  if (!text && attachments.length === 0) {
    return NextResponse.json({ error: 'Provide text or at least one attachment' }, { status: 400 });
  }

  // Record the owner's turn as an inbound message so the orchestrator (which
  // reads boardroom_messages history) treats it as the latest user message.
  await sql()`
    INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, status, attachments)
    VALUES (
      ${tenantId()}, 'in', 'owner',
      ${process.env.LOOPMESSAGE_SENDER_NAME ?? 'keyplayers'}, ${text},
      'received', ${attachments.length > 0 ? jsonb(attachments) : null}
    )
  `;

  const result = await runOrchestrator();
  if (!result.ok) {
    // Surface the failure as an assistant message so the thread isn't left hanging.
    await sql()`
      INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, status)
      VALUES (${tenantId()}, 'out', 'keyplayer', 'owner',
        ${`I hit a snag: ${result.error.slice(0, 300)}`}, 'error')
    `;
    return NextResponse.json({ ok: false, error: result.error }, { status: 502 });
  }

  await sql()`
    INSERT INTO boardroom_messages (tenant_id, direction, sender, recipient, text, status, metadata)
    VALUES (${tenantId()}, 'out', 'keyplayer', 'owner', ${result.text}, 'delivered', ${jsonb({ usage: result.usage })})
  `;

  return NextResponse.json({ ok: true, reply: result.text, usage: result.usage });
}
