// AgentMail inbox management — the tenant↔inbox mapping + inbound email store.
//
// Each tenant provisions inboxes under THEIR own AgentMail account (BYO key).
// The inbound webhook hits ONE KeyCommand URL for all tenants, so it routes by
// account_id → agentmail_inboxes → tenant. Inbound emails are persisted in
// agentmail_messages so the Engagement email lane can list + triage them.

import { sql, tenantId } from './db/client';
import { createInbox, registerWebhook, listWebhooks, inboxAddress } from './agentmail';

/** Ensure the tenant's AgentMail account has exactly one inbound webhook pointed
 *  at our STABLE url (APP_URL). Idempotent — only registers when missing, so we
 *  don't accumulate duplicates across deploys/spawns. Best-effort. */
export async function ensureWebhook(): Promise<void> {
  const url = inboundWebhookUrl();
  if (!url) return; // no stable URL configured — polling covers inbound
  try {
    const existing = await listWebhooks();
    if (existing.some((w) => w.url === url)) return;
    await registerWebhook(url);
  } catch (e) {
    console.error('[agentmail] ensureWebhook failed (polling still covers inbound):', (e as Error).message);
  }
}

/** The single inbound webhook endpoint all tenants' inboxes point at. Routing
 *  to the right tenant happens by account_id in the payload, not by URL. */
function inboundWebhookUrl(): string | null {
  const base =
    process.env.APP_URL?.replace(/\/$/, '') ||
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '') ||
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, '') ||
    '';
  return base ? `${base}/api/integrations/agentmail/inbound` : null;
}

export interface TenantInbox {
  account_id: string;
  address: string;
  agent_id: string | null;
  created_at: number;
}

/** Provision a new inbox under the current tenant's AgentMail account, store the
 *  mapping, and register the inbound webhook (best-effort). Must run inside
 *  tenant context (the AgentMail key is resolved per-tenant). */
export async function provisionInbox(opts: { username?: string; agentId?: string } = {}): Promise<TenantInbox> {
  // AgentMail assigns the address (username@domain) — we use whatever it returns.
  // `account_id` column stores the AgentMail `inbox_id`.
  const inbox = await createInbox({
    username: opts.username,
    displayName: opts.agentId ? `KeyCommand ${opts.agentId}` : undefined,
  });
  const address = inboxAddress(inbox);

  // AgentMail webhooks are ORG-LEVEL (one per account, not per inbox) — see
  // ensureWebhook(), called once per connection rather than per spawn so we
  // don't pile up duplicate webhooks. We intentionally store NO per-inbox secret
  // here: AgentMail signs with Svix (whsec_…), which our verifier doesn't yet
  // implement, so the inbound route stays on the safe inbox-resolution path.
  await sql()`
    INSERT INTO public.agentmail_inboxes (tenant_id, account_id, address, agent_id)
    VALUES (${tenantId()}, ${inbox.inbox_id}, ${address}, ${opts.agentId ?? null})
    ON CONFLICT (tenant_id, account_id) DO NOTHING
  `;
  // Make sure the tenant's account has exactly one webhook pointed at our stable URL.
  await ensureWebhook().catch(() => {});

  return {
    account_id: inbox.inbox_id,
    address,
    agent_id: opts.agentId ?? null,
    created_at: Math.floor(Date.now() / 1000),
  };
}

/** Sync the tenant's live AgentMail inboxes into our mapping table, then return
 *  them. This ADOPTS any inbox that already existed in their AgentMail account
 *  (created outside KeyCommand) so it (a) shows up in the UI and (b) becomes
 *  routable for inbound. AgentMail (their account) is the source of truth. */
export async function syncInboxes(): Promise<TenantInbox[]> {
  const { listInboxes, inboxAddress } = await import('./agentmail');
  let live: Awaited<ReturnType<typeof listInboxes>> = [];
  try {
    live = await listInboxes();
  } catch (e) {
    // Couldn't reach AgentMail — fall back to whatever we already have stored.
    console.error('[agentmail] listInboxes failed, using stored:', (e as Error).message);
    return listTenantInboxes();
  }
  for (const ib of live) {
    await sql()`
      INSERT INTO public.agentmail_inboxes (tenant_id, account_id, address)
      VALUES (${tenantId()}, ${ib.inbox_id}, ${inboxAddress(ib)})
      ON CONFLICT (tenant_id, account_id) DO UPDATE SET address = EXCLUDED.address
    `.catch(() => {});
  }
  return listTenantInboxes();
}

/** Inboxes belonging to the current tenant (from our mapping table). */
export async function listTenantInboxes(): Promise<TenantInbox[]> {
  const rows = (await sql()`
    SELECT account_id, address, agent_id, extract(epoch from created_at)::int AS created_at
    FROM public.agentmail_inboxes
    WHERE tenant_id = ${tenantId()}
    ORDER BY created_at DESC
  `) as unknown as TenantInbox[];
  return rows;
}

