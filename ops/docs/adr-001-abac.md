# ADR-001: Attribute-Based Access Control (ABAC) for the Command Center

- **Status:** Proposed
- **Date:** 2026-06-18
- **Deciders:** Brayson (founder)
- **Supersedes:** the `role:'admin'` stub in `/api/auth/me` and the no-op `requireApi*` helpers in `src/lib/api-auth.ts`
- **Does NOT touch:** tenant isolation (`tenantId()` query scoping), RLS, or `resolveTenant()` fail-closed behavior

---

## 1. Context / Problem

The Command Center is a multi-tenant marketing SaaS (Next.js 16 App Router, Supabase Postgres + Auth + RLS, Vercel). Today's auth posture, **verified against the code**:

- **AuthN is solid.** The middleware (`src/lib/supabase/middleware.ts`) calls `getUser()` (revalidates the JWT server-side), strips any inbound `x-tenant-id`/`x-user-id`, and re-injects them from the validated session. `resolveTenant()` (`src/lib/with-tenant.ts`) reads those headers, falls back to the user's `workspace_members` row (source of truth), and is fail-closed (`NO_TENANT_ID`, never HQ). Every handler starts with `enterTenant(await resolveTenant())` (AsyncLocalStorage context in `src/lib/tenant.ts`).
- **Tenant isolation is the real security boundary.** The backend connects as the `postgres` role, which **bypasses RLS** (`src/lib/db/client.ts`). The only thing isolating one workspace from another is that every `sql()` query filters `tenant_id = ${tenantId()}`. RLS (`tenant_id in (select public.current_user_tenant_ids())`, migrations 0029/0036) is a defense-in-depth backstop for the browser/anon path.
- **AuthZ is a STUB.** `/api/auth/me` hardcodes `role:'admin'` for the authenticated owner ("V1 single-tenant: owner treated as admin"). `src/lib/api-auth.ts` `requireApiUser/Admin/Editor/Capability` all `return null` (allow-all). The only live authorization primitive beyond tenant isolation is `requireHq()`/`isHqTenant()` (`src/lib/hq-guard.ts`), which gates the HQ-only Issues/Fixer surface via `tenantId() === DEFAULT_TENANT_ID`.
- `src/lib/rbac.ts` already defines a `Role` (`admin|editor|viewer`) → `Capability` matrix, but **nothing enforces it** — it's dead config waiting for a consumer.

**The goal:** replace the admin stub with a real **ABAC** system — decisions derived from attributes of the **subject** (user), **resource** (the row/entity), **action**, and **environment**, evaluated by policies — that **composes with, never replaces,** tenant isolation and RLS, is **teams-ready**, and is **migratable without breaking current single-owner flows**.

**The constraint that dominates the design:** at the current scale every production workspace is single-owner. A bad authorization rollout must NOT be able to leak data; the worst acceptable failure is "someone is wrongly blocked" (loud, reversible) — never "data leaked" (silent, catastrophic).

---

## 2. Decision

**Adopt the "minimal pragmatic ABAC" base** (judge total **49 / 54**, the highest scored candidate: security 9, fit 9, simplicity 8, migrationCost 7, teamReadiness 8, performance 8) — a single typed, synchronous, in-process guard:

```
authorize(subject, action, resource, env): Decision   // { allow:true } | { allow:false, reason }
```

called **per handler**, **after** `enterTenant(await resolveTenant())`, that **never issues its own queries** and **composes monotonically** (AND) with tenant isolation and RLS so it can **only ever deny more, never grant cross-tenant access**.

**Why this base over the alternatives:**

