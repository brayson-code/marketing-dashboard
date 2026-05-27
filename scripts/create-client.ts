// Provision a new client: a Supabase auth user + their own tenant (workspace) +
// owner membership + the JWT tenant claim (app_metadata.tenant_id) that the app
// reads per request. Needs the service-role key (admin).
//
// Run: npx tsx --env-file=.env.local scripts/create-client.ts <email> <password> "<Workspace Name>"
// (SUPABASE_SERVICE_ROLE_KEY must be present in the env / .env.local)

import { createClient } from '@supabase/supabase-js';
import { createWorkspace } from '../src/lib/workspace';

async function main() {
  const [email, password, name] = process.argv.slice(2);
  if (!email || !password) {
    console.error('Usage: tsx scripts/create-client.ts <email> <password> "<Workspace Name>"');
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env.');
    process.exit(1);
  }

  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  // 1) Create the auth user (email pre-confirmed so they can log in immediately).
  const { data: created, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
  });
  if (error || !created.user) { console.error('createUser failed:', error?.message); process.exit(1); }
  const userId = created.user.id;

  // 2) Create their tenant (workspace) + owner membership.
  const tenantId = await createWorkspace(name || `${email}'s workspace`, userId);

  // 3) Stamp the tenant into the JWT so every request resolves to THIS workspace.
  const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
    app_metadata: { tenant_id: tenantId },
  });
  if (updErr) { console.error('set app_metadata failed:', updErr.message); process.exit(1); }

  console.log(JSON.stringify({ ok: true, email, userId, tenantId }, null, 2));
  process.exit(0);
}

main().catch((e) => { console.error('create-client error:', e); process.exit(2); });
