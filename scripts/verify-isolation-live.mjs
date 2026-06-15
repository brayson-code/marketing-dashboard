// Live end-to-end tenant-isolation check against the deployed app.
// Signs in as the test client, lets @supabase/ssr produce the exact auth cookies,
// then replays them against production API routes and asserts the response is the
// client's OWN (empty) workspace — not HQ's data.
//
// Run: node --env-file=.env.local scripts/verify-isolation-live.mjs

import { createClient } from '@supabase/supabase-js';
import { createServerClient } from '@supabase/ssr';

const BASE = process.env.VERIFY_BASE_URL || 'https://command.keyplayershq.com';
const EMAIL = process.env.VERIFY_EMAIL || 'braysonlenderman@gmail.com';
const PASSWORD = process.env.VERIFY_PASSWORD || 'Kp!Test-9m4Qz2';

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!url || !anon) { console.error('Missing NEXT_PUBLIC_SUPABASE_URL / ANON_KEY'); process.exit(1); }

// 1) Sign in to get a real session.
const sb = createClient(url, anon, { auth: { persistSession: false } });
const { data: signIn, error: signErr } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD });
if (signErr || !signIn.session) { console.error('sign-in failed:', signErr?.message); process.exit(1); }
const { access_token, refresh_token } = signIn.session;

// 2) Re-create the cookies exactly as @supabase/ssr would write them server-side.
const jar = new Map();
const ssr = createServerClient(url, anon, {
  cookies: {
    getAll() { return [...jar.entries()].map(([name, value]) => ({ name, value })); },
    setAll(toSet) { toSet.forEach(({ name, value }) => jar.set(name, value)); },
  },
});
await ssr.auth.setSession({ access_token, refresh_token });
const cookieHeader = [...jar.entries()].map(([n, v]) => `${n}=${encodeURIComponent(v)}`).join('; ');
console.log(`signed in as ${EMAIL}; ${jar.size} auth cookie(s) built`);

// 3) Hit production routes with those cookies.
async function get(path) {
  const r = await fetch(`${BASE}${path}`, { headers: { cookie: cookieHeader }, redirect: 'manual' });
  let body;
  try { body = await r.json(); } catch { body = await r.text(); }
  return { status: r.status, body };
}

const onboarding = await get('/api/onboarding');
const drafts = await get('/api/drafts');

console.log('\n/api/onboarding →', onboarding.status, JSON.stringify(onboarding.body));
const draftCount = Array.isArray(drafts.body) ? drafts.body.length
  : Array.isArray(drafts.body?.drafts) ? drafts.body.drafts.length : `(shape: ${JSON.stringify(drafts.body).slice(0,120)})`;
console.log('/api/drafts     →', drafts.status, `count=${draftCount}`);

// 4) Assertions: authenticated (200), own workspace (onboarding incomplete), isolated (0 drafts).
const ok =
  onboarding.status === 200 &&
  onboarding.body?.onboarding_complete === false &&
  (draftCount === 0);
console.log(`\nRESULT: ${ok ? 'PASS ✅ — new user sees their OWN empty workspace (wizard will show, HQ data isolated)'
  : 'FAIL ❌ — see output above'}`);
process.exit(ok ? 0 : 1);
