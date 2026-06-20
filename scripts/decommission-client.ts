// Decommission a client workspace — the DESTRUCTIVE counterpart to the in-app "request
// decommission" (which only notifies). Deliberately kept OUT of the Command Center: it uses
// the service-role key on a TRUSTED machine, so a hijacked HQ web session can never reach it.
//
// Run:
//   npx tsx --env-file=.env.local scripts/decommission-client.ts <tenantId|ownerEmail> <revoke|delete> [--yes]
//
//     revoke → ban every member's login + global sign-out their sessions. Data is KEPT;
//              fully reversible (unban from Supabase, or a future `--unban`).
//     delete → hard-delete member auth accounts whose ONLY workspace was this one, then
//              DELETE FROM tenants — which CASCADES every tenant-scoped table (migration 0052
//              backfilled the missing cascade FKs, incl. credential tables). IRREVERSIBLE.
//
// HQ (DEFAULT_TENANT_ID) can never be the target. Needs SUPABASE_SERVICE_ROLE_KEY,
// NEXT_PUBLIC_SUPABASE_URL and SUPABASE_DB_URL in the env (.env.local). Writes an audit_log row.

import { createClient } from '@supabase/supabase-js';
import readline from 'node:readline';
import { sql } from '../src/lib/db/client';
import { DEFAULT_TENANT_ID } from '../src/lib/tenant';
import { revokeUserSessions } from '../src/lib/members';

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => rl.question(question, (a) => { rl.close(); resolve(a.trim()); }));
}

async function main() {
  const [selector, modeArg] = process.argv.slice(2);
  const yes = process.argv.includes('--yes');
  const mode = modeArg === 'delete' ? 'delete' : modeArg === 'revoke' ? 'revoke' : null;
  if (!selector || !mode) {
    console.error('Usage: tsx scripts/decommission-client.ts <tenantId|ownerEmail> <revoke|delete> [--yes]');
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env (.env.local).');
    process.exit(1);
  }
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const db = sql();

  // Resolve the target tenant — accept a tenant id directly, or an owner email.
  let target: string;
  if (selector.includes('@')) {
    let userId: string | null = null;
    for (let page = 1; page <= 10; page++) {
      const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
      if (error) { console.error('listUsers failed:', error.message); process.exit(1); }
      const u = data.users.find((x) => (x.email ?? '').toLowerCase() === selector.toLowerCase());
      if (u) { userId = u.id; break; }
      if (data.users.length < 1000) break;
    }
    if (!userId) { console.error(`No auth user with email ${selector}.`); process.exit(1); }
    const owned = (await db`
      SELECT workspace_id::text AS id FROM public.workspace_members
      WHERE user_id = ${userId} AND role = 'owner' AND workspace_id <> ${DEFAULT_TENANT_ID}
      ORDER BY created_at LIMIT 1
    `) as unknown as Array<{ id: string }>;
    if (!owned[0]) { console.error(`${selector} doesn't own a client workspace.`); process.exit(1); }
    target = owned[0].id;
  } else {
    target = selector;
  }

  if (target === DEFAULT_TENANT_ID) { console.error('Refusing to decommission the HQ workspace.'); process.exit(1); }

  const t = (await db`
    SELECT name FROM public.tenants WHERE id = ${target} AND id <> ${DEFAULT_TENANT_ID} LIMIT 1
  `) as unknown as Array<{ name: string }>;
  if (!t[0]) { console.error(`Client workspace ${target} not found.`); process.exit(1); }

  const members = (await db`
    SELECT user_id::text AS user_id FROM public.workspace_members WHERE workspace_id = ${target}
  `) as unknown as Array<{ user_id: string }>;

  console.log('');
  console.log(`  Client:    ${t[0].name}`);
  console.log(`  Tenant id: ${target}`);
  console.log(`  Members:   ${members.length}`);
  console.log(`  Mode:      ${mode.toUpperCase()}  ${mode === 'delete'
    ? '— IRREVERSIBLE: deletes the workspace + ALL its data + sole-tenant member accounts'
    : '— reversible: bans + signs out every member'}`);
  console.log('');

  if (!yes) {
    const typed = await ask(`Type the workspace name (${t[0].name}) to confirm: `);
    if (typed !== t[0].name) { console.log('Name did not match — aborted.'); process.exit(0); }
  }

  if (mode === 'revoke') {
    let revoked = 0;
    let banFailed = 0;
    for (const m of members) {
      try { await admin.auth.admin.updateUserById(m.user_id, { ban_duration: '876000h' }); }
      catch { banFailed++; }
      if (await revokeUserSessions(m.user_id)) revoked++;
    }
    await db`
      INSERT INTO public.audit_log (tenant_id, actor_id, actor_username, action, target, detail)
      VALUES (${DEFAULT_TENANT_ID}, ${null}, ${'cli operator'}, ${'client.revoke'}, ${target},
              ${JSON.stringify({ name: t[0].name, members: members.length, sessions_revoked: revoked, ban_failed: banFailed })})
    `;
    console.log(`\n✅ Revoked "${t[0].name}". members=${members.length} sessions_revoked=${revoked} ban_failed=${banFailed}`);
    console.log('   (Reversible: unban each user in Supabase to restore access.)');
    process.exit(0);
  }

  // delete
  let deletedUsers = 0;
  for (const m of members) {
    const others = (await db`
      SELECT 1 FROM public.workspace_members WHERE user_id = ${m.user_id} AND workspace_id <> ${target} LIMIT 1
    `) as unknown as unknown[];
    if (others.length === 0) {
      try { await admin.auth.admin.deleteUser(m.user_id); deletedUsers++; }
      catch (e) { console.warn(`  deleteUser ${m.user_id} failed: ${(e as Error).message}`); }
    }
  }
  await db`DELETE FROM public.tenants WHERE id = ${target} AND id <> ${DEFAULT_TENANT_ID}`;
  await db`
    INSERT INTO public.audit_log (tenant_id, actor_id, actor_username, action, target, detail)
    VALUES (${DEFAULT_TENANT_ID}, ${null}, ${'cli operator'}, ${'client.delete'}, ${target},
            ${JSON.stringify({ name: t[0].name, members: members.length, deleted_users: deletedUsers })})
  `;
  console.log(`\n✅ Deleted "${t[0].name}". members=${members.length} deleted_users=${deletedUsers}. All tenant data cascaded.`);
  process.exit(0);
}

main().catch((e) => { console.error('decommission-client error:', e); process.exit(2); });
