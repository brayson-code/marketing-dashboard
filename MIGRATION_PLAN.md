# Migration Plan: KeyPlayers Command Center → Multi-Tenant SaaS

> Status: **DRAFT for review** · Owner: Brayson · Last updated: 2026-05-20
>
> Goal: turn the current single-user, SQLite + Hermes/OpenClaw-coupled Next.js app into a
> multi-tenant SaaS that clients can onboard into with **zero downloads, no repos, no
> technical setup** — login by magic link / Google, data isolated per client.

---

## 1. Target architecture — just **Vercel + Supabase** (no VPS, nothing self-hosted)

```
                          ┌─────────────────────────────────────────┐
        Client browser ──▶│  VERCEL                                  │
                          │  - Vite + React SPA (dashboard)          │
                          │  - Serverless Functions (Fluid Compute): │
                          │      • LoopMessage webhook               │
                          │      • Orchestrator + sub-agents         │
                          │      • Integrations (Google etc.)        │
                          │      • ALL secrets (server-side env)      │
                          │  - Vercel Cron (scheduled agents)         │
                          │  - Vercel Queues (long/background runs)    │
                          └───────────────┬──────────────────────────┘
                                          │  service-role (tenant-scoped)
                                          ▼
                          ┌──────────────────────────────────────────┐
                          │  SUPABASE (managed — stores everything)    │
                          │  - Postgres (RLS) · Auth · Storage         │
                          │  - pgvector (RAG)                          │
                          └──────────────────────────────────────────┘
                                          │
                  Anthropic API · LoopMessage · Google · Substack · socials
```

**Two jobs, both fully managed:** Supabase **stores** data + handles login; Vercel **runs** the dashboard and the agent code as serverless functions. **No VPS, no server to patch or secure.**

