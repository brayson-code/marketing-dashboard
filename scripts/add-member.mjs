// Add a KeyPlayer / VA / team member to an existing tenant. Creates the Supabase
// auth user (or reuses an existing one), stamps their JWT tenant_id so they drop
// straight into THIS workspace on login, and inserts a workspace_members row.
//
// Run: node --env-file=.env.local scripts/add-member.mjs <email> [tenantId] [role]
//   tenantId defaults to HQ (fff35ccb-d1da-4fef-b8cb-e363fe1b8e14)
//   role defaults to 'va' (allowed: 'owner' | 'member' | 'va')
//
// NOTE: RBAC is currently V1-stubbed — every logged-in user is treated as full
// admin of whatever workspace their JWT resolves to. The role we save here is
// future-proofing; for now the member will have full edit rights in this tenant.

import { createClient } from '@supabase/supabase-js';
import postgres from 'postgres';
import { randomBytes } from 'node:crypto';

const HQ_TENANT = 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';

const [email, tenantId = HQ_TENANT, role = 'va'] = process.argv.slice(2);
if (!email) {
  console.error('usage: node scripts/add-member.mjs <email> [tenantId] [role]');
  process.exit(1);
}
for (const k of ['NEXT_PUBLIC_SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'SUPABASE_DB_URL']) {
  if (!process.env[k]) { console.error(`missing env ${k}`); process.exit(1); }
}

// Strong but typable temp password. The member can change it later from the app.
const password = 'Kp!' + randomBytes(9).toString('base64').replace(/[+/=]/g, '').slice(0, 11);

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

// 1) Auth user — create new (email pre-confirmed) or look up if already exists.
let userId;
{
  const { data, error } = await admin.auth.admin.createUser({
    email, password, email_confirm: true,
    app_metadata: { tenant_id: tenantId },
  });
  if (data?.user) {
    userId = data.user.id;
  } else if (error && /already (registered|exists)/i.test(error.message)) {
    // Look up the existing user, then ensure their JWT claim points at this tenant.
    const { data: list, error: listErr } = await admin.auth.admin.listUsers({ page: 1, perPage: 1000 });
    if (listErr) { console.error('listUsers failed:', listErr.message); process.exit(1); }
    const existing = list.users.find((u) => u.email?.toLowerCase() === email.toLowerCase());
    if (!existing) { console.error('user reported as existing but not found in list'); process.exit(1); }
    userId = existing.id;
    const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
      app_metadata: { ...(existing.app_metadata ?? {}), tenant_id: tenantId },
    });
    if (updErr) { console.error('updateUserById failed:', updErr.message); process.exit(1); }
    console.error('(user already existed — reused; password NOT reset)');
  } else {
    console.error('createUser failed:', error?.message);
    process.exit(1);
  }
}

// 2) Workspace membership (idempotent).
const sql = postgres(process.env.SUPABASE_DB_URL, { prepare: false });
try {
  await sql`
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (${tenantId}, ${userId}, ${role})
    ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role
  `;
} finally {
  await sql.end({ timeout: 1 });
}

console.log(JSON.stringify({
  ok: true,
  email,
  userId,
  tenantId,
  role,
  password,
  loginUrl: 'https://keyplayers-command-center-woad.vercel.app/login',
}, null, 2));
