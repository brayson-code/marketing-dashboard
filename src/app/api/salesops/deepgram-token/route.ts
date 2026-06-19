// POST /api/salesops/deepgram-token — mint a SHORT-LIVED Deepgram access token (JWT) for
// the authenticated tenant. This is the ONLY secret-derived value that ever leaves the
// server for the extension: the offscreen document opens the realtime Deepgram WebSocket
// with this JWT (subprotocol ["token", access_token]) instead of the raw key.
//
// Auth: per-tenant SalesOps bearer token (the extension can't carry our session cookie).
// CORS: permissive — the token is the auth, not the origin (caller is chrome-extension://
// or a meet/zoom/teams/webex page).

import { resolveSalesopsToken } from '@/lib/salesops/auth';
import { salesOpsCors, preflight } from '@/lib/salesops/cors';
import { mintDeepgramGrant, NoDeepgramKeyError } from '@/lib/salesops/deepgram-token';
import { enterTenant } from '@/lib/tenant';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function OPTIONS(req: Request): Response {
  return preflight(req);
}

export async function POST(req: Request): Promise<Response> {
  // Feature flag — nothing responds until Brayson flips SALESOPS_ENABLED on.
  if (process.env.SALESOPS_ENABLED !== 'true') {
    return new Response('Not Found', { status: 404, headers: salesOpsCors(req) });
  }

  const ctx = await resolveSalesopsToken(req);
  if (!ctx) return new Response('Unauthorized', { status: 401, headers: salesOpsCors(req) });
  enterTenant(ctx);

  try {
    const grant = await mintDeepgramGrant(60);
    return Response.json(grant, { headers: salesOpsCors(req) });
  } catch (e) {
    if (e instanceof NoDeepgramKeyError) {
      return Response.json(
        { error: 'connect_deepgram' },
        { status: 400, headers: salesOpsCors(req) },
      );
    }
    // Never echo the raw key/token; mintDeepgramGrant sanitizes its own messages.
    console.error('[salesops/deepgram-token]', (e as Error)?.message);
    return Response.json(
      { error: 'deepgram_grant_failed' },
      { status: 502, headers: salesOpsCors(req) },
    );
  }
}