/** Look up which tenant + webhook secret owns an account_id. Used by the inbound
 *  webhook BEFORE tenant context is known — the backend role bypasses RLS, so
 *  this resolves across tenants. Returns null when we don't own the account. */
export async function findInboxByAccount(accountId: string): Promise<{ tenant_id: string; webhook_secret: string | null; address: string } | null> {
  const rows = (await sql()`
    SELECT tenant_id::text AS tenant_id, webhook_secret, address
    FROM public.agentmail_inboxes
    WHERE account_id = ${accountId}
    LIMIT 1
  `) as unknown as Array<{ tenant_id: string; webhook_secret: string | null; address: string }>;
  return rows[0] ?? null;
}

/** Persist an inbound email (dedup on message_id). Returns false if already seen. */
export async function recordInbound(input: {
  accountId: string; messageId: string; from: string; to?: string | null;
  subject?: string | null; bodyText?: string | null;
}): Promise<boolean> {
  const rows = (await sql()`
    INSERT INTO public.agentmail_messages (tenant_id, account_id, message_id, from_addr, to_addr, subject, body_text)
    VALUES (${tenantId()}, ${input.accountId}, ${input.messageId}, ${input.from},
            ${input.to ?? null}, ${input.subject ?? null}, ${input.bodyText ?? null})
    ON CONFLICT (tenant_id, message_id) DO NOTHING
    RETURNING id
  `) as unknown as Array<{ id: number }>;
  return rows.length > 0;
}

export interface InboundMessage {
  id: number; account_id: string; message_id: string; from_addr: string;
  to_addr: string | null; subject: string | null; body_text: string | null;
  received_at: number; replied: boolean; draft_id: number | null;
}

/** Recent inbound emails for the current tenant — the Engagement email lane. */
export async function listInbound(limit = 30): Promise<InboundMessage[]> {
  const rows = (await sql()`
    SELECT id, account_id, message_id, from_addr, to_addr, subject, body_text,
           extract(epoch from received_at)::int AS received_at, replied, draft_id
    FROM public.agentmail_messages
    WHERE tenant_id = ${tenantId()}
    ORDER BY received_at DESC
    LIMIT ${Math.min(limit, 100)}
  `) as unknown as InboundMessage[];
  return rows;
}

/** Polling fallback for inbound email — for each of the tenant's inboxes, pull
 *  recent messages from AgentMail and record any new inbound ones. Makes the
 *  email lane work even when the push webhook isn't wired (no APP_URL set).
 *  Free karma-wise (listing/reading don't cost karma). Best-effort per inbox.
 *  Returns the count of newly-recorded emails. */
export async function pollInbound(perInbox = 15): Promise<number> {
  const { listMessages, getMessage } = await import('./agentmail');
  const inboxes = await listTenantInboxes();
  let recorded = 0;
  for (const ib of inboxes) {
    try {
      const msgs = await listMessages(ib.account_id);
      // Direction: AgentMail labels outbound as ["sent"]. Use that as the
      // primary signal; fall back to "sender isn't our own address" if a message
      // has no labels. (from is "Name <email>", so substring-match the address.)
      const own = ib.address.toLowerCase();
      const inbound = msgs
        .filter((m) => {
          const labels = (m.labels ?? []).map((l) => l.toLowerCase());
          if (labels.includes('sent')) return false;
          if (labels.includes('received') || labels.includes('inbox')) return true;
          const f = (m.from ?? '').toLowerCase();
          return !!f && !f.includes(own);
        })
        .slice(0, perInbox);
      for (const m of inbound) {
        const isNew = await recordInbound({
          accountId: ib.account_id,
          messageId: m.message_id,
          from: m.from ?? 'unknown',
          to: Array.isArray(m.to) ? m.to.join(', ') : (m.to ?? null),
          subject: m.subject ?? null,
          bodyText: m.text ?? m.preview ?? null,
        });
        if (!isNew) continue;
        recorded++;
        // Backfill the body if the list view didn't include it.
        if (!m.text) {
          try {
            const detail = await getMessage(ib.account_id, m.message_id);
            if (detail?.text) {
              await sql()`
                UPDATE public.agentmail_messages SET body_text = ${detail.text}
                WHERE tenant_id = ${tenantId()} AND message_id = ${m.message_id}
              `;
            }
          } catch { /* body backfill best-effort */ }
        }
      }
    } catch { /* skip this inbox on error */ }
  }
  return recorded;
}

/** Mark an inbound email replied + link the reply draft. */
export async function markReplied(messageId: string, draftId: number | null): Promise<void> {
  await sql()`
    UPDATE public.agentmail_messages
    SET replied = true, draft_id = ${draftId}
    WHERE tenant_id = ${tenantId()} AND message_id = ${messageId}
  `;
}