- The judge verified nearly every load-bearing claim against this exact codebase as TRUE: `workspace_members(role CHECK owner|member|va, preferences jsonb)` + `idx_workspace_members_user` exist (0021/0034); `resolveTenant()` already treats `workspace_members` as truth and the JWT as a cache; the strip-and-reinject header pattern the design extends is real; `audit_log(tenant_id, actor_id uuid, actor_username, action, target, detail)` exists (0002); the admin stub is exactly as described; and the design correctly avoids the **vestigial `tenant_members` trap** (0035 dropped its trigger; 0036 made `workspace_members` canonical).
- **The monotonic-AND safety property is the killer feature.** Because `authorize()` runs no queries and never removes a `tenant_id` filter, turning it on can only produce 403s where there were 200s. Blast radius of a bad policy = "wrongly blocked" (recoverable via one env flag), never a leak. This is the correct risk posture for a single-owner-today system.
- The two rival candidates (a Cedar/OPA-style declarative PDP, and a hybrid that pushes ABAC into RLS as a second backstop) scored lower (≈ 7.0 and 7.8) on **simplicity** and carried unreconciled debt: a second invented `app_role` column colliding with the `workspace_members.role` axis, leaning on a mis-semantic `created_by` column, and inheriting the `isHq`/system-fallback ambiguity into a now-central policy. No new dependency (CASL/zod) is justified for pnpm/Next 16 — CASL's mongo-query conditions don't compose with our raw-SQL + AsyncLocalStorage world.

**Grafted-in ideas from the other candidates** (the synthesis):

1. **Deny-overrides composition with an explicit default-DENY** (from the PDP candidate), implemented inside the dispatcher rather than as a rules engine: the mandatory pre-checks (`cross_tenant`, `hq_only`) run first and can only deny; an unknown resource type denies once enforcement is on.
2. **Shadow mode** as a distinct migration phase (from the PDP candidate): log-but-don't-block, soaked against real traffic before any user sees a 403.
3. **Reuse `rbac.ts`'s capability matrix as a helper inside policies** (from the hybrid), via a single documented role-name bridge — instead of inventing a parallel role column.

### 2.1 The honest correction the judge surfaced (and how we resolve it)

The minimal candidate claims "the resource is already loaded → zero net new DB cost." **This is FALSE for the exact sensitive actions ABAC most needs to gate**, and the design must own it. Verified in source:

