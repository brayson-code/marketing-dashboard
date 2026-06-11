import { processTelegramWebhook } from '@/lib/telegram-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// LEGACY single-tenant alert-ingest webhook ("telegram").
// Runs with NO tenant context → alerts land in the HQ default tenant. Kept for
// back-compat with the owner's own alert senders. NEW clients' systems should POST
// to the per-tenant route /api/webhook/telegram/[tenantId] so alerts land in the
// right workspace. Auth = global API_KEY (x-api-key header).
export async function POST(request: Request) {
  return processTelegramWebhook(request);
}
