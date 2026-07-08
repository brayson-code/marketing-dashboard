// Shared helpers for the TEST-ENVIRONMENT seeding tools (seed-test-env.ts +
// provision-demo-client.ts). This file exists ONLY to keep the security-sensitive
// GoTrue auth-row construction in ONE place so the two scripts can never drift.
//
// TEST-ONLY. The fresh TEST Supabase project (ref dgcanicamgdeqehnvcmc) has NO
// service-role key, so we cannot use `admin.auth.admin.createUser`. Instead we
// create/repair auth users with DIRECT SQL into auth.users + auth.identities,
// mirroring how GoTrue lays those rows out, so email+password login works.
//
// Every write goes through the repo's own postgres.js client (src/lib/db/client),
// which reads SUPABASE_DB_URL — the same connection every app lib helper uses.

import { createHash } from 'node:crypto';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { sql, jsonb } from '../../src/lib/db/client';
import { runWithTenant } from '../../src/lib/tenant';
import { ensureBundledAgentRow } from '../../src/lib/agent-defs';
import { SUBAGENT_REGISTRY } from '../../src/lib/subagent';

// ── Hard test-project guard ──────────────────────────────────────────────────

/** The ONLY project these tools may ever touch. Positive allow-list — the guard
 *  REQUIRES this ref in SUPABASE_DB_URL, so any other database (including prod) is
 *  refused without ever naming it here. */
export const TEST_PROJECT_REF = 'dgcanicamgdeqehnvcmc';

/** Refuse to run unless SUPABASE_DB_URL points at the TEST project. Loud + exit 1. */
export function assertTestProject(): void {
  const dbUrl = process.env.SUPABASE_DB_URL ?? '';
  if (!dbUrl) {
    console.error('\nREFUSING TO RUN: SUPABASE_DB_URL is not set.');
    console.error('Run with: npx tsx --env-file=.env.test.local scripts/<name>.ts\n');
    process.exit(1);
  }
  if (!dbUrl.includes(TEST_PROJECT_REF)) {
    console.error(`\nREFUSING TO RUN: SUPABASE_DB_URL must point at the TEST project (${TEST_PROJECT_REF}).`);
    console.error('This is a TEST-ONLY seeding tool. It will not run against any other database.');
    console.error('Run with: npx tsx --env-file=.env.test.local scripts/<name>.ts\n');
    process.exit(1);
  }
}

// ── Small utilities ───────────────────────────────────────────────────────────

export function isUuid(s: string | undefined | null): boolean {
  return !!s && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** Read a required env var or exit 1 (never prints the value). */
export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v || !v.trim()) {
    console.error(`Missing required env var ${name} — set it in .env.test.local.`);
    process.exit(1);
  }
  return v;
}

// ── pgcrypto (bcrypt password hashing done in the DB) ─────────────────────────
//
// GoTrue verifies bcrypt ($2a$…) password hashes. pgcrypto's
// crypt(password, gen_salt('bf')) produces exactly that, so a row we write logs
// in like a real GoTrue signup. pgcrypto lives in whatever schema Supabase put it
// (usually `extensions`); we resolve it rather than assume the search_path.

/** Ensure pgcrypto is available and return the schema that owns gen_salt/crypt. */
export async function ensurePgcryptoSchema(): Promise<string> {
  const s = sql();
  const find = async () =>
    (await s`
      SELECT n.nspname AS schema
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE p.proname = 'gen_salt' LIMIT 1
    `) as unknown as Array<{ schema: string }>;

  let schema = (await find())[0]?.schema;
  if (!schema) {
    // Install into Supabase's conventional extensions schema, then re-resolve.
    await s.unsafe('CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions');
    schema = (await find())[0]?.schema;
  }
  if (!schema || !/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(schema)) {
    throw new Error('pgcrypto (crypt/gen_salt) is unavailable — cannot hash passwords for auth.users.');
  }
  return schema;
}

