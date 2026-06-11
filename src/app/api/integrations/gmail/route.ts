import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { ImapFlow } from 'imapflow';
import { requireApiUser } from '@/lib/api-auth';

// Server-only env vars (do not use NEXT_PUBLIC_* for secrets).
const user = process.env.EMAIL_USER;
const pass = process.env.EMAIL_PASSWORD;

export async function GET(request: Request) {
  enterTenant(await resolveTenant());
  const auth = requireApiUser(request);
  if (auth) return auth;
  if (!user || !pass) {
    return NextResponse.json({ enabled: false, error: 'Missing Gmail credentials' });
  }

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user, pass },
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const status = await client.status('INBOX', { messages: true, unseen: true });
      return NextResponse.json({
        enabled: true,
        ok: true,
        messages: status.messages ?? 0,
        unseen: status.unseen ?? 0,
        checked_at: new Date().toISOString(),
      });
    } finally {
      lock.release();
    }
  } catch (error) {
    return NextResponse.json({ enabled: true, ok: false, error: String(error) });
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}
