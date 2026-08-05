# Niche Templates — roadmap

> Agreed with Mitch 2026-08-05. Start preview-only, no writes.
> Companion: `plans/STATE.md` (overall redesign state).

---

## The finding this is built on

Brayson built a complete niche-agent library. **Production uses none of it.**

- `public.agent_library` (migration `0058`) holds **71 global rows**, including **15 rich
  archetypes** covering **22 industries** — full prompt bodies (soul ~1.8KB, behaviour
  ~3.2KB, playbooks ~3KB each), `default_niches` slugs, and `alias:<name>` tags.
- **All 14 production workspaces have 0 archetype agents.** Every workspace carries the
  same generic 16–18 agents copied from the HQ tenant. Teresa's, Brian's, Gabe's — byte
  for byte the same roster.
- `src/lib/agent-library.ts` is a finished, typed read API (filter by niche/category,
  search, list vs full row). **It has zero callers.** The code calls its intended
  consumer "the sales console"; that console was never built.

So this is not authoring work and not a content gap. The engine exists and is switched
off. The missing piece is the surface a human uses.

**We do NOT need the `keycommand-provisioning` sibling repo.** It is the *authoring*
side; the seeded output is already in prod. It is only needed to change the source niche
data, which is not in scope. (`resolveNicheSlugsByName()` lives there and matters to
their CLI pipeline, not to a console that reads `agent_library` directly.)

### The 22 industries
accounting · auto_dealership · beverage · coaching · concierge_medicine · construction ·
dental · financial_advisors · fitness · hvac · insurance · landscaping · med_spa ·
mortgage · personal_injury_law · property_mgmt · real_estate · restaurants · roofing ·
solar · staffing · vending

### The 15 archetypes (by reach)
Appointment Scheduler (19 niches) · Follow-up Chaser (16) · Speed-to-Lead Responder (15) ·
Dead-Lead Reactivator (11) · Owner-Report Builder (7) · Renewal Nurturer (5) ·
Research Scout (4) · Document & Records Organizer (3) · Review Generator (3) ·
Referral Nurturer (3) · Invoice & AR Chaser (2) · No-Show Filler (2) ·
Upsell & Reorder Prompter (2) · Estimate & Proposal Drafter (2) · Ops Monitor & Alerter (1)

---

## Why this over the rest of the backlog

The pitch is "AI trained on your business." Today every client receives an identical
generic roster. That is the product claim not being delivered, and it is the exact axis
we counter-position on versus commodity staffing. The content to fix it is already
written and already paid for.

It also shares a moment with the Founder Profile problem (0 of 14 workspaces filled in):
both are things a Client Success person needs while they have a client's workspace open.
Same person, same session — so they should end up on the same surface (Phase 4).

---

## Phase 1 — Preview only. No writes. **← start here**

Goal: see exactly what a client in industry X would get, before anyone can apply it.
Zero risk by construction: nothing in this phase writes to any table.

1. **Route + gate.** New page, HQ-tenant only, using the `isHq` check
   (`subject.ts:85`, `tid === DEFAULT_TENANT_ID`) — NOT the `requireApi*` helpers, which
   are no-ops while `AUTHZ_ENFORCE` is `'off'`. Follow the established pattern of a hard
   403 independent of that flag (see `api/invite`, `api/approvals/pending`).
   Non-HQ tenants must not see the nav entry or reach the route.
2. **Niche list.** Derive the 22 industries from
   `select distinct unnest(default_niches) from agent_library` — read from data, never a
   hardcoded list that can drift from the catalogue.
3. **Human-readable names.** Slugs (`personal_injury_law`) are not client-facing copy.
   Needs a display map. Check the `alias:` tags first; author the map only for what
   isn't derivable, and keep it pure.
4. **Roster view.** Pick an industry → the agents that industry pre-selects, each with
   its `does` line, category, and whether it's rich or thin.
5. **Agent detail.** Open one → the actual prompt bodies (soul / behaviour / playbooks).
   This is the part that lets Mitch judge quality rather than trust a count.
6. **Gap view.** Against a chosen workspace: what it has now vs what the industry
   template offers. Read-only diff. This is where "every client is missing all of it"
   stops being a claim in a doc and becomes a screen.

**Ship gate:** Mitch reads two or three rosters end to end and says the content is good.
If the archetypes read as generic filler, we stop and rewrite content instead of
building an apply button for material nobody wants.

---

## Phase 2 — Content judgement

Not a code phase. Read the archetypes against real clients. Likely outcomes:

- The rosters are good → straight to Phase 3.
- They're thin in places → author better bodies into `agent_library` (a seed change, no
  schema work).
- The niche→archetype mapping is wrong for some industry → fix `default_niches`.

Worth knowing now: 4 archetypes reach only 1–2 industries. Those are the least
battle-tested and the most likely to read as filler.

---

## Phase 3 — Apply. **The one that writes.** Needs explicit sign-off.

This is the first feature in the whole redesign that writes agent configuration into a
live client workspace. Treated accordingly.

The real obstacle, stated plainly: **`agent_defs` RLS is
`tenant_id in (select current_user_tenant_ids())`** (migration `0016`). An HQ operator
has no path to another tenant's agents. The app's backend role bypasses RLS and every
query is hard-scoped by `tenantId()` in app code — so cross-tenant writing is a new
capability being deliberately added, not a setting. That deserves its own design pass,
not a bolt-on.

Two options, decide at the time:
- **(a) Operator applies from HQ into a named tenant.** Best UX for Client Success, but
  it means a deliberate cross-tenant write path. Every call audit-logged with actor,
  target tenant, and exact agent ids.
- **(b) Apply runs inside the target workspace**, by whoever is legitimately in it
  (Client Success signs in during onboarding). No new cross-tenant capability at all.
  **Preferred unless (a) proves necessary** — it keeps the isolation model intact.

Rules regardless of option:
- **Additive only.** Never deletes or overwrites an existing agent. Skip on id collision.
- **Preview → confirm → apply.** The confirm screen names every agent being added.
- **Reversible.** Record what a given apply added so it can be undone.
- **Test database first**, full path, before prod touches anything.
- Materialise `agent_library` → `agent_defs`: id, name, role, description ← `does`,
  soul, agent_md, skills, department. Set `source` so applied rows are identifiable.

---

## Phase 4 — Fold into the Client Success flow

Join this to `/business-setup` so one session covers: founder profile → industry →
agent roster. That is the sequence that fixes both standing production gaps
(0/14 profiles, 0/14 niche rosters) in a single pass per client.

---

## Risks

| Risk | Handling |
|---|---|
| Cross-tenant write path becomes a general capability | Prefer Phase 3 option (b); if (a), scope it to this one operation and audit every call |
| Applied agents duplicate existing ones | Additive with id-collision skip; the gap view shows overlap before applying |
| Archetype content is weaker than it looks | Phase 2 gate exists precisely for this; do not build apply first |
| 35 of 231 agents already have no department | Templates should not add more — carry `department` through on materialise |
| Nav drift | Three sources must move together: `nav-rail.tsx`, `mobile-nav.tsx`, `command-center-catalog.ts`. Never change an href |
