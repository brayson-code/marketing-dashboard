# Command Centre redesign — where we are

> Written 2026-08-05 so the working session can be compacted without losing the thread.
> **Read this first** in any new session. Companion: `plans/second-brain-graph-templates.md`
> (the Second Brain / org chart / templates build spec).

---

## 1. The setup

| | |
|---|---|
| Repo | `brayson-code/marketing-dashboard`, branch **`feat/command-center`** |
| Local | `~/dev/command-center` (never `~/Desktop` — iCloud hangs builds) |
| Live | **command.keyplayershq.com** ← Vercel project `keyplayers-command-center` |
| Prod DB | Supabase `zgtiviorskkcuzxnpvha` |
| Test DB | Supabase `dgcanicamgdeqehnvcmc` (local `.env.local` points here) |
| Local dev | `pnpm next dev -p 3420` |

**Deploying is MANUAL.** `git push` does **not** deploy — the Vercel project has no
linked Git repo. Ship with `npx vercel@latest --prod --yes`. (Connecting Git is
Brayson's call: it would make every push to this branch auto-deploy.)

Local dev login: `mitch-local@keyplayershq.com` on the TEST db, tenant
`1a73015e-0b59-4a47-992c-07a0856da8aa`. Postgres role `local_dev` (BYPASSRLS) — all
Vercel env vars are write-only, so secrets can't be pulled back.

**Working rule Mitch set:** this is live and all clients are on it — confirm before
changes, visual/UX only unless agreed, never break functionality.

---

## 2. Shipped (every tag is a rollback point, newest first)

| Tag | What |
|---|---|
| `contacts-v1` | **/api/crm was 500ing for every tenant** (`pause_outreach = 0` vs a Postgres boolean) — fixed. Plus "Needs attention": owed a reply / this week / gone quiet |
| `vocab-and-recs-v1` | Plain-English sweep (Cron Jobs→Scheduled work, Compacted memory→Summarised history, All Tiers→All priorities…) + agent recommendations panel |
| `explainers-v1` | On-page What/When/Example guidance, 9 → 15 pages |
| `business-setup-v1` | `/business-setup` — 6-step wizard, saved per step, writes to Founder Profile + playbook |
| `graph-motion-v1` | Draggable nodes, richer inspector, layered ambient motion |
| `backlog-fixes-v1` | `lite` preset was hiding the core; mobile nav had **no** per-tenant gating |
| `org-chart-v1` | `/org-chart` — founder → EA → orchestrator → departments |
| `second-brain-graph-v3` | Pan/zoom, whole Command Centre in the graph, selection reflected below |
| `second-brain-graph-v2` | Camera travel, hover-grow, continuous drill |
| `second-brain-graph-v1` | Graph rebuilt from the ORG; force-simulation removed |
| `second-brain-phase1-2` | Core instrument + page renamed to match the nav |
| `how-it-works-v1` | `/how-it-works` — role-aware, chat-first guide |
| `personal-agent-tools-v1` | Agents can read/record personal life from chat |
| `founder-profile-v1` | Founder Profile, injected into **every** agent prompt |
| `personal-life-v2` | Lead time ("act by") + occurrence/gift history |
| `personal-life-v1` | Personal Life built (migrations 0059, 0060) |
| `nav-six-sections-v1` | Nav restructured to the six North Star sections |
| `pre-nav-six-sections` | **state before any of this** |

Untagged: `/docs` unlocked for the one prod tenant that had it off; Overview default
trimmed 14 widgets → 7.

---

## 3. ⚠️ The thing that matters most

**0 of 14 production workspaces have a Founder Profile filled in.**

The profile is injected into every agent prompt, and the org chart + graph centre node
read from it. So today, in production: agents don't know who they work for, the org
chart says "Founder"/"Executive Assistant" instead of names.

`/business-setup` is the fix and it's live. **This is a Client Success action, not a
code one** — someone has to walk a workspace through it. Worth more than anything
left on the build list.

Related data gaps: **35 of 231 agents have no department** (they pile into "General"
on the org chart and graph — the recommendations panel now surfaces this).

---

## 4. Still to do, in priority order

1. **Templates** — Part C of the spec. Brayson's **22 industry niches** (in
   `agent_library.default_niches`) are the base, presented like the spec's cards.
   Needs **220 agent names written** (11 × 5 pillars × 4 agents). Decision already
   made: applying a template should be an operator-only action with confirmation,
   since `agent_library` + `scripts/provision-demo-client.ts` already do provisioning.
2. **Second Brain** — remaining from `plans/second-brain-graph-templates.md`:
   angular-sector level-of-detail (prod has 656 knowledge entities; currently a crude
   cap of 18/hub), synapse sparks, idle throttling.
3. **Overview** — trimmed to 7 widgets but never rebuilt around the actual question,
   "what does the founder need from me today?"
4. **Briefings** — vocabulary fixed, but no assistant-first view the way Contacts got
   "Needs attention".
5. **Explainers** — 15 of 52 pages.

**Open questions / not scoped:** Meetings and Learning have no list data (needs
backend before any UI); the reference's Neural view / Fullscreen / LENS filters /
Directory sidebar don't exist; light-vs-dark parked (app defaults light, onboarding
wizard is hard-dark).

---

## 5. Things that will bite you

- **Adding an agent tool needs SIX wiring points** — `orchestrator.ts` (import,
  buildTools defs, `CLIENT_TOOL_NAMES`, dispatch) + `subagent.ts` (import, defs,
  filter, dispatch). Missing `CLIENT_TOOL_NAMES` fails **silently** as "Orchestrator
  produced no text reply". Grep-verify all six. Also add a prompt-awareness block —
  the model won't reach for a tool it hasn't been told exists.
- **Three nav sources must stay in step**: `nav-rail.tsx`, `mobile-nav.tsx`,
  `command-center-catalog.ts` (which drives the Settings toggle panel).
- **Never change a nav href.** The per-tenant enabled-views map is keyed by href.
- **Any lib importing `./db/client` must not be value-imported from a client
  component** — it drags the Postgres driver into the browser bundle. Hence the
  `*-catalog.ts` (pure) / `*.ts` (server) splits. **tsc will not catch this.**
- **Stale Turbopack CSS**: if a `globals.css` change appears to do nothing, check
  `.next` for the rule; `rm -rf .next` fixes it.
- **Client components render nothing to curl** — content hydrates. Verify UI in a
  browser, not with `curl | grep`.
- **eslint baseline is 121 problems (41 errors, 80 warnings).** Keep parity; if it
  rises, you added one. Most are a pre-existing setState-in-effect pattern.
- **Don't read the clock during render** (impure) or set it from an effect
  (cascading render) — use `useSyncExternalStore` with a null server snapshot, or SSR
  and the client disagree on what's "overdue".
- `Lead.pause_outreach` is typed `number` while the column is `boolean` — the same
  confusion that caused the /api/crm 500. Worth aligning with Brayson.
