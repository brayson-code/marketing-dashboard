// scripts/seed-test-env.ts
//
// Bootstraps the TEST Supabase project (ref dgcanicamgdeqehnvcmc) so the app is
// usable: creates the HQ tenant + the owner login (brayson@keyplayershq.com).
// IDEMPOTENT — safe to re-run.
//
// The TEST project has NO service-role key, so the owner is created with DIRECT
// SQL into auth.users + auth.identities (see scripts/lib/test-seed-common.ts),
// not the auth-admin API. Email+password login works because we write a bcrypt
// (pgcrypto) hash exactly the way GoTrue does.
//
// The login password comes from env TEST_LOGIN_PASSWORD — never hardcoded, never
// printed.
//
// Run:
//   npx tsx --env-file=.env.test.local scripts/seed-test-env.ts
//
// After it prints the HQ tenant id, paste that id into .env.test.local for both
// DEFAULT_TENANT_ID and NEXT_PUBLIC_DEFAULT_TENANT_ID (they start as the
// __HQ_TENANT_ID__ placeholder) so the app recognizes this tenant as HQ.

import { sql } from '../src/lib/db/client';
import { createWorkspace } from '../src/lib/workspace';
import {
  assertTestProject,
  requireEnv,
  ensurePgcryptoSchema,
  ensureAuthUser,
  stampTenantClaim,
  ensureMembership,
  tenantIdByName,
  seedOrgChartIfEmpty,
} from './lib/test-seed-common';

const HQ_NAME = 'KeyPlayers HQ (TEST)';
const OWNER_EMAIL = 'brayson@keyplayershq.com';

async function main() {
  // 1) Hard guard: only ever run against the TEST project.
  assertTestProject();

  const password = requireEnv('TEST_LOGIN_PASSWORD');
  const pgcryptoSchema = await ensurePgcryptoSchema();

  // 2) Owner auth user (idempotent). tenant claim stamped after the tenant exists.
  const { userId, created: userCreated } = await ensureAuthUser({
    email: OWNER_EMAIL,
    password,
    pgcryptoSchema,
  });
  console.log(`✅ owner user ${userCreated ? 'created' : 'reused'}: ${OWNER_EMAIL}`);

  // 3) HQ tenant (idempotent by name). createWorkspace also inserts the owner
  //    membership row on first creation.
  let tenantId = await tenantIdByName(HQ_NAME);
  if (tenantId) {
    console.log(`✅ HQ tenant reused: ${tenantId}`);
    await ensureMembership(tenantId, userId, 'owner');
  } else {
    tenantId = await createWorkspace(HQ_NAME, userId, 'pro');
    console.log(`✅ HQ tenant created: ${tenantId}`);
  }

  // 4) Pin the owner's session to HQ (JWT app_metadata.tenant_id — the claim the
  //    app reads per request). Provider/providers are already set by ensureAuthUser.
  await stampTenantClaim(userId, tenantId);
  console.log('✅ owner JWT claim pinned to HQ');

  // 5) Ensure the org chart exists. On a fresh TEST DB the trigger's seed source
  //    is empty, so this is typically a no-op and the app renders agents from the
  //    bundled agents/** files. Best-effort per the plan.
  const agentCount = await seedOrgChartIfEmpty(tenantId);
  if (agentCount > 0) {
    console.log(`✅ agent_defs present for HQ: ${agentCount} row(s)`);
  } else {
    console.log('ℹ️  HQ has 0 agent_defs rows — the app falls back to the bundled agents/** files (expected on a fresh TEST DB).');
  }

  // 6) Safe summary (no secrets).
  console.log('');
  console.log(JSON.stringify({ ok: true, tenantId, userId, email: OWNER_EMAIL }, null, 2));
  console.log('');
  console.log('NEXT: set DEFAULT_TENANT_ID and NEXT_PUBLIC_DEFAULT_TENANT_ID in .env.test.local to:');
  console.log(`  ${tenantId}`);
  console.log('(replace the __HQ_TENANT_ID__ placeholder) so the app treats this tenant as HQ.');

  process.exit(0);
}

main().catch(async (e) => {
  console.error('seed-test-env error:', e);
  try { await sql().end({ timeout: 5 }); } catch { /* ignore */ }
  process.exit(2);
});
