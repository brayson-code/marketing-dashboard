// POST /api/auth/reset-password — "Forgot password" from the login page.
//
// REUSES the existing recovery flow verbatim: we generate the same recovery-style
// link the invite/clients routes use (admin.generateLink type=recovery → our own
// /auth/confirm verifies the token_hash server-side, sets the session cookie, and
// lands the user on /auth/set-password). This route NEVER touches /auth/confirm or
// /auth/set-password — it only mints the link and emails it.
//
// ANTI-ENUMERATION: this endpoint ALWAYS responds { ok: true }, on every path. If
// the email has no account, generateLink throws "user not found" — we catch it and
// still return { ok: true }. We never reveal whether an account exists, and we never
// surface a 500 with detail. The browser shows the same neutral confirmation either
// way.
//
// This route is unauthenticated (added to isPublicPath in src/proxy.ts) — a
// logged-out user on /login must be able to call it.

import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { sendTransactionalEmail, renderInviteEmail } from '@/lib/transactional-email';
import { rateLimit } from '@/lib/rate-limit';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_RE = /\S+@\S+\.\S+/;

/** Single neutral success response — identical for every outcome (anti-enumeration). */
function ok() {
  return NextResponse.json({ ok: true });
}

export async function POST(request: Request) {
  // Per-IP abuse brake. No tenant context here (unauthenticated route), so we key
  // on the client IP under a dedicated limiter namespace. rateLimit() is a pure
  // sync function and is safe to call without tenant context; the `ip:`-prefixed
  // key is recorded only as a redacted shape, never the raw address.
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip')?.trim() ||
    'unknown';
  const limit = rateLimit('auth-reset-password', `ip:${ip}`, { windowMs: 15 * 60 * 1000, max: 5 });
  if (!limit.ok) {
    // Still neutral — a rate-limited caller learns nothing about any account.
    return ok();
  }

  let email = '';
  try {
    const body = (await request.json()) as { email?: string };
    email = (body.email ?? '').trim().toLowerCase();
  } catch {
    // Malformed body — say nothing useful, just succeed neutrally.
    return ok();
  }

  // Invalid/empty email: nothing to do, but DON'T reveal that — same neutral OK.
  if (!email || !EMAIL_RE.test(email)) {
    return ok();
  }

  // Everything below is best-effort and wrapped so it can never 500 with detail.
  try {
    const admin = supabaseAdmin();
    const origin = request.headers.get('origin') || new URL(request.url).origin;

    let resetLink: string | null = null;
    try {
      const { data: link } = await admin.auth.admin.generateLink({ type: 'recovery', email });
      const hashed = link?.properties?.hashed_token as string | undefined;
      resetLink = hashed
        ? `${origin}/auth/confirm?token_hash=${hashed}&type=recovery&next=/auth/set-password`
        : null;
    } catch {
      // "user not found" (or any generateLink failure) — swallow. We must not leak
      // whether the email maps to an account.
      resetLink = null;
    }

    if (resetLink) {
      const { html, text } = renderInviteEmail({
        heading: 'Reset your password',
        body: 'We received a request to reset your KeyPlayers Command Center password. Click below to sign in and choose a new one. If you didn’t request this, you can safely ignore this email.',
        ctaLabel: 'Reset password',
        link: resetLink,
      });
      // Best-effort send — sendTransactionalEmail never throws, but guard anyway so
      // a provider hiccup can't change the response shape.
      await sendTransactionalEmail({
        to: email,
        subject: 'Reset your KeyPlayers Command Center password',
        html,
        text,
      }).catch(() => undefined);
    }
  } catch (err) {
    // Never surface detail. Log server-side only (no key, no token).
    console.error('[reset-password POST] unexpected error (response stays neutral)', err);
  }

  return ok();
}
