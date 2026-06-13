// Per-tenant daily token budget — a REAL, enforced spend gate.
//
// WHY THIS EXISTS
// The usage page already shows a daily/weekly token bar (src/lib/usage.ts), but
// those limits are display-only — nothing stops a runaway agent loop from
// burning the tenant's BYO Anthropic key all day. This module turns the budget
// into an enforced gate that runs AT THE SPAWN BOUNDARY: before a new sub-agent
// or wave-synthesis call starts. Anything already in flight always finishes
// (bounded by maxTurns * maxTokens); only NEW work is held. That is THE
// guarantee that "runs don't fail mid-way" — we never interrupt a generation.
//
// STORAGE
// The cap lives in tenants.business_profile.usage_cap (jsonb), mirroring the
// autonomy.ts get/set pattern, so there's no migration. Shape:
//   business_profile.usage_cap = { enabled: boolean, daily_tokens: number }
// A soft-warn dedup marker also lives in business_profile.usage_cap_warned_on
// (a 'YYYY-MM-DD' UTC date string) so the 80%-warning notification fires at most
// once per UTC day.
//
// KILL SWITCH (documented in full in the PR's rollback notes)
//   1. GLOBAL, instant, no redeploy: set env USAGE_CAP_ENFORCE=false. When this
//      is 'false' the gate is a hard no-op for EVERY tenant — behavior is
//      byte-identical to before this module existed. Default (unset or anything
//      other than the exact string 'false') = enforcement ON.
//   2. PER-TENANT opt-in: cap.enabled defaults to FALSE. A freshly-provisioned
//      tenant — or any tenant that has never configured a cap — is NOT enforced.
//      An owner must explicitly flip enabled=true (via the Settings/usage UI) to
//      arm the gate for their workspace. This is the safe default: shipping this
//      module changes NOTHING until an owner opts in.
// Net effect: nothing is enforced today; the global env is the panic button.

import { sql, jsonb, tenantId } from './db/client';
import { createNotification } from './notifications';

/** Default daily token budget when an opted-in tenant hasn't set a number.
 *
 * Sizing math (from the sub-agent registry): a busy multi-agent day is roughly
 * ~20 sub-agent spawns, each capped at a few thousand maxTokens (registry
 * defaults run 1k–6k output) across several tool-loop turns (default maxTurns=8,
 * each turn re-bills the cached prompt prefix + new output). A generous upper
 * bound for legitimate activity is therefore on the order of:
 *   20 spawns × ~6 turns × ~(input+output) ≈ low hundreds of thousands of tokens.
 * We set the default an order of magnitude above that — 2,000,000 tokens/day —
 * so a normal heavy day never trips it, but a stuck loop re-spawning the same
 * agent thousands of times (which is exactly the failure we're guarding against)
 * blows past it within the day and gets held. This mirrors usage.ts's existing
 * DEFAULT_DAILY_LIMIT so the enforced cap and the display bar agree by default. */
export const DEFAULT_DAILY_TOKENS = 2_000_000;

/** Fraction of the cap at which we fire a single soft-warn notification. */
export const WARN_FRACTION = 0.8;

export interface UsageCap {
  enabled: boolean;
  daily_tokens: number;
}

/** Detail carried by BudgetExceededError so callers can degrade with context.
 *  Shaped like AutonomyBlockedError (a typed, caught "blocked" sentinel). */
export interface BudgetExceededDetail {
  tenantId: string;
  usedToday: number;
  cap: number;
  remaining: number; // max(0, cap - usedToday)
}

/** Sentinel thrown by the synthesis path (and carried on a blocked SpawnResult)
 *  when an opted-in tenant has hit its daily token budget. Callers CATCH this
 *  and pause/skip — they must NOT surface it as a raw crash or mark work 'error'. */
