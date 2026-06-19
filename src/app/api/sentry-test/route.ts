// TEMPORARY — manual Sentry verification. Captures a deliberate test error and
// flushes it to Sentry before the serverless function suspends (Sentry.flush is
// essential here — same class of issue as the security-events after() fix). Remove
// this route once the event is confirmed in the Sentry dashboard.
import { NextResponse } from 'next/server';
import * as Sentry from '@sentry/nextjs';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  // Diagnostics: is the server SDK actually initialized at runtime?
  const hasDsn = !!process.env.SENTRY_DSN;
  const hasClient = !!Sentry.getClient();
  const err = new Error(
    '🔔 KeyPlayers Command Center — Sentry test error (manual verification). Safe to resolve.',
  );
  const eventId = Sentry.captureException(err);
  // Guarantee delivery on serverless: wait up to 5s for the event to ship.
  const flushed = await Sentry.flush(5000).catch(() => false);
  return NextResponse.json({ ok: true, hasDsn, hasClient, sentry_event_id: eventId ?? null, flushed });
}
