import { type NextRequest } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { upsertIntegration } from '@/lib/integrations-store';
import {
  STATE_COOKIE,
  connectionsRedirect,
  exchangeJobberCode,
  jobberCallbackUrl,
  resolveExpiresAt,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/jobber/callback — Jobber redirects here with ?code&state
// (or ?error=... if the user denied consent). Runs inside the tenant's own
// authenticated browser session, so resolveTenant() resolves the right workspace
// to store the token pair under.
export async function GET(request: NextRequest) {
  enterTenant(await resolveTenant());

  const url = request.nextUrl;
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const providerError = url.searchParams.get('error');

  const cookieState = request.cookies.get(STATE_COOKIE)?.value ?? null;
  // Always clear the one-time nonce cookie regardless of outcome.
  const clearStateCookie = (redirect: ReturnType<typeof connectionsRedirect>) => {
    redirect.cookies.set(STATE_COOKIE, '', { maxAge: 0, path: '/' });
    return redirect;
  };

  if (providerError) {
    return clearStateCookie(
      connectionsRedirect(request, { error: 'Jobber sign-in was cancelled or denied' }),
    );
  }

  if (!code || !state || !cookieState || state !== cookieState) {
    return clearStateCookie(
      connectionsRedirect(request, { error: 'Jobber sign-in could not be verified — please try again' }),
    );
  }

  try {
    const redirectUri = jobberCallbackUrl(request);
    const token = await exchangeJobberCode(code, redirectUri);
    const expiresAt = resolveExpiresAt(token);

    await upsertIntegration({
      provider: 'jobber',
      label: 'Jobber',
      secret: { access_token: token.access_token, refresh_token: token.refresh_token },
      expires_at: expiresAt,
    });

    return clearStateCookie(connectionsRedirect(request, { connected: 'jobber' }));
  } catch (err) {
    // Never forward the raw upstream error text (could contain provider detail we
    // don't want reflected back through a redirect URL) — just a safe message.
    console.error('[jobber] token exchange failed:', (err as Error).message);
    return clearStateCookie(
      connectionsRedirect(request, { error: 'Could not complete the Jobber connection' }),
    );
  }
}