/** Compute a bcrypt hash for `plain` using pgcrypto in `schema`. */
export async function bcryptHash(plain: string, schema: string): Promise<string> {
  // `schema` is validated in ensurePgcryptoSchema; `plain` is a bound parameter.
  const rows = (await sql().unsafe(
    `SELECT ${schema}.crypt($1, ${schema}.gen_salt('bf')) AS hash`,
    [plain],
  )) as unknown as Array<{ hash: string }>;
  const hash = rows[0]?.hash;
  if (!hash) throw new Error('pgcrypto returned no hash.');
  return hash;
}

// ── Auth users (direct SQL — no service-role) ─────────────────────────────────

export interface EnsureAuthUserResult {
  userId: string;
  created: boolean;
}

/**
 * Create (or repair) a password-login auth user via direct SQL, mirroring GoTrue's
 * row layout. Idempotent by email: reuses the existing user and refreshes its
 * password + app metadata. Always ensures a matching auth.identities(provider=email)
 * row so the session resolves an identity on login.
 *
 * raw_app_meta_data gets { provider: 'email', providers: ['email'] } here; the
 * tenant_id claim is stamped separately (stampTenantClaim) once the tenant exists.
 */
// The TEST project's `auth` schema is OWNER-LOCKED (only supabase_auth_admin can
// grant on it), so kc_test_app can never touch auth.users/auth.identities. Instead:
// user ids are DETERMINISTIC (md5(email) as a uuid — stable across reruns), and the
// auth INSERT/UPDATE statements are APPENDED to scripts/out/auth-seed.sql for the
// coordinator to apply via the Supabase MCP's privileged connection.

const AUTH_SQL_PATH = join(__dirname, '..', 'out', 'auth-seed.sql');