export class BudgetExceededError extends Error {
  code = 'BUDGET_EXCEEDED' as const;
  tenantId: string;
  usedToday: number;
  cap: number;
  remaining: number;
  constructor(detail: BudgetExceededDetail) {
    super(
      `Daily token budget reached for tenant ${detail.tenantId}: ` +
        `${detail.usedToday.toLocaleString()} / ${detail.cap.toLocaleString()} tokens used. ` +
        `New agent work is paused until the cap resets (next UTC day) or is raised.`,
    );
    this.name = 'BudgetExceededError';
    this.tenantId = detail.tenantId;
    this.usedToday = detail.usedToday;
    this.cap = detail.cap;
    this.remaining = detail.remaining;
  }
}

/** Is the global env kill switch leaving enforcement ON?
 *  Default ON: only the exact string 'false' disables it. */
export function envEnforcementOn(): boolean {
  return process.env.USAGE_CAP_ENFORCE !== 'false';
}

/**
 * PURE decision helper (no DB, no env) — the single source of truth for "should
 * this spawn be blocked?". Factored out so the math is unit-testable without a
 * live database. `estimated` lets a caller reserve headroom for the call it's
 * about to make; we block when the projected post-call total would meet/exceed
 * the cap. With estimated=0 this is a plain "already at/over the cap?" check.
 *
 * Returns true (BLOCK) only when BOTH switches are on AND we're at/over budget.
 */
export function isOverBudget(
  used: number,
  cap: number,
  enabled: boolean,
  envOn: boolean,
  estimated = 0,
): boolean {
  if (!envOn) return false;        // global kill switch off → never block
  if (!enabled) return false;      // tenant not opted in → never block
  if (!(cap > 0)) return false;    // no positive cap configured → never block
  return used + Math.max(0, estimated) >= cap;
}

/** Should we fire the 80% soft-warn? Pure so the boundary is testable.
 *  Warns once we cross WARN_FRACTION of the cap but are not yet AT the cap
 *  (at/over the cap we block instead, which is its own signal). */
export function shouldWarn(used: number, cap: number, enabled: boolean): boolean {
  if (!enabled) return false;
  if (!(cap > 0)) return false;
  return used >= cap * WARN_FRACTION && used < cap;
}

function coerceCap(raw: unknown): UsageCap {
  const o = (raw && typeof raw === 'object') ? raw as Record<string, unknown> : {};
  const enabled = o.enabled === true; // default FALSE (opt-in)
  const n = Number(o.daily_tokens);
  const daily_tokens = Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_TOKENS;
  return { enabled, daily_tokens };
}

/** Read the active tenant's cap from tenants.business_profile.
 *  Defaults to { enabled: false, daily_tokens: DEFAULT_DAILY_TOKENS } — i.e. the
 *  gate is inert until an owner opts in. */
export async function getUsageCap(): Promise<UsageCap> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = rows[0]?.business_profile ?? {};
  return coerceCap((bp as Record<string, unknown>).usage_cap);
}

/** Patch the cap without clobbering the rest of business_profile (read-modify-write,
 *  same shape as setAutonomyConfig). Returns the persisted cap. */
export async function setUsageCap(patch: Partial<UsageCap>): Promise<UsageCap> {
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = { ...(rows[0]?.business_profile ?? {}) } as Record<string, unknown>;
  const current = coerceCap(bp.usage_cap);
  const next: UsageCap = {
    enabled: patch.enabled !== undefined ? patch.enabled === true : current.enabled,
    daily_tokens:
      patch.daily_tokens !== undefined && Number.isFinite(Number(patch.daily_tokens)) && Number(patch.daily_tokens) > 0
        ? Number(patch.daily_tokens)
        : current.daily_tokens,
  };
  bp.usage_cap = next;
  await sql()`
    UPDATE public.tenants SET business_profile = ${jsonb(bp)} WHERE id = ${tenantId()}
  `;
  return next;
}

/** UTC start-of-day ISO cutoff, matching usage.ts's UTC day-window logic
 *  (it buckets by `new Date(started_at).toISOString().slice(0,10)`). */
function startOfUtcDayIso(): string {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d.toISOString();
}

/** SUM(input_tokens + output_tokens) for the active tenant since UTC midnight.
 *  Cheap + indexed: agent_tasks has idx_agent_tasks_status(tenant_id, status,
 *  started_at). We count completed work (done|error) — the same statuses
 *  usage.ts aggregates — because in-flight rows haven't recorded their tokens
 *  yet (finishTask writes them on completion). */
