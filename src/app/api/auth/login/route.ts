import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { authenticate, createSession, destroySession, seedAdmin } from '@/lib/auth';

const SESSION_COOKIE = 'hermes-session';
const SESSION_MAX_AGE = 7 * 24 * 60 * 60;

function shouldUseSecureCookies(request: Request): boolean {
  const forced = process.env.AUTH_COOKIE_SECURE?.trim().toLowerCase();
  if (forced === "true" || forced === "1" || forced === "yes") return true;
  if (forced === "false" || forced === "0" || forced === "no") return false;
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedProto) {
    return forwardedProto.split(',')[0].trim().toLowerCase() === 'https';
  }

  try {
    return new URL(request.url).protocol === 'https:';
  } catch {
    return process.env.NODE_ENV === 'production';
  }
}

export async function POST(request: Request) {
  enterTenant(await resolveTenant());
  try {
    seedAdmin();
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : 'Auth configuration error' },
      { status: 500 },
    );
  }

  const { username, password } = await request.json();
  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 });
  }

  const user = authenticate(username, password);
  if (!user) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  // Invalidate any previously presented session token to reduce session fixation risk.
  const cookie = request.headers.get('cookie') || '';
  const existingMatch = cookie.match(/(?:^|;\s*)hermes-session=([^;]*)/);
  const existingToken = existingMatch ? decodeURIComponent(existingMatch[1]) : null;
  if (existingToken) {
    destroySession(existingToken);
  }

  const token = createSession(user.id);
  const response = NextResponse.json({ user: { id: user.id, username: user.username, role: user.role } });
  const secure = shouldUseSecureCookies(request);

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    maxAge: SESSION_MAX_AGE,
    path: '/',
  });
  response.headers.set('Cache-Control', 'no-store');

  return response;
}
