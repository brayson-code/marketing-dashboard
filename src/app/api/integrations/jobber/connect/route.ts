import { randomBytes } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import {
  JOBBER_AUTHORIZE_URL,
  STATE_COOKIE,
  STATE_COOKIE_MAX_AGE,
  jobberCallbackUrl,
  jobberClientCredentials,
  shouldUseSecureCookies,
} from '../_shared';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// GET /api/integrations/jobber/connect — kicks off the Jobber OAuth (authorization
// code grant, the only grant type Jobber supports). Redirects the browser straight
// to Jobber's authorize screen; the CSRF nonce travels in an httpOnly cookie rather
// than app state since there's no session-side store for it yet at this point.
export async function GET(request: NextRequest) {
  enterTenant(await resolveTenant());

  const creds = jobberClientCredentials();
  if (!creds) {
    return NextResponse.json(
      { error: 'Jobber is not configured — set JOBBER_CLIENT_ID and JOBBER_CLIENT_SECRET' },
      { status: 501 },
    );
  }

  const state = randomBytes(24).toString('hex');
  const redirectUri = jobberCallbackUrl(request);

  const authorizeUrl = new URL(JOBBER_AUTHORIZE_URL);
  authorizeUrl.searchParams.set('response_type', 'code');
  authorizeUrl.searchParams.set('client_id', creds.clientId);
  authorizeUrl.searchParams.set('redirect_uri', redirectUri);
  authorizeUrl.searchParams.set('state', state);

  const response = NextResponse.redirect(authorizeUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: shouldUseSecureCookies(request),
    maxAge: STATE_COOKIE_MAX_AGE,
    path: '/',
  });
  return response;
}
