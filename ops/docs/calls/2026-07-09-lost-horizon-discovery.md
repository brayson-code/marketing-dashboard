# Call ingest — Robert DeLeon x KeyBuild | Discovery — 2026-07-09

Recording: https://fathom.video/share/zxKDcyahKhrD_sN67f7zGDw3892_Vsm3
Prospect: **Lost Horizon Spirits (LHS)** — spirits brand, global supply chain (Portugal, Barbados…), importer = Park Street.
Offering: **KeyBuild** custom "FounderOS" dashboard (custom build track, distinct from KeyCommand's templated $7k).
Stakeholders: Robert (principal), Jada, Tony, Easton, Jackson; investors incl. Tony, Steve, Greg (tech-savvy — security matters to the close).

## Problem (their words)
- Siloed data: financials (DataRails — manual pulls), logistics in Excel (major bottleneck), high-volume Gmail, Park Street importer dashboard hard to navigate (public API exists, utility unknown).
- Want: real-time visibility into dry-goods inventory (corks, labels), automated reorder-point + shipment-delay alerts, faster decisions.

## Scope — FounderOS dashboard
| Area | Requirement | Platform status |
|---|---|---|
| Financials | DataRails read-only API integration | NEW build |
| Logistics | Excel sheets → queryable DB + reorder/delay alerts | NEW build (migration + alerting; cron infra exists) |
| E-commerce | Shopify + BottleNexus | NEW build (Shopify std API) |
| Payments | Plaid | NEW build |
| Email | Custom email solution incl. DMARC/DKIM/SPF | Partial (AgentMail exists; deliverability setup NEW) |
| UX | Simple UI + RBAC | EXISTS (roles/members) |
| Security | RLS, ABAC, JWT revocation, audit logs, SOC 2-ready architecture | **EXISTS** — RLS on all tables, ABAC design (adr-001), audit_log, security_events; SOC 2 readiness = documentation work |
| VAs (optional) | AI-powered exec assistants, limited access, instant revoke | EXISTS (VA role + ABAC + revocation) |
| Park Street | Importer data | INVESTIGATE their public API |

## Booked follow-ups
- Marketing strategy call: **Sun Jul 12, 1 PM PT** (Robert + Tony, Jackson, Easton, Jada)
- VA onboarding call: **Wed Jul 15, 12 PM PT** (same group)

## Action items (owner: Mitch/Brayson)
1. Email Robert wrap-up + pricing/economics; cc Tony, Jackson, Easton, Jada ([context clip](https://fathom.video/share/zxKDcyahKhrD_sN67f7zGDw3892_Vsm3?timestamp=3272.9999))
2. Schedule the marketing call (Sun 1 PM PT) ([clip](https://fathom.video/share/zxKDcyahKhrD_sN67f7zGDw3892_Vsm3?timestamp=3629.9999))
3. Schedule the VA onboarding call (Wed 12 PM PT) ([clip](https://fathom.video/share/zxKDcyahKhrD_sN67f7zGDw3892_Vsm3?timestamp=3815.9999))

## Draft wrap-up email (edit price + send)
Subject: FounderOS — wrap-up, scope & economics

Robert — great conversation today. What we heard: LHS runs on siloed systems (DataRails, Excel logistics, Gmail, Park Street) and decisions wait on manual data pulls. What we're building: FounderOS — one dashboard that centralizes financials (DataRails, read-only), logistics (your Excel moved into a real database with reorder-point and shipment-delay alerts), Shopify/BottleNexus, and Plaid — with a clean, role-based interface anyone on the team can use.

On security, since Tony, Steve, and Greg will ask: the platform ships with row-level security, attribute-based access control, instant credential revocation, and full audit logs on every data change — architected to support a SOC 2 audit when you're ready for one. The optional AI executive assistants ride the same controls: scoped access, revocable from the dashboard in one click.

Economics: [PRICE / STRUCTURE].

Next: marketing strategy Sunday 7/12 at 1 PM PT, VA onboarding Wednesday 7/15 at 12 PM PT — invites to follow.

— Mitch

## Ingest-system note
Source of truth for calls = **Fathom** (this doc came from a pasted Fathom summary). P2 of call ingestion = Fathom API auto-pull → this pipeline (doc + memory + action extraction) with zero pasting.
