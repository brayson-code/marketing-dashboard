# Production-Readiness Audit — KeyPlayers Command Center (2026-06-18)

Branch: `feat/command-center`. Method: 26 parallel finder agents across security/multi-tenancy/testing/reliability/compliance/docs, with adversarial verification of all critical/high findings. Context: pre-external-security-review readiness.

## Headline
**No critical or high findings survive verification.** The multi-tenant isolation invariant — the thing that would sink a SaaS — holds under scrutiny. Cross-tenant isolation and secrets-at-rest are **strong**. The originally-scary findings collapsed to medium/low/false-positive because they targeted **retired legacy code** (the better-sqlite3 auth path) or platform-mitigated concerns (HSTS via Vercel, login brute-force via Supabase). The real serious set is all **medium**, fixable in a focused week, and clusters around one theme: **enforce the role model (ABAC).** The bigger external-review risk is the **un-audited testing / reliability / compliance** surface, not any code vuln.

## Posture
| Category | Posture |
|---|---|
| Multi-tenancy / data isolation | **Strong** |
| Secrets at rest | **Strong** |
| Injection / sanitization | Adequate |
| Authorization (cross-tenant) | Strong; **intra-workspace RBAC not enforced** |
| Session | Adequate (MFA absent; no global logout) |
| TLS | Adequate (Vercel-managed) |
| Rate limiting | Adequate (in-memory; some unguarded endpoints) |
| Testing | **Weak / Unknown** (not deeply audited) |
| Reliability | Adequate / Unknown (runbooks thin) |
| Compliance (GDPR/DPA/retention) | **Missing / Unknown** |
| Docs / ADRs | Adequate |

## Verified serious findings (all MEDIUM, post-verification)
1. **No enforced intra-workspace RBAC** — `requireApiAdmin/Editor/Capability` are no-ops (`api-auth.ts:21-31`, imported in ~56 routes); `auth.ts:474-491` returns hardcoded `TRUSTED_ACTOR{role:admin}`; `auth/me:38` returns `admin` for everyone; `rbac.ts` matrix is display-only. Exploit: any member/va can `PUT /api/autonomy` (gated on plan, not role) to flip full agent auto-execute. → **ABAC build.**
2. **`/api/invite` no owner gate + no audit log** (`invite/route.ts:51-58`) — any member can add users. (Note: "elevate to admin" was disproved — invitee role hardcoded `member`.) → owner-gate + `logAudit()`.
3. **Sub-agent rate limiter is global-per-type, not per-tenant** (`subagent.ts:200,207,340`) — cross-tenant availability nuisance (no data/spend impact). → key on `${tenantId()}:${type}` (one line).
4. **Prompt injection** via user `task` + untrusted `boardroom_messages.text` concatenated into agent prompts (`subagent.ts:374-395,~275-302`). → delimit user content as data; strip markers.
5. **Unrate-limited expensive endpoints** — `/api/help`, `/api/assets` upload (no size/MIME cap), agent-spawn, per-tenant webhooks (can spawn orchestrator runs per inbound message). → per-tenant sliding window + 429; cap upload.
6. **DOM-XSS latent vector** — `use-injected-svg.ts:23,39,48` `fetch(src)→innerHTML` (src currently internal-only). → whitelist src / DOMPurify.
7. **No global logout / session revocation** — stolen JWT valid until expiry. → `signOut({scope:'global'})` + UI. (Addressed by the hardened session/revocation backbone.)
8. **No secret-rotation runbook; single `KEYPLAYERS_SECRETS_KEY` SPOF.** → rotation procedure; consider KMS/Vault.

**Downgraded / false-positive (don't spend budget):** login brute-force (dead route), HSTS-missing (Vercel injects 2yr HSTS), x-forwarded-proto trust (dead routes + fail-closed webhook), `/api/users` "critical bypass" (retired sqlite table → low info-disclosure only).

## Top 10 actions (impact-to-effort)
1. Tenant-scope sub-agent limiter (`${tenantId()}:${type}`) — **S**
2. Delete the dead better-sqlite3 auth stack (collapses ~4 findings) — **S**
3. Owner-gate + audit `/api/invite` — **S**
4. Owner-gate `PUT /api/autonomy` + other sensitive writes — **S**
5. Rate-limit `/api/help`, `/api/assets`, agent-spawn, webhooks; cap upload size/MIME — **M**
6. **Real intra-workspace RBAC / ABAC** across ~56 routes (schema already exists) — **M** (structural fix behind #1/#2/#4)
7. Harden agent prompt construction (delimit user content) — **M**
8. Whitelist/DOMPurify the SVG injection hook — **S**
9. Enable Supabase MFA; enforce AAL2 for HQ tenants — **M**
10. Write missing runbooks (rotation/deploy/TLS) + commission a testing + reliability + compliance pass — **L**

## Strengths (credit where due)
Request-scoped `tenantId()` via AsyncLocalStorage (concurrency-safe); consistent `WHERE tenant_id` + RLS backstop + header stripping; AES-256-GCM secrets with random IVs, never returned/logged; comprehensive `fetch_url` SSRF guard; `spawn(..., {shell:false})`; owner-gated provisioning + export; Supabase JWT revalidation + httpOnly/secure/sameSite cookies + PKCE state validation.