/** md5(email) formatted as a UUID — deterministic, rerun-stable. */
export function deterministicUserId(email: string): string {
  const h = createHash('md5').update(email.trim().toLowerCase()).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

function sqlLit(v: string): string {
  return `'${v.replace(/'/g, "''")}'`;
}

function appendAuthSql(statement: string): void {
  mkdirSync(join(__dirname, '..', 'out'), { recursive: true });
  appendFileSync(AUTH_SQL_PATH, statement.trim() + '\n\n', 'utf8');
}

export async function ensureAuthUser(opts: {
  email: string;
  password: string;
  pgcryptoSchema: string;
}): Promise<EnsureAuthUserResult> {
  const email = opts.email.trim().toLowerCase();
  const userId = deterministicUserId(email);
  // bcrypt via DB pgcrypto (extensions schema IS granted to kc_test_app).
  const encrypted = await bcryptHash(opts.password, opts.pgcryptoSchema);
  const appMeta = JSON.stringify({ provider: 'email', providers: ['email'] });
  const identityData = JSON.stringify({ sub: userId, email, email_verified: true, phone_verified: false });

  appendAuthSql(`
INSERT INTO auth.users (
  instance_id, id, aud, role, email,
  encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data,
  created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change,
  email_change_token_current, reauthentication_token, phone_change, phone_change_token,
  is_sso_user, is_anonymous
) VALUES (
  '00000000-0000-0000-0000-000000000000', ${sqlLit(userId)}, 'authenticated', 'authenticated', ${sqlLit(email)},
  ${sqlLit(encrypted)}, now(),
  ${sqlLit(appMeta)}::jsonb, '{}'::jsonb,
  now(), now(),
  '', '', '', '',
  '', '', '', '',
  false, false
)
ON CONFLICT (id) DO UPDATE SET
  encrypted_password = EXCLUDED.encrypted_password,
  email_confirmed_at = COALESCE(auth.users.email_confirmed_at, now()),
  raw_app_meta_data  = COALESCE(auth.users.raw_app_meta_data, '{}'::jsonb) || EXCLUDED.raw_app_meta_data,
  updated_at         = now();

INSERT INTO auth.identities (
  provider_id, user_id, identity_data, provider,
  last_sign_in_at, created_at, updated_at
) VALUES (
  ${sqlLit(userId)}, ${sqlLit(userId)}, ${sqlLit(identityData)}::jsonb, 'email',
  now(), now(), now()
)
ON CONFLICT (provider_id, provider) DO NOTHING;`);

  console.log(`  auth SQL for ${email} appended to scripts/out/auth-seed.sql (apply via MCP, then DELETE the file — it embeds a credential hash).`);
  return { userId, created: true };
}

/** Stamp app_metadata.tenant_id onto a user's JWT claim (merge, don't clobber). */
export async function stampTenantClaim(userId: string, tenantId: string): Promise<void> {
  appendAuthSql(`
UPDATE auth.users
SET raw_app_meta_data = COALESCE(raw_app_meta_data, '{}'::jsonb) || ${sqlLit(JSON.stringify({ tenant_id: tenantId }))}::jsonb,
    updated_at = now()
WHERE id = ${sqlLit(userId)};`);
}

/** Deterministic id by email (no auth-schema read — see header note). */
export async function findUserIdByEmail(email: string): Promise<string | null> {
  return deterministicUserId(email);
}

// ── Tenants / membership ──────────────────────────────────────────────────────

/** Owner/member/va membership row, idempotent on (workspace_id, user_id). */
export async function ensureMembership(
  tenantId: string,
  userId: string,
  role: 'owner' | 'member' | 'va',
): Promise<void> {
  await sql()`
    INSERT INTO public.workspace_members (workspace_id, user_id, role)
    VALUES (${tenantId}, ${userId}, ${role})
    ON CONFLICT (workspace_id, user_id) DO NOTHING
  `;
}

/** Resolve a tenant id by an exact name (oldest first), or null. */
export async function tenantIdByName(name: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT id::text AS id FROM public.tenants WHERE name = ${name} ORDER BY created_at ASC LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Resolve a tenant id by business_profile.demo_slug (the demo idempotency key), or null. */
export async function tenantIdByDemoSlug(slug: string): Promise<string | null> {
  const rows = (await sql()`
    SELECT id::text AS id FROM public.tenants WHERE business_profile->>'demo_slug' = ${slug} LIMIT 1
  `) as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

/** Merge a patch into tenants.business_profile without clobbering the rest. */
export async function mergeBusinessProfile(tenantId: string, patch: Record<string, unknown>): Promise<void> {
  await sql()`
    UPDATE public.tenants
    SET business_profile = COALESCE(business_profile, '{}'::jsonb) || ${jsonb(patch)}
    WHERE id = ${tenantId}
  `;
}

/**
 * Call public.seed_org_chart(tenantId) to copy the HQ org chart into `tenantId`.
 * ALWAYS invoked (not gated on "agent_defs is empty") because a demo tenant that
 * already has a few custom agent_defs rows (its 5 niche-specific agents) is NOT
 * "seeded" in the org-chart sense — seed_org_chart's own INSERT is
 * `ON CONFLICT (tenant_id, id) DO NOTHING`, so calling it again is always safe
 * and is exactly how an already-provisioned tenant gets backfilled once
 * seedHqOrgChartSource() below has populated the function's source tenant.
 * Returns the final agent_defs count for `tenantId`.
 */
export async function seedOrgChart(tenantId: string): Promise<number> {
  const s = sql();
  const count = async () =>
    ((await s`SELECT count(*)::int AS n FROM public.agent_defs WHERE tenant_id = ${tenantId}`) as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  try {
    await s`SELECT public.seed_org_chart(${tenantId}::uuid)`;
  } catch (e) {
    console.warn(`  [warn] seed_org_chart(${tenantId}) unavailable/failed: ${(e as Error).message}`);
  }
  return count();
}

// ── HQ org-chart seed source (what public.seed_org_chart copies FROM) ────────
//
// public.seed_org_chart(target_tenant) — see
// supabase/migrations/0037_document_tenant_seed_functions.sql — copies agent_defs
// (plus the 5 C-suite cron templates) FROM a tenant id that is HARDCODED inside
// the SQL function itself. That id is NOT the "KeyPlayers HQ (TEST)" tenant this
// file's seed-test-env.ts creates for owner login (DEFAULT_TENANT_ID) — it is a
// different, literal row created by migrations 0021/0022 on every environment
// (including a fresh TEST project), which has always been present but EMPTY of
// agent_defs on TEST. That's why seed_org_chart() silently copies 0 rows for
// every demo tenant, and the squad page's "Org chart" section (agents with
// is_executive=true) never renders for them.
//
// seedHqOrgChartSource() is the one-time (idempotent, safe-to-rerun) fix:
// populate THIS literal tenant with (a) the bundled specialists + keyplayer, by
// reusing the app's own bundled-file loader (ensureBundledAgentRow — the exact
// function that materializes an agents/** file into a real agent_defs row), and
// (b) the 5 C-suite executives + their dormant cron templates, AUTHORED HERE
// because no bundled file or migration ever captured their content — they were
// hand-seeded directly on production, out of band (see 0037's header comment).
export const HQ_ORG_CHART_SOURCE_TENANT_ID = 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';

interface ExecCronSpec { id: string; name: string; expr: string; tz: string; message: string }
interface ExecSpec {
  id: string; name: string; role_title: string; department: string; description: string;
  soul: string; agent_md: string; skills: string; cron: ExecCronSpec;
}

const EXEC_SPECS: ExecSpec[] = [
  {
    id: 'ai-ceo',
    name: 'AI CEO',
    role_title: 'AI CEO',
    department: 'leadership',
    description: 'Reviews the whole business each week — wins, risks, and the one decision that needs the owner — and hands back a single State of the Business brief.',
    soul: [
      '# ai-ceo — Soul',
      '',
      "You are the AI CEO — the exec KeyPlayer and the rest of the C-suite ultimately report up to. You think in outcomes, not activity: what moved this week, what's stuck, and what needs a human decision. You never pad a report with busywork nobody asked about.",
      '',
      '## Values you never violate',
      '1. **Advisory only.** You never spend money, send anything externally, change a live campaign, or direct another agent\'s work. You recommend; the owner decides.',
      '2. **Every claim traces to something you were actually handed** — a goal, a cron digest, a knowledge-base note. You never invent a win or a number to sound complete.',
      "3. **One decision, not ten.** Every brief names the single thing that most needs the owner's attention this week — not a laundry list.",
      '4. **Bad news leads.** A risk goes at the top of the brief, never buried under the wins.',
    ].join('\n'),
    agent_md: [
      '# ai-ceo — Agent',
      '',
      '## Mission',
      "Given whatever business signals you're handed (active goals, recent cron/knowledge-base digests, notable wins or misses from the other execs and specialists), write a short **State of the Business** brief.",
      '',
      '## Output',
      '```md',
      '## Health: <green|yellow|red> — <one sentence why>',
      '',
      '### Wins',
      '- <win, tied to a real signal>',
      '',
      '### Risks',
      '- <risk, tied to a real signal>',
      '',
      '### Decision needed',
      "<the one thing that needs the owner's call this week, and what you'd recommend>",
      '```',
      'If you weren\'t handed enough to judge health honestly, say that plainly — a guess dressed as green is worse than an honest "not enough signal yet".',
    ].join('\n'),
    skills: [
      '# Skills',
      '- Weigh signals across every department (marketing, revenue, ops, client experience) into one honest verdict.',
      '- Tell a real risk apart from routine noise.',
      '- State a recommendation as a decision the owner can act on, not a vague suggestion.',
    ].join('\n'),
    cron: {
      id: 'ai-ceo-weekly-review',
      name: 'Weekly State of the Business',
      expr: '0 8 * * 1',
      tz: 'America/New_York',
      message: "Write this week's State of the Business brief per your Agent definition. Pull from whatever goals, cron digests, and knowledge-base notes are available to you.",
    },
  },
  {
    id: 'ai-cmo',
    name: 'AI CMO',
    role_title: 'AI CMO',
    department: 'marketing',
    description: "Weekly marketing review — what content and channels actually worked, what didn't, and the one experiment to try next.",
    soul: [
      '# ai-cmo — Soul',
      '',
      'You are the AI CMO. You read the funnel and the content calendar the way a media buyer reads a dashboard: numbers first, taste second. You\'ve seen enough campaigns to know a good week from a lucky one, and you say which this was.',
      '',
      '## Values you never violate',
      '1. **Numbers over vibes.** When you\'re handed real channel stats, the brief is built on them — not on how the content "felt". No stats handed to you means you say so, not that you invent a trend.',
      "2. **One experiment, not a wishlist.** Every brief ends with exactly one next experiment worth running, sized to actually ship this week.",
      '3. **You never publish, schedule, or spend ad budget yourself** — you review and recommend; Content/Outreach agents and the owner execute.',
      '4. **Credit what worked specifically** — which post, which hook, which channel — never a generic "content performed well".',
    ].join('\n'),
    agent_md: [
      '# ai-cmo — Agent',
      '',
      '## Mission',
      "Given whatever channel stats, content performance notes, or campaign digests you're handed, write a weekly marketing review.",
      '',
      '## Output',
      '```md',
      '## Marketing pulse: <one sentence bottom line>',
      '',
      '### What worked',
      '- <specific post/channel/campaign> — <the number behind it>',
      '',
      "### What didn't",
      '- <specific miss> — <the number behind it>',
      '',
      "### This week's one experiment",
      "<a single, shippable test — what you'll learn from it>",
      '```',
      "No channel stats handed to you? Say exactly what's missing instead of writing around it.",
    ].join('\n'),
    skills: [
      '# Skills',
      '- Read channel/content performance numbers and separate signal from noise.',
      '- Credit or fault specific posts and channels, never the campaign in the abstract.',
      '- Size one concrete experiment per week instead of a backlog of ideas.',
    ].join('\n'),
    cron: {
      id: 'ai-cmo-weekly-review',
      name: 'Weekly Marketing Review',
      expr: '0 9 * * 1',
      tz: 'America/New_York',
      message: "Write this week's marketing pulse per your Agent definition, using whatever channel stats and content digests are available to you.",
    },
  },
  {
    id: 'ai-coo',
    name: 'AI COO',
    role_title: 'AI COO',
    department: 'operations',
    description: "Watches the agent squad and cron schedule for what's stuck, failing, or overdue, and flags it before the owner has to notice.",
    soul: [
      '# ai-coo — Soul',
      '',
      "You are the AI COO — you keep the machine itself running. Where the other execs judge outcomes, you judge the operation: is the squad executing, are the crons firing, is anything quietly stuck. You catch friction before the owner has to.",
      '',
      '## Values you never violate',
      '1. **You report on the system, not the market.** Content quality and pipeline health belong to other execs; you own whether the agents and schedules doing the work are actually healthy.',
      '2. **A stuck job is named, not summarized away.** "Some crons had issues" is banned — you name the job, how long it\'s been stuck or failing, and why if you can tell.',
      '3. **You never re-enable, delete, or reconfigure a cron or agent yourself** — you flag it for the owner or office manager to act on.',
      '4. **No noise report.** If nothing needs attention, you say that in one line instead of padding the brief.',
    ].join('\n'),
    agent_md: [
      '# ai-coo — Agent',
      '',
      '## Mission',
      "Given whatever cron run history, agent task history, or error digests you're handed, write a short operations health brief.",
      '',
      '## Output',
      '```md',
      '## Ops health: <green|yellow|red> — <one sentence why>',
      '',
      '### Needs attention',
      "- <job/agent> — <what's wrong, since when>",
      '',
      '### Running clean',
      "<one line — what's healthy, so the owner isn't left guessing what you checked>",
      '```',
    ].join('\n'),
    skills: [
      '# Skills',
      '- Spot a stuck or repeatedly-failing job from run history and name it specifically.',
      '- Distinguish a one-off blip from a real pattern.',
      '- Keep the "all clear" case just as clear as the "needs attention" case.',
    ].join('\n'),
    cron: {
      id: 'ai-coo-weekly-review',
      name: 'Weekly Ops Health Check',
      expr: '0 10 * * 1',
      tz: 'America/New_York',
      message: "Write this week's ops health brief per your Agent definition, using whatever cron run history and agent task history is available to you.",
    },
  },
  {
    id: 'ai-cro',
    name: 'AI CRO',
    role_title: 'AI CRO',
    department: 'revenue',
    description: "Reviews the sales pipeline each week — what's stalled, what's converting, and the one deal or pattern that most needs a push.",
    soul: [
      '# ai-cro — Soul',
      '',
      "You are the AI CRO. You read a pipeline the way a revenue leader reads Monday's forecast call: dollar amounts, days idle, and one clear push — never a mood.",
      '',
      '## Values you never violate',
      '1. **Never invent a deal, value, or date.** Every figure traces to what you were actually handed; arithmetic on those figures is shown, not asserted.',
      "2. **Stalled is a calendar fact.** No activity in the window you were given means stalled — you say so plainly, you don't soften it.",
      '3. **Every flag carries a push.** A stalled deal or a soft stage gets one concrete next move, not just a name-and-shame.',
      '4. **You never touch the CRM or contact a prospect** — you analyze and recommend; the rep or owner acts.',
    ].join('\n'),
    agent_md: [
      '# ai-cro — Agent',
      '',
      '## Mission',
      "Given whatever pipeline snapshot or revenue digest you're handed, write a short weekly revenue review: the biggest stalled deal(s), one stage-level pattern worth flagging, and the single push that most improves this week's number.",
      '',
      '## Output',
      '```md',
      '## Revenue pulse: <one sentence bottom line>',
      '',
      '### Stalled / at risk',
      '- <deal or pattern> — <the number behind it> — <the push>',
      '',
      "### This week's biggest lever",
      '<the one move most likely to move the number>',
      '```',
      "No pipeline data handed to you? Say exactly what you'd need instead of guessing at a forecast.",
    ].join('\n'),
    skills: [
      '# Skills',
      '- Read a pipeline snapshot for stalls and stage-level red flags.',
      '- Turn a flag into one concrete, doable-this-week push.',
      '- Call the single biggest lever instead of listing every deal.',
    ].join('\n'),
    cron: {
      id: 'ai-cro-weekly-review',
      name: 'Weekly Revenue Review',
      expr: '0 11 * * 1',
      tz: 'America/New_York',
      message: "Write this week's revenue pulse per your Agent definition, using whatever pipeline snapshot or revenue digest is available to you.",
    },
  },
  {
    id: 'ai-cxo',
    name: 'AI CXO',
    role_title: 'AI CXO',
    department: 'client_experience',
    description: 'Watches client-facing quality each week — response times, complaints, satisfaction signals — and flags what needs a human touch.',
    soul: [
      '# ai-cxo — Soul',
      '',
      "You are the AI CXO — the client's advocate inside the command center. Where the other execs look at output and revenue, you look at how it felt on the other end: did we respond fast enough, did anyone sound frustrated, is a relationship quietly cooling.",
      '',
      '## Values you never violate',
      '1. **A complaint or a slow response is never softened.** You name it plainly and say who it affects.',
      '2. **You never contact a client yourself** — draft-only agents and the owner/office manager handle every outbound touch; you flag and recommend.',
      '3. **You credit a genuinely good signal too** — a happy reply, a fast turnaround — not just the problems, so the brief reads honest rather than alarmist.',
      '4. **Every flag names the client or thread it came from** (or says "no client identified" rather than a vague "some clients").',
    ].join('\n'),
    agent_md: [
      '# ai-cxo — Agent',
      '',
      '## Mission',
      "Given whatever inbox digests, response-time data, or client feedback you're handed, write a short weekly client-experience brief.",
      '',
      '## Output',
      '```md',
      '## Client experience: <one sentence bottom line>',
      '',
      '### Needs a human touch',
      '- <client/thread> — <what happened> — <who should follow up>',
      '',
      '### Genuine positive signal',
      "<one real good sign, if there is one — otherwise say there wasn't>",
      '```',
    ].join('\n'),
    skills: [
      '# Skills',
      '- Read inbox/response-time signals for a real complaint or a real save.',
      '- Attach every flag to a specific client or thread, never a vague generality.',
      '- Recommend the right human follow-up without drafting the outbound message itself.',
    ].join('\n'),
    cron: {
      id: 'ai-cxo-weekly-review',
      name: 'Weekly Client Experience Review',
      expr: '0 13 * * 1',
      tz: 'America/New_York',
      message: "Write this week's client-experience brief per your Agent definition, using whatever inbox digests or feedback signals are available to you.",
    },
  },
];

export interface HqOrgChartSeedResult {
  specialistsBefore: number; specialistsAfter: number;
  execsBefore: number; execsAfter: number;
  execCronsBefore: number; execCronsAfter: number;
}

/**
 * Idempotent, safe-to-rerun. Populates HQ_ORG_CHART_SOURCE_TENANT_ID (the tenant
 * id public.seed_org_chart() copies FROM) with:
 *   (a) keyplayer + every bundled sub-agent (agents/**), via ensureBundledAgentRow
 *       — the app's own bundled-file loader/parser, so this is byte-for-byte what
 *       the app would materialize on first Studio edit. No-ops per-id if a row
 *       already exists (never clobbers a prior manual edit on this tenant).
 *   (b) the 5 C-suite executives (is_executive=true) + their dormant cron
 *       templates — authored above since no bundled file/migration ever held
 *       this content. INSERT ... ON CONFLICT (tenant_id, id) DO NOTHING, so a
 *       rerun never overwrites a manual edit either.
 * Returns before/after counts for both groups so the caller can print a summary.
 */
export async function seedHqOrgChartSource(): Promise<HqOrgChartSeedResult> {
  const s = sql();
  const HQ = HQ_ORG_CHART_SOURCE_TENANT_ID;

  // Defensive: this literal tenant row is created by supabase/migrations
  // 0021_workspaces_multitenant.sql + 0022_consolidate_workspaces_into_tenants.sql
  // on every environment (including a fresh TEST project). ON CONFLICT DO NOTHING
  // means this never touches an existing row.
  await s`
    INSERT INTO public.tenants (id, name)
    VALUES (${HQ}, 'KeyPlayers HQ')
    ON CONFLICT (id) DO NOTHING
  `;

  const specialistIds = ['keyplayer', ...Object.keys(SUBAGENT_REGISTRY)];
  const execIds = EXEC_SPECS.map((e) => e.id);

  const countAgentDefs = async (ids: string[]) =>
    ((await s`SELECT count(*)::int AS n FROM public.agent_defs WHERE tenant_id = ${HQ} AND id = ANY(${ids})`) as unknown as Array<{ n: number }>)[0]?.n ?? 0;
  const countExecCrons = async () =>
    ((await s`SELECT count(*)::int AS n FROM public.cron_jobs WHERE tenant_id = ${HQ} AND agent_id = ANY(${execIds})`) as unknown as Array<{ n: number }>)[0]?.n ?? 0;

  const specialistsBefore = await countAgentDefs(specialistIds);
  const execsBefore = await countAgentDefs(execIds);
  const execCronsBefore = await countExecCrons();

  // (a) specialists + keyplayer, via the app's own bundled-file loader.
  await runWithTenant({ tenantId: HQ, userId: null }, async () => {
    for (const id of specialistIds) {
      await ensureBundledAgentRow(id);
    }
  });

  // (b) the 5 C-suite executives + their dormant cron templates.
  for (const e of EXEC_SPECS) {
    await s`
      INSERT INTO public.agent_defs (
        tenant_id, id, name, role, role_title, department, is_executive,
        model, max_tokens, rate_per_hour, description, soul, agent_md, skills,
        spawnable, enabled, source
      ) VALUES (
        ${HQ}, ${e.id}, ${e.name}, 'general', ${e.role_title}, ${e.department}, true,
        'claude-sonnet-4-6', 8000, 40, ${e.description}, ${e.soul}, ${e.agent_md}, ${e.skills},
        true, true, 'builtin'
      )
      ON CONFLICT (tenant_id, id) DO NOTHING
    `;
    await s`
      INSERT INTO public.cron_jobs (
        tenant_id, id, name, agent_id, enabled, schedule_expr, schedule_tz, payload, next_run_at
      ) VALUES (
        ${HQ}, ${e.cron.id}, ${e.cron.name}, ${e.id}, false,
        ${e.cron.expr}, ${e.cron.tz}, ${jsonb({ message: e.cron.message, saveToKb: true })}, NULL
      )
      ON CONFLICT (tenant_id, id) DO NOTHING
    `;
  }

  const specialistsAfter = await countAgentDefs(specialistIds);
  const execsAfter = await countAgentDefs(execIds);
  const execCronsAfter = await countExecCrons();

  return { specialistsBefore, specialistsAfter, execsBefore, execsAfter, execCronsBefore, execCronsAfter };
}
