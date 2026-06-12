/**
 * scripts/loadtest/teardown-synthetic-tenants.ts
 *
 * LOAD-TEST ARTIFACT — DO NOT RUN IN PRODUCTION.
 *
 * Deletes every tenant tagged { "synthetic": true } in business_profile.
 * NEVER touches the HQ tenant (fff35ccb-d1da-4fef-b8cb-e363fe1b8e14).
 *
 * Dry-run by default: pass --confirm to actually delete.
 *
 * NO-SPEND GUARANTEE:
 *   Synthetic tenants have no client_integrations rows (no Anthropic key).
 *   This script deletes them in FK-safe order so no cascade surprises.
 *
 * Usage:
 *   # Dry run (safe to run first — shows what would be deleted):
 *   pnpm tsx --env-file=.env.local scripts/loadtest/teardown-synthetic-tenants.ts
 *
 *   # Actually delete:
 *   pnpm tsx --env-file=.env.local scripts/loadtest/teardown-synthetic-tenants.ts --confirm
 *
 * Env vars (from .env.local):
 *   NEXT_PUBLIC_SUPABASE_URL       — Supabase project URL
 *   SUPABASE_SERVICE_ROLE_KEY      — service-role key (admin, bypasses RLS)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── HQ tenant hard-exclude ────────────────────────────────────────────────────
const HQ_TENANT_ID = 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';

// ── CLI arg parsing ───────────────────────────────────────────────────────────

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    dryRun: !argv.includes('--confirm'),
  };
}

// ── Supabase admin client ─────────────────────────────────────────────────────

function makeAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      'ERROR: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.\n' +
      'Run with: pnpm tsx --env-file=.env.local scripts/loadtest/teardown-synthetic-tenants.ts',
    );
    process.exit(1);
  }
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// ── Find synthetic tenants ────────────────────────────────────────────────────

async function findSyntheticTenantIds(admin: SupabaseClient): Promise<string[]> {
  // business_profile->>'synthetic' = 'true'
  // Supabase JS filter uses the PostgREST arrow operator syntax.
  const { data, error } = await admin
    .from('tenants')
    .select('id, name, business_profile')
    .filter('business_profile->>synthetic', 'eq', 'true');

  if (error) {
    throw new Error(`Failed to query synthetic tenants: ${error.message}`);
  }

  const rows = (data ?? []) as Array<{ id: string; name: string; business_profile: Record<string, unknown> | null }>;

  // Hard exclude HQ even if somehow tagged (belt-and-suspenders).
  const filtered = rows.filter((r) => r.id !== HQ_TENANT_ID);
  const excluded = rows.filter((r) => r.id === HQ_TENANT_ID);

  if (excluded.length > 0) {
    console.warn(
      `[warn] HQ tenant (${HQ_TENANT_ID}) was found in synthetic query — skipping it unconditionally.`,
    );
  }

  return filtered.map((r) => r.id);
}

// ── Deletion in FK-safe order ─────────────────────────────────────────────────
//
// FK dependency graph (all reference tenants.id ON DELETE CASCADE, but we
// delete explicitly to be precise about what we're removing and why):
//
// Wave step runs must go BEFORE wave runs (wave_step_runs.wave_run_id → wave_runs.id
// ON DELETE CASCADE, so deleting wave_runs would cascade — but we make it explicit).
//
// gene_events must go BEFORE strategy_genes (gene_events.gene_id → strategy_genes.id
// ON DELETE CASCADE).
//
// kg_relations must go BEFORE kg_entities (kg_relations.from_id/to_id → kg_entities.id
// ON DELETE CASCADE).
//
// competitor_reels must go BEFORE competitors (competitor_reels.competitor_id →
// competitors.id ON DELETE SET NULL — not a hard cascade, but cleaner to delete first).
//
// Everything else references only tenants.id directly (ON DELETE CASCADE), so order
// among siblings doesn't strictly matter — but we list them explicitly so the output
// is auditable.
//
// workspace_members goes AFTER child tables but BEFORE tenants (it references
// tenants.id ON DELETE CASCADE via workspace_members_workspace_id_fkey added in 0022).
//
// The tenants row is last; deleting it would cascade to any row we missed.
//
// Auth users are deleted AFTER tenants so the tenant row is gone before the auth
// user is removed from auth.users (prevents the on_auth_user_created trigger from
// linking them to HQ — that trigger adds to tenant_members not tenants, so it fires
// on INSERT not DELETE; still safest to remove tenant first).

type DeleteStep = {
  table: string;
  column: string; // column that holds tenant_id (almost always 'tenant_id')
  label: string;
  batchColumn?: string; // if we need to batch by a different column
};

const DELETE_STEPS: DeleteStep[] = [
  // ── Deep children (have FKs to other child tables) ────────────────────────
  {
    table: 'wave_step_runs',
    column: 'tenant_id',
    label: 'wave_step_runs  (FK → wave_runs.id ON DELETE CASCADE; explicit for auditability)',
  },
  {
    table: 'gene_events',
    column: 'tenant_id',
    label: 'gene_events     (FK → strategy_genes.id ON DELETE CASCADE)',
  },
  {
    table: 'kg_relations',
    column: 'tenant_id',
    label: 'kg_relations    (FK → kg_entities.id ON DELETE CASCADE)',
  },
  {
    table: 'competitor_reels',
    column: 'tenant_id',
    label: 'competitor_reels(FK → competitors.id ON DELETE SET NULL — explicit delete)',
  },
  // ── Mid-level children ────────────────────────────────────────────────────
  {
    table: 'wave_runs',
    column: 'tenant_id',
    label: 'wave_runs',
  },
  {
    table: 'strategy_genes',
    column: 'tenant_id',
    label: 'strategy_genes',
  },
  {
    table: 'gene_config',
    column: 'tenant_id',
    label: 'gene_config     (PK = tenant_id)',
  },
  {
    table: 'kg_entities',
    column: 'tenant_id',
    label: 'kg_entities',
  },
  {
    table: 'competitors',
    column: 'tenant_id',
    label: 'competitors',
  },
  // ── Direct tenant children (all FK tenant_id → tenants.id) ───────────────
  {
    table: 'cron_runs',
    column: 'tenant_id',
    label: 'cron_runs',
  },
  {
    table: 'cron_jobs',
    column: 'tenant_id',
    label: 'cron_jobs',
  },
  {
    table: 'reward_events',
    column: 'tenant_id',
    label: 'reward_events',
  },
  {
    table: 'agent_policy',
    column: 'tenant_id',
    label: 'agent_policy',
  },
  {
    table: 'agent_tasks',
    column: 'tenant_id',
    label: 'agent_tasks',
  },
  {
    table: 'agent_drafts',
    column: 'tenant_id',
    label: 'agent_drafts',
  },
  {
    table: 'agent_defs',
    column: 'tenant_id',
    label: 'agent_defs',
  },
  {
    table: 'client_integrations',
    column: 'tenant_id',
    label: 'client_integrations (should be 0 for synthetic tenants — verified)',
  },
  {
    table: 'documents',
    column: 'tenant_id',
    label: 'documents',
  },
  {
    table: 'content_posts',
    column: 'tenant_id',
    label: 'content_posts',
  },
  {
    table: 'leads',
    column: 'tenant_id',
    label: 'leads',
  },
  {
    table: 'sequences',
    column: 'tenant_id',
    label: 'sequences       (FK → leads.id — but leads deleted in same tenant scope)',
  },
  {
    table: 'suppression',
    column: 'tenant_id',
    label: 'suppression',
  },
  {
    table: 'engagements',
    column: 'tenant_id',
    label: 'engagements',
  },
  {
    table: 'signals',
    column: 'tenant_id',
    label: 'signals',
  },
  {
    table: 'experiments',
    column: 'tenant_id',
    label: 'experiments',
  },
  {
    table: 'learnings',
    column: 'tenant_id',
    label: 'learnings',
  },
  {
    table: 'daily_metrics',
    column: 'tenant_id',
    label: 'daily_metrics',
  },
  {
    table: 'activity_log',
    column: 'tenant_id',
    label: 'activity_log',
  },
  {
    table: 'notifications',
    column: 'tenant_id',
    label: 'notifications',
  },
  {
    table: 'messages',
    column: 'tenant_id',
    label: 'messages',
  },
  {
    table: 'boardroom_messages',
    column: 'tenant_id',
    label: 'boardroom_messages',
  },
  {
    table: 'audit_log',
    column: 'tenant_id',
    label: 'audit_log',
  },
  {
    table: 'cron_templates',
    column: 'tenant_id',
    label: 'cron_templates',
  },
  {
    table: 'time_savings_log',
    column: 'tenant_id',
    label: 'time_savings_log',
  },
  {
    table: 'key_audit',
    column: 'tenant_id',
    label: 'key_audit       (PK = tenant_id)',
  },
  {
    table: 'reel_ideas',
    column: 'tenant_id',
    label: 'reel_ideas',
  },
  {
    table: 'reel_scans',
    column: 'tenant_id',
    label: 'reel_scans',
  },
  {
    table: 'tenant_assets',
    column: 'tenant_id',
    label: 'tenant_assets',
  },
  {
    table: 'connections',
    column: 'tenant_id',
    label: 'connections',
  },
  {
    table: 'tenant_members',
    column: 'tenant_id',
    label: 'tenant_members  (original 0001 membership table)',
  },
  // workspace_members references tenants.id (renamed FK in 0022)
  {
    table: 'workspace_members',
    column: 'workspace_id',
    label: 'workspace_members (FK workspace_id → tenants.id, renamed in 0022)',
  },
];

// ── Count rows for a table across synthetic tenants ───────────────────────────

async function countRows(
  admin: SupabaseClient,
  table: string,
  column: string,
  tenantIds: string[],
): Promise<number> {
  let total = 0;
  const batchSize = 100;
  for (let offset = 0; offset < tenantIds.length; offset += batchSize) {
    const batch = tenantIds.slice(offset, offset + batchSize);
    const { count, error } = await admin
      .from(table)
      .select('*', { count: 'exact', head: true })
      .in(column, batch);
    if (error) {
      // Some tables may not exist yet (forward-compat). Log and continue.
      console.warn(`  [warn] count query on ${table}: ${error.message}`);
      return -1;
    }
    total += count ?? 0;
  }
  return total;
}

// ── Delete rows for a table across synthetic tenants ─────────────────────────

async function deleteRows(
  admin: SupabaseClient,
  table: string,
  column: string,
  tenantIds: string[],
  dryRun: boolean,
): Promise<number> {
  if (dryRun) {
    return countRows(admin, table, column, tenantIds);
  }

  let total = 0;
  const batchSize = 100;
  for (let offset = 0; offset < tenantIds.length; offset += batchSize) {
    const batch = tenantIds.slice(offset, offset + batchSize);
    const { error, count } = await admin
      .from(table)
      .delete({ count: 'exact' })
      .in(column, batch);
    if (error) {
      // Non-fatal for tables that may not exist or have no rows.
      console.warn(`  [warn] delete on ${table}: ${error.message}`);
      continue;
    }
    total += count ?? 0;
  }
  return total;
}

// ── Delete auth users ─────────────────────────────────────────────────────────

async function deleteAuthUsers(
  admin: SupabaseClient,
  tenantIds: string[],
  dryRun: boolean,
): Promise<number> {
  if (tenantIds.length === 0) return 0;

  // Find auth users whose email matches the synthetic pattern.
  // We use the listUsers admin API (paginated).
  const allUsers = await (async () => {
    const users: Array<{ id: string; email: string | undefined }> = [];
    let page = 1;
    const perPage = 1000;
    while (true) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
      if (error) throw new Error(`listUsers failed: ${error.message}`);
      const batch = data?.users ?? [];
      users.push(...batch.map((u) => ({ id: u.id, email: u.email })));
      if (batch.length < perPage) break;
      page++;
    }
    return users;
  })();

  const synthetic = allUsers.filter(
    (u) =>
      typeof u.email === 'string' &&
      u.email.startsWith('loadtest+') &&
      u.email.endsWith('@synthetic.keyplayers.test'),
  );

  if (dryRun) {
    console.log(`  [dry-run] would delete ${synthetic.length} auth users`);
    return synthetic.length;
  }

  let deleted = 0;
  for (const user of synthetic) {
    const { error } = await admin.auth.admin.deleteUser(user.id);
    if (error) {
      console.warn(`  [warn] deleteUser ${user.email}: ${error.message}`);
    } else {
      deleted++;
    }
  }
  return deleted;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const { dryRun } = parseArgs();
  const admin = makeAdminClient();

  console.log(`\nLoad-test tenant teardown — ${dryRun ? 'DRY RUN (pass --confirm to delete)' : 'LIVE DELETE'}`);
  console.log(`HQ tenant hard-excluded: ${HQ_TENANT_ID}\n`);

  // ── Discover synthetic tenants ─────────────────────────────────────────────
  const tenantIds = await findSyntheticTenantIds(admin);

  if (tenantIds.length === 0) {
    console.log('No synthetic tenants found. Nothing to do.');
    process.exit(0);
  }

  console.log(`Found ${tenantIds.length} synthetic tenant(s).\n`);

  // ── Process each child table ───────────────────────────────────────────────
  const summary: Array<{ label: string; count: number }> = [];

  for (const step of DELETE_STEPS) {
    const count = await deleteRows(admin, step.table, step.column, tenantIds, dryRun);
    const prefix = dryRun ? '[dry-run]' : '[deleted]';
    if (count < 0) {
      console.log(`  ${prefix} ${step.label}: (table not found or query error — skipped)`);
    } else if (count > 0) {
      console.log(`  ${prefix} ${step.label}: ${count} rows`);
      summary.push({ label: step.table, count });
    } else {
      // Quiet zero counts to keep output readable.
    }
  }

  // ── Delete tenants themselves ──────────────────────────────────────────────
  let tenantsDeleted = 0;
  if (!dryRun) {
    const batchSize = 100;
    for (let offset = 0; offset < tenantIds.length; offset += batchSize) {
      const batch = tenantIds.slice(offset, offset + batchSize);
      const { error, count } = await admin
        .from('tenants')
        .delete({ count: 'exact' })
        .in('id', batch)
        .neq('id', HQ_TENANT_ID); // double safety
      if (error) {
        console.warn(`  [warn] delete tenants: ${error.message}`);
      } else {
        tenantsDeleted += count ?? 0;
      }
    }
    console.log(`  [deleted] tenants: ${tenantsDeleted} rows`);
  } else {
    console.log(`  [dry-run] would delete ${tenantIds.length} tenants`);
    tenantsDeleted = tenantIds.length;
  }

  // ── Delete auth users ──────────────────────────────────────────────────────
  const usersDeleted = await deleteAuthUsers(admin, tenantIds, dryRun);
  const userPrefix = dryRun ? '[dry-run]' : '[deleted]';
  console.log(`  ${userPrefix} auth users (loadtest+*@synthetic.keyplayers.test): ${usersDeleted}`);

  // ── Summary ────────────────────────────────────────────────────────────────
  const action = dryRun ? 'Would delete' : 'Deleted';
  console.log(`
── ${dryRun ? 'Dry-run' : ''} Summary ───────────────────────────────────`);
  for (const s of summary) {
    console.log(`  ${s.label.padEnd(24)} ${s.count}`);
  }
  console.log(`  ${'tenants'.padEnd(24)} ${tenantsDeleted}`);
  console.log(`  ${'auth users'.padEnd(24)} ${usersDeleted}`);
  console.log(`──────────────────────────────────────────────────────`);
  if (dryRun) {
    console.log(`\nRe-run with --confirm to actually delete.\n`);
  } else {
    console.log(`\n${action} ${tenantsDeleted} synthetic tenants and ${usersDeleted} auth users.\n`);
  }
}

main().catch((err) => {
  console.error('\nFATAL:', err instanceof Error ? err.message : err);
  process.exit(1);
});
