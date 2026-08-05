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
| `leave-requests-v1` | Assistant requests time off, client approves, KeyPlayers has the record. Probation leave is marked **unpaid**, not refused. Working days counted against the assistant's own schedule. Migration **0064**, 13 tests |
| `roster-at-activation-v1` | Every workspace card + the activation confirm now say what the client will actually find: "16 agents, none tuned to their industry" |
| `daily-brief-v1` | **Role-aware "what needs doing today" on Overview.** Founder sees approvals + overdue; assistant additionally sees decay and personal act-by dates. Renders nothing when there's nothing. No new storage. 10 tests |
| `operator-audit-v1` | "What we've done" in Portal Admin — every operator action as a sentence, failures first. Fetched on click, prefix-matched so new actions appear automatically |
| `export-completeness-v1` | **The client export was missing 37 tenant-scoped tables** while promising "everything". Inverted to runtime discovery minus a named deny-list; withheld tables listed with reasons. 706KB → 731KB |
| `day-one-clarity-v1` | **Two mislabels fixed:** nav "Files" actually opened Agent Studio (a prompt editor) — renamed + moved to Your AI Team; `/memory` said "Reports" while the nav said "Briefings". Plus explainers on the 7 day-one pages, 18 → 25 of 71 |
| `capture-extract-v1` | Paste onboarding call notes → drafts the capture form. Drafts only, never saves; told not to infer approval limits. ⚠️ Needs a working Anthropic key |
| `readiness-v1` | Per-workspace day-one checklist in Portal Admin. "Open" deliberately does NOT count as ready. Sorts live-and-unfinished first. 8 tests |
| `second-brain-browse-v1` | Focusing an area hub lists **everything** in it with a filter, not just the 18 drawn. Fixed in the inspector, not the layout — the cap stays |
| `portal-assistant-view-v1` | `/portal` reads differently for the assistant: their hours, their leave, who they support. "Need another person?" hidden; announcements filtered by audience |
| `operators-v1` | Portal Admin manages the operator allow-list + provisions operator logins (own workspace, not HQ). Carl + Pow added |
| `operator-access-v1` | **Two tiers of gate.** `requireHq()` = engineering (Issues, Security). `requireOperator()` = running the business (Portal Admin, Templates) — HQ **or** the `platform_operators` allow-list, so Client Success reaches it from their own workspace. Both pages now server-gate with `notFound()`. Migration **0063** |
| `first-run-v1` | **Role-aware landing.** Client gets "check what we wrote"/"your AI team doesn't know you yet"; assistant gets "things to ask Dana" with the actual questions. Renders nothing once essentials are answered. 9 tests |
| `prep-mode-v1` | **Assistant reads before day one, cannot act.** `prep_until` on the JWT, enforced in the middleware (reads pass, writes 403) so it works on the Edge and regardless of AUTHZ_ENFORCE. Day one clears it. 9 tests |
| `onboarding-capture-v1` | **Client Success captures the call**, writing the founder profile + playbook for that workspace. `/business-setup` then reads "we filled this in, correct anything wrong" instead of showing a blank form. The fix for 0-of-14 |
| `lifecycle-v1` | **Provisioning separated from access.** Workspace states provisioned/active/paused/offboarded; enforcement is the AUTH ROWS (no user = no way in), not a request filter. `/api/lifecycle` + controls in `/portal-admin`. Migration **0062**, 10 tests |
| `portal-v1` | `/portal` "Your KeyPlayers" — client-facing service page (assistant, hours, leave accrual, holidays, support, request-a-person, events). `/portal-admin` HQ editor. Migration **0061**. Policy in `src/lib/service-policy.ts`, 9 tests |
| `templates-overlay-v1` | 22 → 32 industries via `niche-overlay.ts` (survives Brayson's reseeds) |
| `templates-preview-v1` | `/templates` — HQ-only, **read-only** preview of the 22 industry rosters in `agent_library`, with a per-workspace gap view. No write path exists. Phase 1 of `plans/niche-templates.md` |
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

## 3. ⚠️ The thing that matters most — production is empty

Measured in prod 2026-08-05, across all 14 workspaces:

| What | Count | Means |
|---|---|---|
| Workspaces | 14 | |
| **Founder Profiles filled in** | **0** | Agents don't know who they work for |
| **Business Setup completed** | **1** | The wizard is live and unused |
| **Personal Life items** | **1** (total, all workspaces) | The section is empty everywhere |
| Contacts | 11, in **2 of 14** workspaces | 12 workspaces show "no contacts" |
| Second Brain entities | 656, in **7 of 14** | ← the ONE surface with real usage |
| Briefings/documents | 22 | |
| Agents with no department | **35 of 231** | Pile into "General" on the org chart |

**Read that again before building anything else.** Six shipped features are inert not
because they're broken but because nothing has been entered into them. The Second Brain
is the only surface clients actually populate.

So the highest-value work is almost certainly NOT more features — it's getting one
real workspace fully set up end to end and finding out what breaks. That's a Client
Success action, not a code one, and it beats everything in §4.

---

## 3a. ⚠️ The HQ Anthropic key is being REJECTED

Found 2026-08-05 by running the capture extractor: the key connected to the KeyPlayers
HQ workspace returns `401 authentication_error`. Connected 2026-06-24, last updated
2026-07-16. **This breaks every Claude feature for HQ**, not just the extractor —
agents, briefs, the boardroom chat. Fix in Connections → Anthropic.

Client workspaces BYO their own key (`anthropic-key.ts`), so this is HQ-specific — but
8 of 14 workspaces have a connected key and none have been tested.

## 3b. Open questions for Brayson (not ours to decide)

- **`AUTHZ_ENFORCE` defaults to `'off'`**, which makes every `requireApi*` role gate a
  no-op. Member/VA roles restrict nothing unless it's set. Vercel env vars are
  write-only so this can't be read from here — worth confirming.
- **Git is not connected** to the Vercel project; deploys are manual CLI. Connecting it
  would auto-deploy his pushes.
- **Two sources of truth for industries** now: his `niche-config.json` and our
  `niche-overlay.ts`. Should be folded into one.
- **`Lead.pause_outreach` is typed `number`, the column is `boolean`** — the same
  confusion that 500'd `/api/crm` for every tenant.
- **Meetings and Learning have no list data.** No UI work is possible until there's a
  backend.
- **No EA has a login.** All 13 workspace members in production are `owner` — zero `va`,
  zero `member`. The North Star says the assistant is the primary user; today not one
  can sign in. Bigger than any single page, and `/portal` makes it obvious.

## 4. Still to do, in priority order

1. **Templates** — Phase 1 SHIPPED (`templates-preview-v1`). See
   `plans/niche-templates.md`. Correction to an earlier note here: templates needed
   **no agent authoring at all** — Brayson deduped 110 near-duplicate niche agents into
   15 rich archetypes in July, and they are already in prod. Next: Mitch judges the
   roster quality (Phase 2), then apply (Phase 3, needs its own sign-off — it is the
   first feature that writes agent config into a live client workspace, and
   `agent_defs` RLS blocks cross-tenant writes by design).
2. ~~Second Brain browse~~ — SHIPPED `second-brain-browse-v1`. Remaining polish only:
   synapse sparks, idle throttling. Original item: the only surface with real data (656 entities across 7
   workspaces), so polish here is the only polish anyone will actually see. Remaining
   from `plans/second-brain-graph-templates.md`: angular-sector level-of-detail
   (currently a crude cap of 18/hub, which visibly lies at 656), synapse sparks,
   idle throttling.
3. **Explainers — 25 of 71 pages.** The day-one path is now covered; the rest are
   secondary surfaces. Original note: Worse coverage than previously recorded. 53 pages
   still have no on-page guidance at all.
4. **Overview** — trimmed to 7 widgets but never rebuilt around the actual question,
   "what does the founder need from me today?"
5. **Briefings** — vocabulary fixed, but no assistant-first view the way Contacts got
   "Needs attention".
6. **Portal follow-ups** — the GHL support booking link (Mitch is making it; until then
   the card offers email); Client Success needs to fill in `/portal-admin` per workspace
   or every client sees "Not set up yet"; 2027 holiday dates need adding each December.

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
- **Operator surfaces are `requireOperator()`, NOT `requireHq()`.** Only mitch@ and
  brayson@ are in the HQ workspace; Olivia and Client Success sit in their own. Add
  people via `platform_operators` (email keyed), never by adding them to HQ — there is no
  workspace switcher, so a second membership does not change where they land.
- **⚠️ A CHILD server component renders OUTSIDE the page's AsyncLocalStorage scope.**
  `enterTenant()` is called in the page body; a child calling `tenantId()` silently gets
  `DEFAULT_TENANT_ID` (HQ) and a child calling `getSubject()` silently gets the
  least-privilege subject. **Neither throws.** Resolve anything tenant-scoped in the page
  and pass it down. This nearly shipped HQ's founder profile to every client.
- **`subject.role === 'va'` is also the fail-closed default for a NON-member.** Gate any
  assistant-specific UI on `subject.isMember` too.
- **Inserting JSX by regex is how you get valid code in the wrong place.** Two passes at
  adding explainers put one inside a `PageHeader` `actions` prop and five inside helper
  components at the bottom of the file. **Both passed tsc.** Anchor on a verified line
  and assert on it, or hand-place.
- **Client components render nothing to curl** — content hydrates. Verify UI in a
  browser, not with `curl | grep`.
- **eslint baseline is 121 problems (41 errors, 80 warnings).** Keep parity; if it
  rises, you added one. Most are a pre-existing setState-in-effect pattern.
- **Don't read the clock during render** (impure) or set it from an effect
  (cascading render) — use `useSyncExternalStore` with a null server snapshot, or SSR
  and the client disagree on what's "overdue".
- `Lead.pause_outreach` is typed `number` while the column is `boolean` — the same
  confusion that caused the /api/crm 500. Worth aligning with Brayson.
