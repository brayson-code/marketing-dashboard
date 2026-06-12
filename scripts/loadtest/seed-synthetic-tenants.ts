/**
 * scripts/loadtest/seed-synthetic-tenants.ts
 *
 * LOAD-TEST ARTIFACT — DO NOT RUN IN PRODUCTION.
 *
 * Seeds N synthetic tenants (and realistic inert data volumes per tenant) into
 * Supabase for load-testing the read paths of the Command Center. No Anthropic
 * keys are ever written for these tenants, so NO Claude API spend can occur.
 *
 * NO-SPEND GUARANTEE (enforced in code, not just docs):
 *   1. We never INSERT any row into client_integrations for synthetic tenants.
 *   2. After seeding we ASSERT no enabled cron_jobs exist for synthetic tenants.
 *   If the assertion fails the script throws and prints exactly which rows violated
 *   the invariant (the on_new_tenant_seed trigger seeds crons DISABLED / null
 *   next_run_at, so this should never fire — the assert is a belt-and-suspenders
 *   check against future trigger changes).
 *
 * Usage:
 *   pnpm tsx --env-file=.env.local scripts/loadtest/seed-synthetic-tenants.ts \
 *     --confirm \
 *     [--count 100] \
 *     [--stamp 2026-06-12] \
 *     [--kg-per-tenant 50] \
 *     [--tasks-per-tenant 30] \
 *     [--drafts-per-tenant 5]
 *
 * Env vars (from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — service-role key (admin, bypasses RLS)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── CLI arg parsing ──────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);

  const hasConfirm = argv.includes('--confirm');
  const get = (flag: string, fallback: string): string => {
    const i = argv.indexOf(flag);
    return i !== -1 && argv[i + 1] ? argv[i + 1] : fallback;
  };

  if (!hasConfirm) {
    console.error(`
ERROR: --confirm flag is required.

Usage:
  pnpm tsx --env-file=.env.local scripts/loadtest/seed-synthetic-tenants.ts \\
    --confirm \\
    [--count 100] \\
    [--stamp 2026-06-12] \\
    [--kg-per-tenant 50] \\
    [--tasks-per-tenant 30] \\
    [--drafts-per-tenant 5]

This will create synthetic Supabase auth users + tenants tagged with { synthetic: true }.
The --confirm flag is required to prevent accidental runs.
`);
    process.exit(1);
  }

  return {
    count: parseInt(get('--count', '100'), 10),
    stamp: get('--stamp', 'REPLACE_WITH_ISO_DATE'),
    kgPerTenant: parseInt(get('--kg-per-tenant', '50'), 10),
    tasksPerTenant: parseInt(get('--tasks-per-tenant', '30'), 10),
    draftsPerTenant: parseInt(get('--drafts-per-tenant', '5'), 10),
  };
}

// ── Supabase admin client ────────────────────────────────────────────────────

function makeAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Run with: pnpm tsx --env-file=.env.local scripts/loadtest/seed-synthetic-tenants.ts',
    );
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── createWorkspace: why we replicate instead of import ─────────────────────
//
// src/lib/workspace.ts#createWorkspace() uses src/lib/db/client.ts which
// lazy-initialises a postgres.js connection from SUPABASE_DB_URL (the direct
// connection string, not the service-role key). That env var is separate from
// SUPABASE_SERVICE_ROLE_KEY — operators may only have the service-role key
// available in their load-test environment (the direct DB URL requires a VPN /
// direct IP allow-list on Supabase). Using the supabase-js admin client is
// safer, avoids pulling in the full app module graph, and keeps this script
// self-contained.
//
// We replicate ONLY the two SQL operations createWorkspace performs:
//   1. INSERT INTO tenants (name, plan, business_profile) RETURNING id
//   2. INSERT INTO workspace_members (workspace_id, user_id, role)
// The business_profile column (added in 0022) is the mandatory tagging surface.
// The on_new_tenant_seed trigger fires on INSERT INTO tenants and seeds C-suite
// crons with next_run_at = NULL and enabled = false — confirmed in migration
// csuite-cron-seeding pattern (see MEMORY.md).

async function createSyntheticTenant(
  admin: SupabaseClient,
  userId: string,
  name: string,
  stamp: string,
): Promise<string> {
  // 1. Create the tenant with synthetic marker in business_profile.
  const { data: tenantRow, error: tenantErr } = await admin
    .from('tenants')
    .insert({
      name,
      plan: 'starter',
      business_profile: { synthetic: true, batch: stamp },
    })
    .select('id')
    .single();

  if (tenantErr || !tenantRow) {
    throw new Error(`Failed to insert tenant "${name}": ${tenantErr?.message}`);
  }
  const tenantId = tenantRow.id as string;

  // 2. Add owner membership.
  const { error: memberErr } = await admin
    .from('workspace_members')
    .upsert(
      { workspace_id: tenantId, user_id: userId, role: 'owner' },
      { onConflict: 'workspace_id,user_id', ignoreDuplicates: true },
    );

  if (memberErr) {
    throw new Error(`Failed to insert workspace_member for tenant ${tenantId}: ${memberErr.message}`);
  }

  // 3. Stamp tenant_id into the JWT so app auth paths resolve correctly.
  const { error: metaErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: tenantId },
  });
  if (metaErr) {
    // Non-fatal for load-testing — log but continue.
    console.warn(`  [warn] Could not set app_metadata for user ${userId}: ${metaErr.message}`);
  }

  return tenantId;
}

// ── Per-tenant inert data seeding ────────────────────────────────────────────

const KG_KINDS = ['person', 'company', 'topic', 'product', 'event', 'concept'];
const AGENT_IDS = [
  'research-analyst',
  'content-writer',
  'outreach-strategist',
  'scheduler',
  'reel-ideator',
  'reel-optimizer',
  'competitive-analyst',
];
const DRAFT_TYPES = ['post', 'email', 'script', 'report'];

async function seedTenantData(
  admin: SupabaseClient,
  tenantId: string,
  index: number,
  kgPerTenant: number,
  tasksPerTenant: number,
  draftsPerTenant: number,
): Promise<void> {
  // ── kg_entities ──────────────────────────────────────────────────────────
  // Use UPSERT (on conflict do nothing) for idempotency.
  const kgRows = Array.from({ length: kgPerTenant }, (_, j) => ({
    tenant_id: tenantId,
    kind: KG_KINDS[j % KG_KINDS.length],
    name: `Synthetic entity ${index}-${j}`,
    attributes: { synthetic: true, batch_index: index, item_index: j },
  }));

  // Batch insert in chunks of 50 to stay under Supabase insert limits.
  for (let offset = 0; offset < kgRows.length; offset += 50) {
    const chunk = kgRows.slice(offset, offset + 50);
    const { error } = await admin.from('kg_entities').upsert(chunk, {
      onConflict: 'tenant_id,kind,name',
      ignoreDuplicates: true,
    });
    if (error) throw new Error(`kg_entities insert failed for tenant ${tenantId}: ${error.message}`);
  }

  // ── agent_tasks ───────────────────────────────────────────────────────────
  // Insert as 'done' — inert, no running tasks.
  const now = new Date().toISOString();
  const taskRows = Array.from({ length: tasksPerTenant }, (_, j) => ({
    tenant_id: tenantId,
    agent_id: AGENT_IDS[j % AGENT_IDS.length],
    status: 'done' as const,
    task: `Synthetic load-test task ${index}-${j}`,
    result: `Synthetic result for tenant ${index} task ${j}`,
    input_tokens: 100 + (j * 7),
    output_tokens: 200 + (j * 13),
    started_at: now,
    completed_at: now,
    metadata: { synthetic: true, batch_index: index },
  }));

  for (let offset = 0; offset < taskRows.length; offset += 50) {
    const chunk = taskRows.slice(offset, offset + 50);
    const { error } = await admin.from('agent_tasks').insert(chunk);
    if (error) throw new Error(`agent_tasks insert failed for tenant ${tenantId}: ${error.message}`);
  }

  // ── agent_drafts ──────────────────────────────────────────────────────────
  // Insert as 'pending' — inert, will never be executed without human approval.
  const draftRows = Array.from({ length: draftsPerTenant }, (_, j) => ({
    tenant_id: tenantId,
    type: DRAFT_TYPES[j % DRAFT_TYPES.length],
    title: `Synthetic draft ${index}-${j}`,
    payload: `Synthetic payload content for tenant ${index} draft ${j}`,
    status: 'pending' as const,
    created_by: 'loadtest-seed',
    metadata: { synthetic: true, batch_index: index },
  }));

  for (let offset = 0; offset < draftRows.length; offset += 50) {
    const chunk = draftRows.slice(offset, offset + 50);
    const { error } = await admin.from('agent_drafts').insert(chunk);
    if (error) throw new Error(`agent_drafts insert failed for tenant ${tenantId}: ${error.message}`);
  }
}

// ── Safety assertions ─────────────────────────────────────────────────────────

async function assertNoEnabledCrons(
  admin: SupabaseClient,
  tenantIds: string[],
): Promise<void> {
  if (tenantIds.length === 0) return;

  // Query in batches because `in` filter has limits.
  const batchSize = 100;
  const violations: Array<{ tenant_id: string; id: string }> = [];

  for (let offset = 0; offset < tenantIds.length; offset += batchSize) {
    const batch = tenantIds.slice(offset, offset + batchSize);
    const { data, error } = await admin
      .from('cron_jobs')
      .select('tenant_id, id')
      .in('tenant_id', batch)
      .eq('enabled', true);

    if (error) throw new Error(`cron_jobs safety check failed: ${error.message}`);
    if (data && data.length > 0) {
      violations.push(...(data as Array<{ tenant_id: string; id: string }>));
    }
  }

  if (violations.length > 0) {
    console.error('\nSAFETY ASSERTION FAILED: found enabled cron_jobs on synthetic tenants:');
    for (const v of violations) {
      console.error(`  tenant_id=${v.tenant_id}  job_id=${v.id}`);
    }
    throw new Error(
      `ABORT: ${violations.length} enabled cron_job(s) found on synthetic tenants. ` +
      'Disable them before proceeding, or check why the on_new_tenant_seed trigger changed.',
    );
  }
}

// THE load-bearing credit-safety check. getAnthropicKey() resolves a tenant's
// Claude key from client_integrations(provider='anthropic'); with no such row,
// every agent call aborts before reaching the API — zero spend possible. The
// seed never writes one, but we VERIFY it against the live DB rather than trust
// a code-side counter, so a stray row from a future trigger/race can't slip a
// spendable tenant past us.
async function assertNoAnthropicKeys(
  admin: SupabaseClient,
  tenantIds: string[],
): Promise<void> {
  if (tenantIds.length === 0) return;
  const batchSize = 100;
  const violations: string[] = [];

  for (let offset = 0; offset < tenantIds.length; offset += batchSize) {
    const batch = tenantIds.slice(offset, offset + batchSize);
    const { data, error } = await admin
      .from('client_integrations')
      .select('tenant_id')
      .in('tenant_id', batch)
      .eq('provider', 'anthropic');

    if (error) throw new Error(`client_integrations safety check failed: ${error.message}`);
    if (data && data.length > 0) violations.push(...data.map((r) => (r as { tenant_id: string }).tenant_id));
  }

  if (violations.length > 0) {
    console.error('\nSAFETY ASSERTION FAILED: synthetic tenants carry an Anthropic key (spend possible):');
    for (const t of violations) console.error(`  tenant_id=${t}`);
    throw new Error(
      `ABORT: ${violations.length} synthetic tenant(s) have a client_integrations 'anthropic' row. ` +
      'Remove them before running any load test — these tenants could spend real API credits.',
    );
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs();
  const admin = makeAdminClient();

  console.log(`\nLoad-test tenant seeder`);
  console.log(`  count           = ${args.count}`);
  console.log(`  stamp           = ${args.stamp}`);
  console.log(`  kg-per-tenant   = ${args.kgPerTenant}`);
  console.log(`  tasks-per-tenant= ${args.tasksPerTenant}`);
  console.log(`  drafts-per-tenant=${args.draftsPerTenant}`);
  console.log('');

  const createdTenantIds: string[] = [];
  let skipped = 0;

  for (let i = 0; i < args.count; i++) {
    const email = `loadtest+${i}@synthetic.keyplayers.test`;
    const tenantName = `[LOADTEST] Synthetic Tenant ${i} (${args.stamp})`;

    // ── Check for existing user (idempotent skip) ──────────────────────────
    const { data: existing } = await admin.auth.admin.listUsers();
    const alreadyExists = (existing?.users ?? []).some((u) => u.email === email);

    if (alreadyExists) {
      process.stdout.write(`  [skip] ${email} already exists\n`);
      skipped++;
      continue;
    }

    // ── Create auth user ───────────────────────────────────────────────────
    const { data: created, error: userErr } = await admin.auth.admin.createUser({
      email,
      // Deterministic throwaway password — not reachable from outside (synthetic domain).
      password: `LT-${args.stamp}-${i}-synthetic`,
      email_confirm: true,
    });

    if (userErr || !created.user) {
      console.error(`  [error] createUser failed for ${email}: ${userErr?.message}`);
      continue;
    }

    const userId = created.user.id;

    // ── Create tenant ──────────────────────────────────────────────────────
    let tenantId: string;
    try {
      tenantId = await createSyntheticTenant(admin, userId, tenantName, args.stamp);
    } catch (err) {
      console.error(`  [error] tenant creation failed for ${email}: ${(err as Error).message}`);
      continue;
    }

    // ── Seed inert data ────────────────────────────────────────────────────
    try {
      await seedTenantData(
        admin,
        tenantId,
        i,
        args.kgPerTenant,
        args.tasksPerTenant,
        args.draftsPerTenant,
      );
    } catch (err) {
      console.error(`  [error] data seed failed for tenant ${tenantId}: ${(err as Error).message}`);
      // Still track the tenant so teardown can clean it up.
    }

    createdTenantIds.push(tenantId);

    if ((i + 1) % 10 === 0 || i === args.count - 1) {
      process.stdout.write(`  [ok] ${i + 1}/${args.count} tenants created\n`);
    }
  }

  // ── Safety: assert no spend is possible ───────────────────────────────────
  // Two live-DB assertions (not code-side counters). Either throwing ABORTS the
  // run before any load test can touch these tenants.
  console.log('\nRunning safety assertions on synthetic tenants...');
  await assertNoAnthropicKeys(admin, createdTenantIds);
  console.log('  PASS: 0 Anthropic keys (no agent call can spend).');
  await assertNoEnabledCrons(admin, createdTenantIds);
  console.log('  PASS: 0 enabled cron_jobs.');

  // ── Summary ───────────────────────────────────────────────────────────────
  const totalData = createdTenantIds.length;
  console.log(`
── Summary ───────────────────────────────────────────
  Tenants created  : ${totalData}
  Tenants skipped  : ${skipped}
  Anthropic keys   : 0  (verified against client_integrations — no spend possible)
  Enabled crons    : 0  (assertion passed)
  KG entities      : ~${totalData * args.kgPerTenant}
  Agent tasks      : ~${totalData * args.tasksPerTenant}
  Agent drafts     : ~${totalData * args.draftsPerTenant}
──────────────────────────────────────────────────────
`);
}

main().catch((err) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