export async function getTodayTokenUsage(): Promise<number> {
  const rows = (await sql()`
    SELECT COALESCE(SUM(COALESCE(input_tokens, 0) + COALESCE(output_tokens, 0)), 0) AS total
    FROM public.agent_tasks
    WHERE tenant_id = ${tenantId()}
      AND started_at >= ${startOfUtcDayIso()}
      AND status IN ('done', 'error')
  `) as unknown as Array<{ total: number | string | null }>;
  return Number(rows[0]?.total ?? 0);
}

/**
 * THE GATE. Call this BEFORE starting any new Anthropic-spending work
 * (sub-agent spawn, wave synthesis). Behavior:
 *   - enforcement OFF (env 'false' OR tenant cap.enabled=false OR no positive
 *     cap) → returns immediately, a hard no-op (today's behavior).
 *   - enforcement ON and at/over the cap → throws BudgetExceededError.
 * Never interrupts work already in flight; only holds NEW work.
 *
 * Also fires a single best-effort 80%-of-cap soft-warn notification per UTC day
 * (deduped via business_profile.usage_cap_warned_on). The warn path never throws.
 *
 * @param estimatedTokens optional headroom to reserve for the call about to run.
 */
export async function assertWithinBudget(estimatedTokens = 0): Promise<void> {
  const envOn = envEnforcementOn();
  if (!envOn) return; // global kill switch → no-op, no DB hit

  // FAIL-OPEN on read errors. This path runs on EVERY spawn (the shipped default
  // is env-on + every tenant opted-out), so a transient failure of these
  // monitoring reads must never crash a spawn that would otherwise succeed — a
  // budget *gauge* going dark is not a reason to block work. Only a positively
  // confirmed over-budget state throws. (BudgetExceededError is rethrown, not
  // swallowed, so the gate still fires when it should.)
  let cap: UsageCap;
  let used: number;
  try {
    cap = await getUsageCap();
    if (!cap.enabled || !(cap.daily_tokens > 0)) return; // tenant not opted in → no-op
    used = await getTodayTokenUsage();
  } catch (e) {
    console.warn('[usage-cap] budget read failed — failing open (allowing spawn):', (e as Error)?.message);
    return;
  }

  // Soft-warn at 80% (best-effort, deduped, never throws).
  if (shouldWarn(used, cap.daily_tokens, cap.enabled)) {
    await maybeWarn(used, cap.daily_tokens).catch(() => {});
  }

  if (isOverBudget(used, cap.daily_tokens, cap.enabled, envOn, estimatedTokens)) {
    const remaining = Math.max(0, cap.daily_tokens - used);
    throw new BudgetExceededError({
      tenantId: tenantId(),
      usedToday: used,
      cap: cap.daily_tokens,
      remaining,
    });
  }
}

/** Fire the 80% notification at most once per UTC day. Dedup marker is a date
 *  string in business_profile.usage_cap_warned_on. Best-effort throughout. */
async function maybeWarn(used: number, cap: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const rows = (await sql()`
    SELECT business_profile FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
  `) as unknown as Array<{ business_profile: Record<string, unknown> | null }>;
  const bp = { ...(rows[0]?.business_profile ?? {}) } as Record<string, unknown>;
  if (bp.usage_cap_warned_on === today) return; // already warned today

  bp.usage_cap_warned_on = today;
  await sql()`
    UPDATE public.tenants SET business_profile = ${jsonb(bp)} WHERE id = ${tenantId()}
  `;

  const pct = Math.round((used / cap) * 100);
  await createNotification({
    type: 'usage_cap_warning',
    severity: 'warning',
    title: 'Daily token budget at ' + pct + '%',
    message:
      `Agents have used ${used.toLocaleString()} of your ${cap.toLocaleString()}-token ` +
      `daily budget (${pct}%). New agent work will pause if the cap is reached. ` +
      `Raise the cap in Settings if this is expected.`,
    data: { used, cap, pct },
  });
}
