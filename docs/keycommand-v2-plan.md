# KeyCommand V2 — Phased Build Plan

Source PRD: `keycommand-v2-prd.md` (Mitch, 2026-05-24). This plan maps the PRD onto the
existing app and sequences the work. Status legend: ☐ todo · ◐ in progress · ☑ done.

> **Gating decision (answer before Phase 1):** redesign THIS app (Next 16, project
> `zgtiviorskkcuzxnpvha`) and point `command.keyplayers.com` at it, OR fork the engine
> into the KeyCommand Supabase project (`qdlfesoejaoxfqziubpd`, ca-central-1)?
> Recommendation: redesign this app — the whole engine already lives here.

---

## Phase 0 — Foundation: multi-tenant + RLS  *(prereq for a client product)*
The app is effectively single-tenant today (`DEFAULT_TENANT_ID`, backend uses the
postgres role which BYPASSES RLS). A client product needs real per-workspace isolation.
- ☐ `workspaces` table + membership (client + VA roles per workspace)
- ☐ Per-workspace auth/session → resolve tenant from the logged-in user, not a constant
- ☐ RLS policies on every table; stop relying on the bypass role for tenant scoping
- ☐ Migrate existing data under a default workspace

## Phase 1 — Shell: navigation + "Liquid Glass" theme  *(makes it FEEL like V2 fast)*
- ☐ Sidebar relabel + regroup (COMMAND / WORK / GROW / BUILD / SETTINGS) — see nav map
- ☐ Theme tokens: `#0A0A0F` base, emerald `#10D982`, amber `#F5A623`, frosted glass, Sora/Inter
- ☐ framer-motion page/card transitions; number odometers; agent "thinking" states
- ☐ Top nav: agent status dot, notifications bell, search, user/plan badge

## Phase 2 — Activation: onboarding + ROI  *(the most important V2 feature)*
- ☐ 8-step onboarding wizard (full-screen takeover, progress bar, image slots, role branch, confetti)
- ☐ `key_audit` table + live ROI calculator (the lead-magnet math)
- ☐ `time_savings_log` table + per-action minute presets + ROI dashboard (projected→actual)
- ☐ `onboarding_complete` flag + trigger on first login

## Phase 3 — Boardroom + agent training
- ☐ Boardroom page redesign (executive cards w/ portraits, status, last action, chat)
- ☐ Map our agents to ATLAS/REX/MARA/NOVA personas (+ locked VEGA/ARIA on Pro)
- ☐ Agent Training UI (plain-English prompt + traits + focus areas) → `agent_instruction_versions` + history
      (overlaps existing Agent Studio + the strategy-gene layer)

## Phase 4 — Dream Mode  *(flagship differentiator)*
- ☐ Productize the existing cron/proactive sweep into a nightly session
- ☐ `dream_sessions` table; typed cards (opportunity/efficiency/risk/competitive/follow_up)
- ☐ Dream Mode page (activation + active states, morning briefing card row)
- ☐ Morning digest email/Slack (Phase 4b — needs email infra)

## Phase 5 — Integrations + business brain
- ☐ OAuth flows: Google (Drive/Gmail/Calendar) first, then Slack, Notion, ClickUp
- ☐ Firecrawl website scrape on onboarding → `knowledge_nodes`
- ☐ Knowledge page redesign (filters, add/upload/connect, last-used-by-agent)

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
