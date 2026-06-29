// POST /api/stt/token — mint a SHORT-LIVED Deepgram browser access token (JWT) for the
// authenticated tenant. This is the GENERIC, SESSION-authed sibling of the SalesOps token
// route (src/app/api/salesops/deepgram-token/route.ts): same secret-derived value, but the
// caller here is the logged-in app itself (session cookie), not the chrome extension (bearer
// token). The browser opens the realtime Deepgram WebSocket with this JWT in the
// subprotocol (["token", access_token]); the raw Deepgram key NEVER leaves the server.
//
// Auth: the app session.
//   - no authenticated user                 → 401
//   - authenticated but no workspace         → 403  (NO_TENANT_ID, fail-closed)
//   - tenant has no Deepgram key configured  → 400 { error: 'connect_deepgram' }
//   - any other grant failure                → 502 { error: 'token_failed' }
// Success → { access_token, expires_in }.

import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { tenantId, currentUserId, NO_TENANT_ID } from '@/lib/tenant';
import { mintDeepgramGrant, NoDeepgramKeyError } from '@/lib/salesops/deepgram-token';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<Response> {
  enterTenant(await resolveTenant());

  // Must be a logged-in user with a real workspace.
  if (!currentUserId()) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (tenantId() === NO_TENANT_ID) {
    return NextResponse.json({ error: 'no_workspace' }, { status: 403 });
  }

  try {
    const grant = await mintDeepgramGrant(60);
    return NextResponse.json(grant);
  } catch (e) {
    // Mirror the SalesOps route's "no deepgram key" detection: the typed error, with a
    // defensive message-code fallback in case the instance check is defeated by bundling.
    const err = e as Error & { code?: string };
    if (err instanceof NoDeepgramKeyError || err?.code === 'NO_DEEPGRAM_KEY') {
      return NextResponse.json({ error: 'connect_deepgram' }, { status: 400 });
    }
    // Never echo the raw key/token; mintDeepgramGrant sanitizes its own messages.
    console.error('[stt/token]', err?.message);
    return NextResponse.json({ error: 'token_failed' }, { status: 502 });
  }
}
