# KeyCommand V2 — Phased Build Plan

Source PRD: `keycommand-v2-prd.md` (Mitch, 2026-05-24). This plan maps the PRD onto the
existing app and sequences the work. Status legend: ☐ todo · ◐ in progress · ☑ done.

> **SCOPE CORRECTION (Brayson, 2026-05-25):** the PRD was written fast and contains
> out-of-scope items. The ACTUAL V2 ask is narrow: **(1) a different UI look** (align
> with Mitch's aesthetic) and **(2) a time-saved-per-task tracker** (show users how much
> time the agents save per task), **plus (3) OAuth to connect social accounts**
> (Instagram/Facebook/LinkedIn/YouTube/X). Treat the rest of the PRD (8-step onboarding
> wizard, Key Audit $ calculator, Dream Mode, AI-Boardroom personas, agent-training UI,
> multi-tenant/clients) as **NOT confirmed** — do not build them unless Brayson says so.
> The phases below are kept for reference but most are descoped pending his answers.

> **Gating decision (answer before Phase 1):** redesign THIS app (Next 16, project
> `zgtiviorskkcuzxnpvha`) and point `command.keyplayers.com` at it, OR fork the engine
> into the KeyCommand Supabase project (`qdlfesoejaoxfqziubpd`, ca-central-1)?
> Recommendation: redesign this app — the whole engine already lives here.

---

## CONFIRMED SCOPE (Brayson decisions, 2026-05-25)
- Time-saved tracker = **Time + full ROI** (Key Audit: revenue/profit/hours/admin% → $/hr → projected ROI).
- Per-task minutes = **sensible presets, editable** per workspace.
- Social OAuth = **publish content + read analytics/engagement + pull brand voice**.
- UI = **PRD "Liquid Glass"** (dark `#0A0A0F`, emerald `#10D982`, frosted glass, Sora/Inter, motion).
- Single-tenant for now (no client workspaces / multi-tenant unless Brayson asks).

## Track A — Time-saved + ROI tracker  *(headline new feature; unblocked — BUILD FIRST)*
- ☐ `key_audit` table + standalone audit-input form (not the 8-step wizard) + live calculator
- ☐ `time_savings_log` table + editable per-action minute presets (email 8m, research 20m, …)
- ☐ Auto-log: when an agent task / draft completes, log minutes + $ saved by action type
- ☐ ROI dashboard page: hours saved, value reclaimed, old vs new $/hr, per-agent breakdown, trend

## Track B — "Liquid Glass" UI redesign  *(unblocked)*
- ☑ Nav relabel: Squads→Agents, Comms→Inbox (shipped 2026-05-25)
- ☐ Theme tokens (#0A0A0F base, emerald #10D982, frosted glass, Sora/Inter)
- ☐ framer-motion transitions; glass panels; number odometers
- ☐ Workspace/Knowledge label decision (our "Workspace" = Agent Studio; `/kg` already = Knowledge)

## Track C — Social OAuth (IG/FB/LinkedIn/YouTube/X)  *(BLOCKED on dev apps + credentials)*
Each platform needs a registered developer app + client id/secret + redirect URI, and several
need review for publish scopes (Meta publishing, LinkedIn `w_member_social`, X paid API tier).
- ☐ **Prereq (Brayson):** create dev apps + provide credentials per platform; pick first platform
- ☐ Generic OAuth connect/callback + token store (per provider)
- ☐ Publish path (draft → approve → post), read path (analytics → KPIs), brand-voice pull → KB

## DESCOPED (in the PRD, but NOT requested — do not build unless Brayson confirms)
8-step onboarding wizard · Dream Mode · AI-Boardroom personas (ATLAS/REX/…) · agent-training UI ·
multi-tenant/client workspaces · Firecrawl · Granola/ClickUp/Notion non-social integrations.

---

## New tables (all workspace-scoped + RLS)
`workspaces`, `key_audit`, `time_savings_log`, `agent_instruction_versions`,
`dream_sessions`, `knowledge_nodes`, onboarding state.

## Open questions blocking start
1. Redesign this app vs build on KeyCommand project `qdlfesoejaoxfqziubpd`?
2. Firecrawl API key + env var name?
3. Which OAuth providers are already wired (Google first)?
4. Confirm VA onboarding skips the Key Audit.
5. Share ClaudeOS / KeyMatch reference code or screenshots (onboarding, DreamCard, confetti).

## Sidebar relabel map (Phase 1)
| Current | New | Group |
|---|---|---|
| Squads | Agents | COMMAND |
| Comms | Inbox | WORK |
| Boardroom | Boardroom | COMMAND |
| Workspace | Knowledge | BUILD |
| (new) | Dream Mode | COMMAND |
| Tasks/Drafts/Campaigns | (keep) | WORK |
| Goals/KPIs/Analytics/Research | (keep) | GROW |
| Content/Automations | (keep) | BUILD |
| Integrations/Settings | (keep) | SETTINGS |
