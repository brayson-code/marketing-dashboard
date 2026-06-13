// GET /api/tenant/export — owner-gated full export of a tenant's own assets.
//
// Satisfies the client-ownership requirement: a workspace owner can download
// EVERYTHING their workspace has created — documents, custom agents, knowledge
// graph, automations (crons + campaigns), CRM, outreach, engagement history —
// as a single ZIP they can keep or migrate. Their data is theirs; this is the
// "take it with you" button.
//
// What's included: content + work tables, tenant-scoped to the caller.
// What's EXCLUDED, and why:
//   - client_integrations: holds AES-encrypted third-party SECRETS that are
//     useless without the platform key, and exporting key material is a security
//     risk. We export the list of CONNECTED PROVIDERS (names + connected_at) only.
//   - billing/system internals (stripe events, entitlements, error_events,
//     audit_log): platform plumbing, not the client's assets.
//   - auth/member PII beyond the caller's own workspace membership.

import { zipSync, strToU8 } from 'fflate';
import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Content/work tables exported verbatim (SELECT * WHERE tenant_id = caller).
// Order is cosmetic. Tables that don't exist in an environment are skipped.
const EXPORT_TABLES = [
  'documents', 'agent_defs', 'kg_entities', 'kg_relations',
  'goals', 'goal_progress', 'cron_jobs', 'cron_templates', 'cron_runs',
  'wave_runs', 'wave_step_runs', 'leads', 'sequences', 'suppression',
  'engagements', 'signals', 'content_posts', 'agent_drafts', 'agent_tasks',
  'agent_memory', 'messages', 'boardroom_messages', 'agentmail_messages',
  'daily_metrics', 'learnings', 'experiments', 'reward_events', 'agent_policy',
  'activity_log', 'notifications',
] as const;

/** Only the workspace owner can export the whole workspace. */
async function isTenantOwner(): Promise<boolean> {
  const uid = currentUserId();
  if (!uid) return false;
  const rows = (await sql()`
    SELECT 1 FROM public.workspace_members
    WHERE workspace_id = ${tenantId()} AND user_id = ${uid} AND role = 'owner'
    LIMIT 1
  `) as unknown as unknown[];
  return rows.length > 0;
}

function safeName(s: string, fallback: string): string {
  const base = (s || fallback).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return base.slice(0, 80) || fallback;
}

export async function GET() {
  enterTenant(await resolveTenant());
  if (!(await isTenantOwner())) {
    return NextResponse.json({ error: 'Only the workspace owner can export.' }, { status: 403 });
  }

  const tid = tenantId();
  const data: Record<string, unknown[]> = {};
  const skipped: Record<string, string> = {};

  for (const table of EXPORT_TABLES) {
    try {
      // Table identifiers can't be parameterized; the list above is a fixed
      // allow-list of known table names, so this is not injectable.
      const rows = (await sql().unsafe(
        `SELECT * FROM public.${table} WHERE tenant_id = $1`,
        [tid],
      )) as unknown as unknown[];
      data[table] = rows;
    } catch (e) {
      skipped[table] = (e as Error).message.slice(0, 120);
    }
  }

  // Connected providers (names only — never the encrypted secrets).
  let providers: unknown[] = [];
  try {
    providers = (await sql()`
      SELECT provider, status, connected_at, created_at
      FROM public.client_integrations WHERE tenant_id = ${tid}
    `) as unknown as unknown[];
  } catch { /* table may not exist; leave empty */ }

  // The tenant's own profile/config (business brief, autonomy, etc.).
  let profile: unknown = null;
  try {
    const r = (await sql()`
      SELECT id, name, plan, onboarding_complete, business_profile, created_at
      FROM public.tenants WHERE id = ${tid} LIMIT 1
    `) as unknown as unknown[];
    profile = r[0] ?? null;
  } catch { /* ignore */ }

  const stamp = new Date().toISOString();
  const manifest = {
    exported_at: stamp,
    tenant_id: tid,
    workspace: profile,
    connected_providers: providers,
    tables: Object.fromEntries(Object.entries(data).map(([t, rows]) => [t, rows.length])),
    skipped,
    note:
      'This archive contains everything your workspace created. Third-party API ' +
      'keys are intentionally not included (they are your own keys, held by you). ' +
      'export.json holds all rows; documents/ and agents/ are rendered for portability.',
  };

  // Assemble the ZIP (fflate). Files: manifest + the full JSON + rendered
  // markdown for the two most-portable asset types (docs + agents).
  const files: Record<string, Uint8Array> = {};
  const enc = (s: string) => strToU8(s);
  files['manifest.json'] = enc(JSON.stringify(manifest, null, 2));
  files['export.json'] = enc(JSON.stringify({ ...manifest, data, profile }, null, 2));

  for (const doc of (data['documents'] ?? []) as Array<Record<string, unknown>>) {
    const name = safeName(String(doc.title ?? ''), `doc-${doc.id}`);
    const body = `# ${doc.title ?? 'Untitled'}\n\n${doc.content ?? ''}\n`;
    files[`documents/${name}.md`] = enc(body);
  }
  for (const a of (data['agent_defs'] ?? []) as Array<Record<string, unknown>>) {
    const name = safeName(String(a.id ?? a.name ?? ''), `agent-${a.id}`);
    const body =
      `# ${a.name ?? a.id}\n\n## Soul\n${a.soul ?? ''}\n\n## Agent\n${a.agent_md ?? ''}\n\n## Skills\n${a.skills ?? ''}\n`;
    files[`agents/${name}.md`] = enc(body);
  }

  const zipped = zipSync(files, { level: 6 });
  // zipSync returns a Uint8Array backed by an ArrayBuffer — hand the body a fresh
  // copy to satisfy the BodyInit type without a SharedArrayBuffer ambiguity.
  const body = new Uint8Array(zipped);
  const filename = `command-center-export-${stamp.slice(0, 10)}.zip`;
  return new NextResponse(body, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  });
}