**Three rules that define the whole design:**
1. Secrets live **only** in Vercel server-side env (functions) — never in the SPA bundle.
2. Every domain row carries a `tenant_id`; **Row-Level Security** enforces isolation. *(This — not the host — is what prevents one client seeing another's data.)*
3. The SPA reads/writes Supabase directly for ordinary data (RLS-protected) and calls Vercel functions only for secret/agent operations.

---

## 2. The knowledge layer (no separate vault)

Everything lives in **Supabase** — there is **no git vault and no shared filesystem**. The "second brain" is:

| Kind | Examples | Home |
|---|---|---|
| **Documents / notes** | `/raw` staging → `/wiki` compiled (a `status` field), project notes, generated docs | `documents` table (markdown rows) |
| **Structured facts** | knowledge graph entities + relations, leads, goals, drafts, transactions | Postgres tables |
| **Semantic recall** | LightRAG Query / Deep Research retrieval | `pgvector` embeddings over documents + entities |
| **Files & media** | receipts, decks, carousels, thumbnails, uploads | Supabase Storage |

> **Why no vault / no TigerFS:** the Memory layer's `/raw → /wiki` pipeline is a document **lifecycle** (a status column), not a folder tree. With no shared filesystem, there's no file-coordination problem at all — coordination is pure Postgres (ACID, row locks, `ON CONFLICT`). Version history = a `version` column / audit table. Optional later: one-way export to markdown for personal Obsidian use.

---

## 3. Stack decisions (settled)

| Layer | Choice | Why |
|---|---|---|
| Dashboard | **Vite + React SPA** on Vercel | Consistency with other projects; foldable into future parent app |
| Auth | **Supabase Auth** (magic link + Google) | Web-only, no downloads; built for SPAs; pairs with RLS |
| Data / KG / docs | **Supabase Postgres** (+ `pgvector`) | One managed store for facts, documents, and semantic recall |
| Isolation | **Postgres RLS** + `tenant_id` everywhere | Per-client security boundary (critical for Finance data) |
| Agents / webhook | **Vercel Serverless Functions** (Fluid Compute) | Runs alongside the dashboard; holds secrets server-side; nothing to self-host |
| Queue + cron | **Vercel Queues + Vercel Cron** | Background agent runs + scheduled agents, fully managed (replaces a long-running worker) |
| Data access | **Drizzle ORM** | Typed + migrations; replaces raw `better-sqlite3` SQL |
| Media | **Supabase Storage** | Per-tenant binary assets |
| RAG | **LightRAG** over `documents` + `pgvector` | Deep Research / LightRAG Query agents |
| Doc parsing | **LiteParse** (local, TS-native) | Receipts/docs parsed on our infra — privacy win |
| Shelved | **TigerFS** · git vault | No shared filesystem; Postgres covers coordination — see §2 |

---

## 4. Agent roadmap → where each lands

| Group | Agents | Needs |
|---|---|---|
| **Memory** | `/raw` staging → `/wiki` compiled, `/projects`, CLAUDE.md prompt, `.claude/memory` | `documents` lifecycle + KG + `agent_memory`; pgvector recall |
| **Productivity** | GwM CLI/Drive/Docs, Inbox Triage, Calendar Brief, Drive Sync, Daily Review, Morning Routine | Google integrations + **scheduler** + records |
| **Research** | AI Pipeline, Deep Research, LightRAG Query, Morning Trend Scan, Competitor Watch, NotebookLM Bridge | Web + **RAG** (documents/KG) + scheduler + integrations |
| **Content** | Outlines, Substack inbox, Content Cascade, Carousel Generator, Short-Form Repurpose, Thumbnail Briefs | Records (drafts) + **media storage** + integrations |
| **Community** | Social Post Drafts, Classroom, Member Onboarding, Weekly Q&A Digest, Comment Triage, Community Pulse | Records + social integrations + scheduler |
| **Agency** | Client Onboarding Doc, Scope-of-Work Gen, Weekly Client Status, Deliverable QA, Retainer Renewal, ADDS Builder | Document generation + scheduler + records |
| **Sales** | Sponsor Pitch Deck, Lead Enrichment, Follow-up Cadence, Proposal Drafts, Pipeline Review, Sponsor Inbox Triage | CRM records + email integration + scheduler + doc gen |
| **Finance** | Books Categorize, Monthly P&L, Tax Prep Sched C, Anomaly Scan, Subs Audit, Receipts Tracker | Records (transactions) + accounting/bank integration + scheduler + **LiteParse** (receipts). **Elevated security: RLS + encryption** |
| **Ops/Custom** | Vault Cleanup (→ KB cleanup), Skill Creator, Cron Manager, Hook Config, Sub-agent Spawn, + Custom per client | **Meta/admin** — manage scheduler, triggers, agent templates, sub-agent registry (config in Postgres) |

Cross-cutting worker layers: **Integrations** (per-tenant OAuth, encrypted), **Scheduler** (pg-boss cron), **RAG** (LightRAG), **doc parsing** (LiteParse), **media** (Supabase Storage).

> The Ops group mirrors Claude Code's own model (skills, cron, hooks, sub-agents). The **Claude Agent SDK** is a candidate to accelerate these later.

---

## 5. Data model & multi-tenancy

**Tenancy core (new):** `tenants`, `tenant_members` (→ `auth.users`, roles). Every domain table gains `tenant_id uuid not null references tenants(id)`.

**File-based state → tables (removes Hermes coupling):**
- `state/keyplayer/config.json` → `agent_configs`
- `state/keyplayer/memory.md` rollups → `agent_memory`
- `state/keyplayer/goals.md` → `goals`
- All notes/wiki/project docs → `documents` (markdown rows, `status: raw|wiki`, `version`)
- Agent **templates** (`agents/**/*.md`) stay in the repo with the worker.

**RLS pattern (every domain table):**
```sql
create policy tenant_isolation on <table>
  using (tenant_id in (
    select tenant_id from tenant_members where user_id = auth.uid()
  ));
```
SPA uses anon key (RLS-enforced). Worker uses service-role key (bypasses RLS) and **must** filter `tenant_id` in every query — centralized in the data layer.

**Per-tenant integration secrets:** encrypted columns (reuse `KEYPLAYERS_SECRETS_KEY` from `integrations-store.ts`) or Supabase Vault.

**Webhook → tenant routing:** per-tenant webhook URL (`/webhook/loopmessage/:tenantId`) + per-tenant secret.

---

## 6. Phases

Sequenced so the **live iMessage agent is healthy by end of Phase 2**.

- **Phase 0 — Setup (~½ day):** ✅ Supabase project `keyplayers-command-center` (ref `zgtiviorskkcuzxnpvha`, us-east-1) created. Vercel project + Drizzle scaffolding still to do.
- **Phase 1 — Schema + RLS (~1–2 days):** ✅ **Schema done** — 23 tables ported to Postgres with `tenant_id` + RLS (`0001_foundation.sql`, `0002_domain_tables.sql`); `pgvector` enabled; `documents` added. ⏳ Remaining: ETL existing `state/hermes.db` data into a "KeyPlayers" tenant.
- **Phase 2 — Agent functions (~2–3 days)** ← fixes the dead tunnel for good: move `loopmessage`, `orchestrator`, `subagent`, `intents`, `proactive`, webhook + domain libs into **Vercel functions**; swap DB to Drizzle; replace fire-and-forget with **Vercel Queues** (webhook enqueues → consumer function runs the orchestrator); point LoopMessage at the stable Vercel URL.
- **Phase 3 — Auth (~1–2 days):** Supabase Auth (magic link + Google); onboarding (invite → tenant → workspace); migrate `admin`.
- **Phase 4 — Vite/React SPA (~3–5 days):** new app; React Router; `@supabase/supabase-js`; port pages; route agent/secret actions to worker; deploy to Vercel.
- **Phase 5 — Cutover (~½–1 day):** flip to SPA; retire old Next.js app, SQLite, tunnel, all `HERMES_*`/OpenClaw env.
- **Phase 6 — Agent build-out (ongoing):** wire the §4 roadmap — documents/KG/RAG, Google/Substack/social/accounting integrations, scheduler jobs, LightRAG, LiteParse (receipts), Ops/admin agents.

**Rough total: ~10–14 working days for Phases 0–5.**

---

## 7. What stays the same
Orchestrator tool-loop, tool definitions, sub-agent registry, agent markdown templates; React components + Tailwind (port); secret-encryption approach; intent fast-path.

## 8. Top risks & mitigations
- **Tenant data leak (esp. Finance)** → RLS everywhere + centralized `tenant_id` enforcement + encryption; test with two tenants.
- **Rewriting raw SQL** → Drizzle types + migrations; migrate table-by-table behind existing lib interfaces.
- **Data-migration correctness** → ETL with row-count + spot-check verification before cutover.

## 9. Open decisions / inputs needed
1. **Credentials model:** each client connects their own Google/LoopMessage/accounting, or pooled under your accounts?
2. Confirm **Drizzle** as the data-access layer.

_Resolved: **Hosting = Vercel + Supabase only, no VPS** (§1). Obsidian vault dropped — knowledge layer = Postgres `documents` + KG + `pgvector` (§2). TigerFS shelved (no shared filesystem)._

> **Note on long agent runs:** very long multi-agent fan-outs can exceed a single function's limit (~300s). Vercel Queues chunks these into steps — fine for V1; revisit only if runs routinely run long.

## 10. Immediate, independent quick-fix
The live agent is silent because the Cloudflare **quick tunnel died** (ephemeral hostname; `cloudflared` not running). Phase 2 fixes this permanently; meanwhile: start a new tunnel → update `HERMES_HOST_LOCK` in `.env.local` + restart `next dev` → update the LoopMessage webhook URL.
