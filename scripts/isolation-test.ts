// Tenant-isolation verification. Proves runWithTenant() + tenantId() scope real
// queries so workspace A cannot read workspace B's rows. Writes a labeled draft
// under two random tenant ids, cross-checks visibility, then cleans up.
// Run: npx tsx --env-file=.env.local scripts/isolation-test.ts

import { randomUUID } from 'node:crypto';
import { runWithTenant } from '../src/lib/tenant';
import { createDraft, listDrafts } from '../src/lib/drafts';
import { sql } from '../src/lib/db/client';

const A = randomUUID();
const B = randomUUID();
const ctx = (t: string) => ({ tenantId: t, userId: null });

async function main() {
  // tenant_id FKs → tenants, so the two test tenants must exist first.
  await sql()`INSERT INTO public.tenants (id, name, plan) VALUES (${A}, 'ISO-TEST-A', 'test'), (${B}, 'ISO-TEST-B', 'test') ON CONFLICT (id) DO NOTHING`;

  // Write one draft as each tenant.
  const dA = await runWithTenant(ctx(A), () =>
    createDraft({ type: 'other', title: 'ISO-TEST-A', payload: 'a', createdBy: 'iso-test' }));
  const dB = await runWithTenant(ctx(B), () =>
    createDraft({ type: 'other', title: 'ISO-TEST-B', payload: 'b', createdBy: 'iso-test' }));

  // Read drafts in each tenant's context.
  const aList = await runWithTenant(ctx(A), () => listDrafts({ status: 'all', limit: 200 }));
  const bList = await runWithTenant(ctx(B), () => listDrafts({ status: 'all', limit: 200 }));

  const aSeesOwn = aList.some((d) => d.id === dA.id);
  const bSeesOwn = bList.some((d) => d.id === dB.id);
  const aSeesB = aList.some((d) => d.id === dB.id);
  const bSeesA = bList.some((d) => d.id === dA.id);

  // Cleanup (only our test rows): drafts first (FK), then the test tenants.
  const del = await sql()`DELETE FROM agent_drafts WHERE created_by = 'iso-test' RETURNING id`;
  await sql()`DELETE FROM public.tenants WHERE id IN (${A}, ${B})`;

  const pass = aSeesOwn && bSeesOwn && !aSeesB && !bSeesA;
  console.log(JSON.stringify({
    tenantA: A.slice(0, 8), tenantB: B.slice(0, 8),
    aSeesOwn, bSeesOwn, aSeesB, bSeesA,
    aCount: aList.length, bCount: bList.length, cleanedUp: del.length,
    result: pass ? 'PASS — tenants isolated' : 'FAIL — cross-tenant leak',
  }, null, 2));
  process.exit(pass ? 0 : 1);
}

main().catch((e) => { console.error('iso-test error:', e); process.exit(2); });
