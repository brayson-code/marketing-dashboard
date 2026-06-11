import { processLoopMessageWebhook } from '@/lib/loopmessage-webhook';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// LEGACY single-tenant LoopMessage inbound webhook.
// Payload reference: https://docs.loopmessage.com/imessage-conversation-api/webhook
//
// This route runs with NO tenant context, so every write lands in the HQ default
// tenant. It stays for back-compat with the owner's own LoopMessage config (and any
// LoopMessage webhook still pointed at the un-suffixed URL). NEW clients should point
// LoopMessage at the per-tenant route /api/webhook/loopmessage/[tenantId], which
// scopes all writes to that client's workspace and requires a per-tenant secret.
//
// Auth here uses the GLOBAL LOOPMESSAGE_WEBHOOK_SECRET env (constant-time compare;
// skipped if unset — dev convenience). The per-tenant route enforces a configured secret.
export async function POST(request: Request) {
  return processLoopMessageWebhook(request, process.env.LOOPMESSAGE_WEBHOOK_SECRET);
}