- `src/app/api/connections/route.ts` `DELETE` (the design's own `disconnect`/`rotate_secret` example) operates on a `provider` **query-string param** — **no row is loaded at all** before the scoped delete in `disconnect()`.
- `src/lib/drafts.ts` `approveDraft`/`updateDraft` mutate by `id` first, then `getDraft()` to return the fresh row — i.e. **mutate-then-read**, not load-then-mutate.

**Resolution (this ADR's stance, not a hand-wave):** the honest cost is **one cached subject query per request + at most one resource pre-load per protected *mutating* handler.** Where a handler does not already hold the row, we add an explicit, scoped `loadResource()` SELECT (still `WHERE id/provider = … AND tenant_id = ${tenantId()}`) so `authorize()` sees real resource attributes and is **fail-closed before** the mutation. For purely role-gated verbs with no meaningful resource attributes (e.g. `manage_system`), the resource is the request payload and the policy degrades cleanly to RBAC — explicitly, not accidentally. We do **not** authorize after the mutation. This is the actual retrofit work and is why `migrationCost` is honestly a 7, not a 9.

---

## 3. Attribute Model

Four plain-object attribute bags. No classes, no inheritance.

### SUBJECT — the acting user (resolved once per request, cached)
| Attribute | Type | Source |
|---|---|---|
| `userId` | `string` | `currentUserId()` (ALS, set by `resolveTenant()` from the validated `x-user-id`) |
| `tenantId` | `string` | `tenantId()` (the resolved active workspace) |
| `role` | `'owner' \| 'member' \| 'va'` | **ONE cached** `SELECT role, preferences FROM workspace_members WHERE workspace_id = ${tenantId()} AND user_id = ${currentUserId()}` (indexed by PK + `idx_workspace_members_user`). Phase 3: optionally promoted to a JWT claim (cache; `workspace_members` stays truth). |
| `isHq` | `boolean` | `tenantId() === DEFAULT_TENANT_ID` (reuses `isHqTenant()`) |
| `attrs` | `Record<string,unknown>` | `workspace_members.preferences` jsonb (0034) — capability overrides, department, `billing_admin`, etc. Empty today; **zero schema cost** to start using. |

### RESOURCE — the row/entity being acted on (passed in by the handler; `authorize()` NEVER fetches)
| Attribute | Type | Source |
|---|---|---|
| `type` | `ResourceType` discriminant | the handler (`'client_integration'`, `'draft'`, `'agent_def'`, `'campaign'`, `'connection'`, `'tenant'`, `'workspace_member'`, `'hq_surface'`, …) |
| `tenantId` | `string` | the row's `tenant_id` — used only for a defense-in-depth equality assertion, never as primary isolation |
| `createdBy` | `string \| null` | a **real user-id** column where present (see §6 — **NOT** `agent_drafts.created_by`, which is `text` holding *agent* names like `'hyperframes-agent'`, not user UUIDs — verified). Treated as "tenant-owned, any member may act" when null. |
| `attrs` | the row itself | so policies read `resource.attrs.provider`, `resource.attrs.status`, `resource.attrs.source === 'builtin'`, `resource.attrs.secret_encrypted != null`, etc. For `create`/`list` there is no row → `attrs` is the request payload. |

### ACTION — a string union per resource-type
`'read' | 'create' | 'update' | 'delete' | 'approve' | 'reject' | 'publish' | 'send' | 'spawn' | 'rotate_secret' | 'disconnect' | 'invite' | 'change_role' | 'export' | 'manage_system'` — the verbs already implied by HTTP method + route.

### ENVIRONMENT — synthesized from headers + clock, no I/O
`{ now: Date, via: 'api' | 'cron' | 'webhook', ip?: string, requestId?: string }`. Mostly unused day one; present so time-windowed / source-gated policies (e.g. deny destructive ops from a `webhook` context) need no signature change later.

**Net added DB cost:** exactly **one** indexed `workspace_members` lookup per request (memoized for all `authorize()` calls in that request), plus at most one scoped resource pre-load per protected *mutating* handler that doesn't already hold its row. Zero per-policy queries. Phase 3 JWT-role claim removes even the subject lookup for non-sensitive actions.

---

## 4. Policy Representation + Code Sketch

Policies are **plain TypeScript pure functions**, one module per resource-type, registered in a typed map. No DSL, no JSON, no DB-stored rules. Decisions are **values, not exceptions** — trivially unit-testable, no mocks.

```
src/lib/authz/
  types.ts        — Subject, Resource<T>, Action, Env, Decision, allow()/deny()
  authorize.ts    — dispatcher: mandatory pre-checks + policies[resource.type]
  subject.ts      — getSubject() (the single cached role/attrs lookup; role-name bridge)
  policies/
    client-integrations.ts
    drafts.ts
    agent-defs.ts
    hq.ts
    index.ts      — { policies, HQ_ONLY_TYPES }
```

### 4.1 Types + dispatcher

```ts
// src/lib/authz/types.ts
export type WorkspaceRole = 'owner' | 'member' | 'va';
export interface Subject {
  userId: string; tenantId: string; role: WorkspaceRole;
  isHq: boolean; attrs: Record<string, unknown>;
}
export interface Resource<T extends string = string> {
  type: T; tenantId: string; createdBy?: string | null; attrs: Record<string, unknown>;
}
export interface Env { now: Date; via: 'api' | 'cron' | 'webhook'; ip?: string; requestId?: string; }
export type Decision = { allow: true } | { allow: false; reason: string };
export const allow = (): Decision => ({ allow: true });
export const deny = (reason: string): Decision => ({ allow: false, reason });

// src/lib/authz/authorize.ts — dispatcher with mandatory, non-overridable composition checks
import { allow, deny, type Subject, type Resource, type Env, type Decision } from './types';
import { policies, HQ_ONLY_TYPES } from './policies';

export function authorize(s: Subject, action: string, r: Resource, env: Env): Decision {
  // Migration flag (read at runtime → rollback is one env var, no deploy).
  const mode = process.env.AUTHZ_ENFORCE ?? 'off';
  if (mode === 'off') return allow();

  // (1) HARD pre-check — can ONLY deny; reinforces (never replaces) tenant isolation.
  //     The row was already loaded under tenantId() scoping, so this is belt-and-braces.
  if (r.tenantId !== s.tenantId) return deny('cross_tenant');

  // (2) HQ surfaces — folds in requireHq() with identical semantics.
  if (HQ_ONLY_TYPES.has(r.type) && !s.isHq) return deny('hq_only');

  // (3) Resource-type policy (default-DENY for any unpoliced known-unknown).
  const policy = policies[r.type];
  if (!policy) return deny('no_policy');
  return policy(s, action, r, env);
}
```

### 4.2 Example policy — SENSITIVE: rotating a credential

```ts
// src/lib/authz/policies/client-integrations.ts
import { allow, deny, type Subject, type Resource, type Env } from '../types';

// client_integrations carries secret_encrypted. Credential mutation is owner-only
// (or an explicit billing_admin attribute on the member). Members/VAs cannot touch secrets.
export function clientIntegrationPolicy(s: Subject, action: string, r: Resource, _env: Env) {
  const carriesSecret = r.attrs.secret_encrypted != null;
  switch (action) {
    case 'read':
      return allow();                                    // any member of the tenant
    case 'rotate_secret':
    case 'disconnect':
      if (s.role === 'owner' || s.attrs.billing_admin === true) return allow();
      return deny('secret_change_requires_owner_or_billing_admin');
    case 'create':
    case 'update':
      if (carriesSecret && s.role !== 'owner') return deny('secret_field_requires_owner');
      return s.role === 'owner' || s.role === 'member'
        ? allow() : deny('viewer_cannot_write');
    default:
      return deny('unknown_action');
  }
}
```

### 4.3 Example policy — OWNERSHIP + builtin protection (drafts / agent defs)

```ts
// src/lib/authz/policies/drafts.ts
import { allow, deny, type Subject, type Resource, type Env } from '../types';

// Ownership is OPTIONAL and only meaningful once a real user-id author column exists
// (see §6 — agent_drafts.created_by is agent-authorship text, NOT a user id).
// Until then createdBy is null → "tenant-owned, any member may act" (preserves today).
export function draftPolicy(s: Subject, action: string, r: Resource, _env: Env) {
  switch (action) {
    case 'read': return allow();
    case 'create':
    case 'update':
      return s.role === 'owner' || s.role === 'member' ? allow() : deny('viewer_cannot_write');
    case 'approve':
    case 'reject':
    case 'publish':
    case 'send':
      // Approving/publishing is an authority action — owner always; member only if
      // they authored it (when authorship is known); VA never.
      if (s.role === 'owner') return allow();
      if (s.role === 'member' && (r.createdBy == null || r.createdBy === s.userId)) return allow();
      return deny('approval_requires_owner_or_author');
    case 'delete':
      return s.role === 'owner' ? allow() : deny('delete_requires_owner');
    default: return deny('unknown_action');
  }
}
```

### 4.4 Example policy — CROSS-CLIENT / HQ-only surface

```ts
// src/lib/authz/policies/hq.ts — Issues/Fixer and any cross-client operations surface.
// HQ_ONLY_TYPES is checked in the dispatcher (deny hq_only) BEFORE this runs, so by the
// time we're here s.isHq is true. This re-expresses requireHq() as ONE policy so there's
// a single mental model, WITHOUT changing its semantics.
import { allow, deny, type Subject, type Resource, type Env } from '../types';

export function hqSurfacePolicy(s: Subject, action: string, _r: Resource, _env: Env) {
  // Even within HQ, opening a GitHub PR / running the Fixer is owner-gated.
  if ((action === 'open_pr' || action === 'run_fixer') && s.role !== 'owner') {
    return deny('hq_write_requires_owner');
  }
  return allow();
}
```

### 4.5 Canonical handler call order

```ts
// e.g. src/app/api/connections/route.ts  DELETE = disconnect/rotate_secret
enterTenant(await resolveTenant());                  // isolation context (UNCHANGED)
const subject = await getSubject();                  // +1 cached lookup (or JWT claim)
const conn = await loadConnection(provider);         // EXPLICIT scoped pre-load (WHERE provider AND tenant_id)
if (!conn) return NextResponse.json({ error: 'Not found' }, { status: 404 });
const gate = authorize(
  subject, 'rotate_secret',
  { type: 'client_integration', tenantId: conn.tenant_id, createdBy: null, attrs: conn },
  { now: new Date(), via: 'api' },
);
if (process.env.AUTHZ_ENFORCE === 'shadow') {
  if (!gate.allow) await audit('authz.shadow_deny', provider, gate.reason); // log, then proceed
} else if (!gate.allow) {
  return NextResponse.json({ error: 'Forbidden', reason: gate.reason }, { status: 403 });
}
// …proceed with disconnect(provider)…
```

### 4.6 Role-name bridge (single source of truth)

`workspace_members.role` is `owner|member|va`; `rbac.ts` is keyed on `admin|editor|viewer`. To reuse `rbac.ts`'s capability matrix inside policies without drift, **one** documented mapping lives in `subject.ts`:

```ts
// owner → admin, member → editor, va → viewer.  THE sole bridge. Do not duplicate.
export const ROLE_TO_RBAC = { owner: 'admin', member: 'editor', va: 'viewer' } as const;
// inside a policy:  roleHasCapability(ROLE_TO_RBAC[s.role], 'approve_automations')
```

---

## 5. JWT Claims

**Day one: NO JWT change.** `app_metadata` stays `{ tenant_id }`. Role/attrs come from the single cached `workspace_members` lookup. This is intentional — adding claims means re-stamping every existing user and dealing with refresh-lag, deferred until policies are proven.

**Phase 3 (optional perf):** extend `app_metadata` to `{ tenant_id, role: 'owner'|'member'|'va', attrs?: {…scalars} }`. Mechanics mirror the existing `tenant_id` stamping (`supabaseAdmin().auth.admin.updateUserById` in `/api/clients` + invite). The middleware forwards `role` via a new `x-role` header using the **same strip-and-reinject pattern** that already prevents `x-tenant-id` spoofing; `getSubject()` reads the header first, falls back to the `workspace_members` query if absent (mirrors the `resolveTenant()` fallback for freshly-issued sessions).

**Staleness contract (documented):** JWT role is a CACHE; `workspace_members` is truth. On role change the DB is effective immediately; an old token sees the old role until next refresh (≤ token TTL, ~1h). **Sensitive actions** (`rotate_secret`, `change_role`, `invite`) **opt out** of the JWT cache and force the live `workspace_members` read — trading one query for zero staleness. Keep claims tiny: only `role` + a handful of scalar attrs; never resource lists.

---

## 6. Schema Changes

Minimal, additive, flag-independent (can land first, no behavior change).

**REUSE (no migration):**
- `workspace_members(workspace_id, user_id, role CHECK owner|member|va, preferences jsonb)` (0021/0034) — `role` is the subject role; `preferences` jsonb is the subject-attrs store at zero schema cost. **Single source of truth.**
- `audit_log(tenant_id, actor_id uuid, actor_username, action, target, detail)` (0002) — ABAC denies + sensitive-allows write here.

**DO NOT resurrect `tenant_members`.** It is vestigial: 0035 dropped its populating trigger, 0036 made `workspace_members` canonical (RLS UNIONs both only for backward compat). Adding a second role axis here would re-create the `admin/editor/viewer` vs `owner/member/va` collision the lower-scored candidates fell into.

**NEW (small, additive, all default-NULL → no effect on existing rows/flows):**
1. **A real author column for ownership policies.** Note `agent_drafts.created_by` is `text` and holds **agent** names (`'hyperframes-agent'`), **not** user UUIDs (verified in `drafts.ts` + 0002) — it is **not** user-ownership. Ownership policies require a new nullable `author_user_id uuid` (or equivalent) on the resource tables that need them (`agent_drafts`, `assets`, `campaigns`, `scripts`), backfilled NULL. Policies treat NULL as "tenant-owned, any member may act" → preserves today's behavior. **Do not overload the existing `created_by`.**
2. **Wire `audit_log.actor_id`.** Today `logAudit()` hardcodes `actor_id = null` (its comment cites the legacy SQLite numeric `User.id`). The Supabase uuid is now available via `currentUserId()`. ABAC's deny/sensitive-allow audit trail needs `actor_id` populated or it is anonymous — so `logAudit()` (or a thin `audit()` used by the guard) must accept and write `currentUserId()`. This is a signature touch across existing callers, not a one-liner; budget for it.
3. Optional: `tenants.attrs jsonb` (or reuse `business_profile`) for environment attributes (`data_sensitivity`, feature flags) so context policies have a home. Default NULL → no effect.

**Do NOT add:** a `policies` table, a `roles` table, a permissions join table, or a PDP service. The role-name unification is handled in code (`subject.ts`), not a destructive CHECK-constraint migration. A `roles` migration is justified only if teams later need >3 roles — not now.

---

## 7. Composition with Tenant Isolation + RLS (Defense in Depth)

Effective access = **tenant-scope AND RLS AND authorize()** — every layer can only *subtract*. This is the key non-breaking-migration property.

- **Tenant isolation invariant intact.** `authorize()` issues no queries and never removes a `tenant_id` filter. The dispatcher's mandatory `resource.tenantId === subject.tenantId` pre-check is an *additional* assertion in the same direction; worst case it denies a request isolation would already have starved of data. There is **no path** where an `allow` grants a foreign-tenant row — the row was loaded under `tenantId()` scoping before `authorize()` ever saw it.
  - **Caveat (honest):** that pre-check only bites when the handler populates `resource.tenantId` from a *loaded* row. For the no-row verbs (§2.1) it degenerates to `tenantId() === tenantId()` (always true). That is exactly why §2.1 mandates an explicit scoped pre-load for protected mutations — so the check has a real row to compare and isolation is never the *sole* line.
- **RLS untouched.** No migration alters `current_user_tenant_ids()` or any `for all using (…)` policy. RLS still backstops the browser/anon path. ABAC runs in the RLS-bypassing app layer and adds the dimension RLS structurally cannot express: *which member*, doing *which action*, on *which attributes*.
- **Monotonic AND.** Turning ABAC on can only convert 200s → 403s, never the reverse. A bad policy = "wrongly blocked" (loud, flag-revertible), never a leak. `requireHq()` remains valid throughout and is later folded in as dispatcher check (2) without changing semantics.

**There is no RLS-equivalent backstop for the ABAC action/ownership dimension** — a forgotten `authorize()` silently reverts that route to owner-equals-admin (still tenant-isolated, so worst case is intra-tenant over-permission, never cross-tenant). Mitigation in §10.

---

## 8. Phased, Non-Breaking, Flag-Gated Migration

Flag: `AUTHZ_ENFORCE` ∈ `{ 'off' | 'shadow' | 'on' }`, per-env, read at runtime, default `'off'`. Rollback = flip the env var, no deploy.

**Phase 0 — scaffolding (zero behavior change).** Land `src/lib/authz/*` (types, `authorize`, `getSubject`, policies), the role-name bridge, the additive `author_user_id` columns, and the `audit_log.actor_id` wiring. `authorize()` exists; no handler calls it; flag `off` short-circuits to `allow()`. Ship. Zero risk.

**Phase 1 — de-lie the API + introduce authorize() defaulting to current behavior.** Replace the `role:'admin'` hardcode in `/api/auth/me` with the real `workspace_members.role` (owner shows as owner) so the UI can finally differentiate — **without changing access**. Rewrite the `api-auth.ts` stubs to delegate to `authorize()`; with `AUTHZ_ENFORCE='off'` the dispatcher returns `allow()` for everyone. **Net behavior identical to today.** This is the requested "introduce authorize() that defaults to current behavior" step.

**Phase 2 — shadow + real policies on sensitive actions (`AUTHZ_ENFORCE='shadow'`).** Wire `authorize()` into the **sensitive** handlers first (credential rotate/disconnect, draft approve/publish/send, invite, change_role, HQ open_pr/run_fixer), each with its explicit scoped resource pre-load (§2.1). On a deny, **log** (`audit_log action='authz.shadow_deny', detail=reason`) but **do not block**. Soak against real traffic. Since production is single-owner today, expected owner shadow-denies ≈ 0; any non-zero is a policy bug caught **before** any user sees a 403. This is the requested "real policies on sensitive actions" step.

**Phase 3 — enforce, owner-first + teams/roles UI (`AUTHZ_ENFORCE='on'`).** Policies are written **default-ALLOW-for-owner** (`s.role === 'owner'` → allow unless a specific deny like `cross_tenant`/`hq_only`/`secret_change_requires_owner` fires), so single-owner tenants — 100% of production today — are unaffected the instant enforcement flips. `member`/`va` get real restrictions, which only matter once a workspace has >1 member. Flip per-env (preview → HQ tenant only → all), watching `audit_log`. Ship the teams/roles management UI (invite, change_role) on top of the now-enforced `workspace_members.role`; optionally stamp role into the JWT for the zero-query path; optionally fold `requireHq()` into the dispatcher's check (2) and retire the standalone helper. `requireHq()` and tenant isolation stay live and unchanged until explicitly replaced — no big-bang. This is the requested "teams/roles UI" step.

Each phase is independently shippable and reversible by the flag.

---

## 9. Enforcement-Point Guidance

Three points, each doing exactly one job — **do not collapse them**:

1. **`tenant_id` query scoping (UNCHANGED) — the load-bearing isolation.** The only thing between tenants. ABAC never touches it.
2. **RLS (UNCHANGED) — defense-in-depth** for the browser/anon path. ABAC does not read or weaken it.
3. **`authorize()` — per-HANDLER, in-process, synchronous (NEW).** **NOT at the `src/proxy.ts` edge.** The edge runs before the handler, has no resource row and no DB pooler access, so it cannot evaluate resource attributes (`createdBy`, `attrs.source === 'builtin'`, `attrs.provider`) — which are the whole point of ABAC. The edge stays coarse (authenticated + has-workspace). The handler is the only place where the resource is loaded (so the resource pre-load is local and scoped) and the action is unambiguous. `authorize()` is called inside the handler, immediately after the resource fetch. The `api-auth.ts` stubs become thin wrappers over `authorize()` so existing import sites gain teeth without per-call edits.

---

## 10. Performance Notes

- **Added cost per request:** one indexed `workspace_members` lookup (PK / `idx_workspace_members_user`), **memoized for the whole request** (a `WeakMap` keyed on the AsyncLocalStorage store object, so no cross-request poisoning and no TTL surface). Sub-millisecond, same transaction pooler (6543, `prepare:false`) already in use.
- **Resource attributes:** zero added queries for handlers that already hold the row; **one** scoped pre-load for protected mutating handlers that don't (§2.1) — bounded, local, and itself tenant-scoped.
- **Policy evaluation:** synchronous pure-function dispatch, O(1) map lookup + a few booleans. No network, no Auth round-trip (identity already validated by middleware `getUser()`), no RLS round-trip. Negligible vs. surrounding DB/LLM work.
- **Phase-3 JWT-role option** removes the subject lookup for non-sensitive actions → zero added queries on the common path (same profile as today's `x-tenant-id` header read). Sensitive actions deliberately keep the live read (staleness = 0), so the JWT win does not apply there — buy it only where it's safe.

---

## 11. Risks

1. **Distributed enforcement.** Every protected route must remember to call `authorize()`; a forgotten call silently reverts that route to owner-equals-admin (still tenant-isolated). **Mitigation:** a `withAuthz()` higher-order handler for the load-then-check pattern; a lint/CI rule; and a registry test asserting every `ResourceType` has a policy and every protected route calls the guard. Treat tenant isolation as the real boundary; ABAC is intra-tenant governance.
2. **Resource pre-load underestimated.** §2.1 — retrofitting load-then-check into single-statement handlers is the actual work; budget per-handler, not "free."
3. **`created_by` semantics trap.** Ownership policies must use the new `author_user_id`, never the existing agent-authorship `created_by` text column.
4. **`actor_id` wiring is a cross-caller signature change**, not a one-liner; without it the audit trail the rollback story leans on is anonymous.
5. **Role-name drift.** `owner/member/va` vs `admin/editor/viewer` — the `ROLE_TO_RBAC` bridge must be the sole mapping or capability checks silently diverge.
6. **`isHq` over-breadth.** `tenantId()` falls back to `DEFAULT_TENANT_ID` for session-less cron/system paths, so `isHq` is true for HQ *and* for cron contexts. Folding `requireHq()` into a policy is behavior-preserving only because the dispatcher computes `isHq` identically — but be explicit that `via: 'cron'` contexts can satisfy an `hq_only` check; gate cron-reachable HQ writes on `via` if that matters.
7. **JWT-role staleness** (≤ ~1h) on downgrade — mitigated by opt-out-to-live-read on sensitive actions; means Phase 3 JWT claims buy less than a naive reading implies.
8. **Policies in code, not data** → a rule change needs a deploy. Acceptable at current scale; a rules table is the upgrade path if customers ever need self-serve roles.

---

## 12. Founder Decisions Required

These are **business/scope** calls the design is deliberately leaving to Brayson; each has a recommended default:

1. **Are multi-user teams in scope NOW or later?** *Default: build teams-READY (data-activated), enforce single-owner.* The whole design lights up the moment a workspace has a 2nd `workspace_members` row — no code change — so we can ship the guard now and turn on teams when a real cohort needs it. **Decide:** is a teams/roles UI a Phase-3 deliverable on a date, or purely latent until a customer asks?
2. **Initial role set.** The DB already constrains `workspace_members.role` to **`owner | member | va`**; `rbac.ts` speaks `admin | editor | viewer`. *Default: keep the 3 DB roles and use the `owner→admin / member→editor / va→viewer` bridge.* **Decide:** stay 3-role with the bridge (recommended, no migration), or unify on one vocabulary (a CHECK-constraint migration + UI relabel)? A 4th role (e.g. a distinct `billing_admin` vs an attribute flag) is the same decision.
3. **Which resources get fine-grained policies FIRST?** *Default (recommended order): client_integrations (credential rotate/disconnect — highest blast radius) → drafts (approve/publish/send) → invites/change_role → HQ surfaces → agent_defs (builtin protection).* **Decide:** confirm or reorder; anything not on the first list stays owner-equals-admin until policed.
4. **Self-serve invites & who can invite / change roles?** *Default: owner-only invite + change_role, opting out of the JWT cache (live read) for both.* **Decide:** can a `member` invite teammates? Can a `member` ever be promoted to `owner` by another `owner`, and is there always ≥1 `owner` (last-owner protection)?
5. **Ownership semantics — do we want "author can act on their own X"?** This requires the new `author_user_id` column + backfill. *Default: ship the column NULL (tenant-owned) now; enable author-scoped policies later.* **Decide:** is creator-scoping a real near-term requirement (worth the backfill), or YAGNI for now?
6. **VA (viewer) blast radius.** *Default: VA = read + chat_send only; no writes, no approvals, no secrets.* **Decide:** confirm a VA can/can't trigger agent runs (`spawn`), send messages, or approve drafts they authored.
7. **Cron/system context authority.** Because `isHq` is true for the `DEFAULT_TENANT_ID` cron fallback (Risk #6), **decide** whether autonomous/cron paths bypass `authorize()` entirely (they run as the system, pre-authorized by the operator) or must satisfy a `via:'cron'`-aware policy. *Default: cron paths are pre-authorized and skip the guard, since they already pass through the autonomy gate.*
8. **Audit retention + actor visibility.** Wiring `actor_id` makes the who-did-what trail real. *Default: log every deny and every sensitive allow.* **Decide:** is that the desired verbosity, and is there a retention/PII policy for `audit_log`?

---

## 13. Consequences

**Positive:** real per-action/per-attribute authorization for the cost of one cached query + a function call; pure-TS, type-safe, trivially unit-tested policies; can only ever deny-more (migration cannot leak); flag + shadow mode make rollout boring; teams-ready by construction; `rbac.ts` and `requireHq()` reused, not thrown away.

**Negative / accepted:** enforcement is distributed (per-handler discipline, no structural backstop for the action dimension — mitigated by `withAuthz` + lint + registry test); protected mutations need an explicit resource pre-load (real retrofit work, honestly ~1 query each); rule changes need a deploy; JWT-role cache adds bounded staleness on the perf path (opt-out for sensitive actions). Net: the right altitude for a single-owner-today, teams-tomorrow product, without endangering the isolation invariant that actually matters.
