import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { NextResponse } from 'next/server';
import { sql, tenantId } from '@/lib/db/client';

export const dynamic = 'force-dynamic';

// Twilio SMS inbox for the Engagement tab. Threads inbound + outbound by the
// contact's phone number so each conversation reads like a chat. Source =
// sms_messages (NOT boardroom_messages — kept out of the Boardroom).

interface SmsRow {
  id: number;
  direction: 'in' | 'out';
  channel: string | null;
  from_number: string | null;
  to_number: string | null;
  body: string | null;
  status: string | null;
  created_at: string;
}

interface SmsThread {
  contact: string;
  messages: Array<{ id: number; direction: 'in' | 'out'; channel: 'sms' | 'imessage'; body: string; created_at: string }>;
  latest_at: string;
}

export async function GET() {
  enterTenant(await resolveTenant());

  const rows = (await sql()`
    SELECT id, direction, channel, from_number, to_number, body, status, created_at
    FROM public.sms_messages
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC, id DESC
    LIMIT 100
  `) as unknown as SmsRow[];

  // The "contact" is the other party: their number is from_number on inbound,
  // to_number on outbound.
  const threads = new Map<string, SmsThread>();
  for (const r of rows) {
    const contact = (r.direction === 'in' ? r.from_number : r.to_number) ?? 'unknown';
    const rawCa: unknown = r.created_at;
    const createdAt = rawCa instanceof Date ? rawCa.toISOString() : String(rawCa);
    if (!threads.has(contact)) threads.set(contact, { contact, messages: [], latest_at: createdAt });
    threads.get(contact)!.messages.push({
      id: r.id,
      direction: r.direction,
      channel: r.channel === 'imessage' ? 'imessage' : 'sms',
      body: r.body ?? '',
      created_at: createdAt,
    });
  }

  const conversations: SmsThread[] = [];
  for (const t of threads.values()) {
    t.messages.reverse(); // oldest → newest within a thread
    conversations.push(t);
  }
  conversations.sort((a, b) => (a.latest_at < b.latest_at ? 1 : -1));

  return NextResponse.json({ conversations });
}
