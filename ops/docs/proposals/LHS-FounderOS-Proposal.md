# FounderOS

## A Unified Operating Platform for Lost Horizon Spirits

**Prepared for Robert DeLeon & the Lost Horizon Spirits team**

KeyBuild by KeyPlayers

July 2026

---

## Executive Summary

Three Hearts Rum has come a long way in sixteen months: a 27-person company, direct-to-consumer across the three-tier system, launches behind you and a UK expansion ahead. But the business runs on four disconnected systems, and every decision waits on someone stitching them together by hand.

Your ledger lives in QuickBooks, where Tony has 35 years of command but no way to get a live answer in seconds. Logistics live in Excel, which Bobby named as the single biggest bottleneck, tracking a supply chain that runs from Barbados to the Dominican Republic to China. Supplier and customer conversation moves through a high-volume Gmail inbox. And the Park Street importer dashboard, where key supply-chain data sits, is hard to navigate.

FounderOS replaces that stitching with one screen. One place to see dry-goods inventory (corks, labels, shrink wraps, tax stamps) in real time. One place that warns you a reorder point is coming, and flags a delayed shipment the day it slips. And because Bobby asked for it directly, one place you can simply text a question to — "how many SKUs do we have," "where is this shipment" — and get an answer back.

Two principles run through the entire build. First, it is honest about your fractional-CFO transition and de-risks it: the system captures the operating knowledge that would otherwise walk out the door. Second, and most important given Tony's concern, FounderOS is read-only. It reads from your systems to give you visibility; it cannot write to them, act on them, or change a number. It shows you the business. It never runs it.

This document lays out what we heard, direct answers to every concern your team raised, and a three-phase build so value lands early.

---

## What We Heard

We built this proposal around the bottlenecks Bobby and the team walked us through.

**QuickBooks — no answer in seconds.** Tony has 35 years in QuickBooks and the books are in good order, but a simple operating question — how much have we paid the filing agent in China, what is still outstanding, how much longer — means digging by hand. The data is there; the speed is not. With the fractional CFO transition underway, that speed matters more, not less.

**Excel logistics — the major bottleneck.** Your supply chain spans continents: labels moving Barbados to the Dominican Republic, tax-stamp and shoulder labels, shrink wraps out of China, corks, and co-packer timing that has to line up. It is all tracked in spreadsheets with no reorder-point warning, no delay flag, and no safety net if a cell gets overwritten. This is the pain that surfaced most.

**Gmail — high volume.** Critical supplier and customer threads move through a busy inbox. Important signals get buried, and there is no structured way to turn email into action or authenticated outbound at scale.

**Park Street — hard to navigate.** Your importer holds essential supply-chain data, and their dashboard is difficult to work in. A public API appears to exist, but its real utility is unproven. You need this data surfaced where your team already works.

**Four platforms, no single view.** Underneath all of it is Bobby's core ask: stop living in four systems. One screen for the whole business, and the ability to ask it a question in plain language.

---

## Your Concerns, Addressed

Your team is sophisticated — a CFO with three and a half decades of experience, a founding Google business executive, an AI-fund principal, and counsel who is a leading AI attorney. The concerns you raised were precise, and they deserve precise answers. Here they are.

### The dashboard is read-only. It cannot act on your systems.

Tony put the fear plainly: if an assistant held all the logins and something went wrong, "was I there or not?" That is exactly the right question, and our answer is architectural, not reassuring words.

FounderOS has no write functions. It reads from QuickBooks, your logistics data, your e-commerce platforms, and your bank feed to show you everything in one place. It cannot place an order, move money, change a ledger entry, or take any action on your systems. There is no keystroke it can make on your behalf because the capability does not exist in the software. This was committed to on our first call, and it is committed to here in writing.

That single design choice removes the entire class of risk Tony described. The system cannot impersonate anyone because it cannot act as anyone.

### "Was I there or not?" — answered definitively

Where humans are involved, every action is attributed to a named identity and written to an immutable audit log: who did what, and when. The log is append-only; it cannot be edited or deleted after the fact. If a question ever arises about who touched something, the answer is not a guess — it is a record. Where VAs assist, their activity is tracked the same way, with attendance and activity logs, so "was I there or not?" always has a definitive answer.

### Investor-grade security

For Tony, your Google and AI-fund investors, and your counsel, here is the architecture in precise terms. Each of these controls is already running in production on our platform today; none is a promise or a roadmap item.

- **Row-level security.** Access is enforced at the row level inside the database itself, below the application. A user only ever sees the rows they are entitled to, even if application code has a bug. It cannot be bypassed by the app.
- **Attribute-based access control.** Permissions are decided by who someone is and what they are trying to do, not a blunt role label. Access is granted precisely, and nothing more.
- **Immutable audit logs.** Every change is recorded in an append-only log attributed to a named identity. The record cannot be altered after the fact.
- **Instant credential revocation.** Access is revoked from the dashboard and takes effect immediately — no waiting period, no lingering session.
- **Encrypted at rest and in transit.** Your data is encrypted both where it is stored and as it moves.

On SOC 2: the platform is built on a SOC 2-ready architecture, meaning the technical controls a SOC 2 audit examines are already in place. SOC 2 itself is a formal third-party audit. We have designed the system to support that audit when you choose to pursue one; the remaining work is documentation and process, not re-engineering. We speak to our architecture, not to comparisons — the controls above are what your team can evaluate on their merits.

### "Excel has no safety net"

A shared spreadsheet has no record of who changed what, no way to limit who can touch which numbers, and no way to recover a clean version after a bad edit. FounderOS replaces that with a real database where every change is captured in the audit trail and access is governed by role. One person can hold full logistics control, another read-only visibility, and no number can be silently overwritten. And because the operating knowledge lives in the system rather than in one person's head, the "hit by a bus" question — what happens if a key person is suddenly gone — finally has a real answer.

### Integration risk

Moving onto a new platform should never put your books at risk. The read-only design is the guarantee: our QuickBooks integration only ever reads. We cannot write to it, edit it, or corrupt it. Your financial source of truth stays exactly where it is. And we deliver in phases, so each integration is proven before the next begins and the running business is never exposed to an all-at-once cutover.

### Email

Your outbound email will be properly authenticated. We configure DMARC, DKIM, and SPF — the three standards that prove your mail genuinely comes from Lost Horizon Spirits. That keeps your messages out of spam, protects your domain from being spoofed, and gives you deliverability you can rely on as volume grows.

### Park Street

We will be straight rather than over-promise. Park Street appears to offer a public API, but its real utility is unproven until we test it directly. So the plan has two paths. First choice: if the API is usable, we integrate it and pull importer data automatically. Fallback: if it is not, we build a structured manual ingest so your Park Street data still lands in FounderOS in clean, queryable form. Either way the data ends up in one place. We will not promise an automated integration we have not verified.

### VA access

The optional AI-assisted executive assistants ride the same controls as everyone else — and the same read-only boundary. Each VA gets scoped permissions: precisely the functions they need and nothing more. Their activity is logged and attributed. And you can revoke any VA's access with one click from the dashboard, effective immediately. A VA is never a hole in your security model; it is a governed, tracked role inside it.

---

## The Build, Phased

We deliver in three phases so the biggest pain is relieved first and every integration is proven before we build on it.

### Phase 1 — Foundation

The secure single-screen platform and the logistics fix, which is your most urgent bottleneck.

- Secure FounderOS platform with row-level security, attribute-based access control, immutable audit logs, encryption, and role-based access
- The single-screen view Bobby asked for: the whole business on one dashboard, no more living in four platforms
- Your Excel logistics migrated into a real, queryable database
- Automated reorder-point alerts on dry goods (corks, labels, tax stamps, shrink wraps)
- Proactive shipment-delay alerts with actionable guidance (for example, "break up the shipment — fly the first 50,000" when Panama Canal delays hit)
- A queryable vendor roster: names, numbers, and emails returned in a single ask

**Timeline: [TIMELINE]**

### Phase 2 — Integrations & Query

Connect the rest of your systems and make the whole thing answerable in plain language.

- QuickBooks read-only integration — answers like "how much have we paid the filing agent in China, what's outstanding, how long remaining" in seconds, plus support for monthly-close anomaly review
- The text-message assistant Bobby asked for: query the same data by plain language ("how many SKUs," "where is this shipment"), read-only over one source of truth
- Shopify and BottleNexus e-commerce integration
- Plaid banking integration
- Park Street importer data (public API if viable; structured manual ingest as fallback)

**Timeline: [TIMELINE]**

### Phase 3 — Communications & Leverage

Turn the platform into an operating advantage.

- Authenticated email sending with DMARC, DKIM, and SPF configured
- Optional AI-assisted executive assistants with scoped, logged, one-click-revocable access
- Structured workflows that turn inbox volume into tracked action

**Timeline: [TIMELINE]**

---

## Deliverables Summary

| Area | Deliverable | Phase |
|---|---|---|
| Platform | Secure single-screen FounderOS (RLS, ABAC, audit logs, encryption, RBAC) | Phase 1 |
| Logistics | Excel migrated to queryable database | Phase 1 |
| Logistics | Reorder-point + proactive shipment-delay alerts | Phase 1 |
| Logistics | Queryable vendor roster (names / numbers / emails) | Phase 1 |
| Financials | QuickBooks read-only integration (answers in seconds) | Phase 2 |
| Query | Plain-language / text-message assistant (read-only) | Phase 2 |
| E-commerce | Shopify + BottleNexus integration | Phase 2 |
| Payments | Plaid banking integration | Phase 2 |
| Supply chain | Park Street data (API or structured ingest) | Phase 2 |
| Email | Authenticated sending (DMARC/DKIM/SPF) | Phase 3 |
| VAs | Optional AI assistants, scoped, logged, revocable | Phase 3 |

---

## Investment

**[PRICE / STRUCTURE]**

*Note for the owner (replace before sending): anchor from call 1 was $20–25k for the custom build. VA subscription is separate — $19.97 half-time / $32.97 full-time, with $500 off each additional. Confirm final structure here.*

---

## Next Steps

We have three touchpoints with your team, and this proposal is built to arm the security walkthrough.

- **CTO security walkthrough — Thursday, 12:00 PM PT** (Jada scheduling): a technical deep-dive for Tony and your investors on the architecture above
- **Marketing strategy call — Sunday, July 12, 1:00 PM PT** (Robert, Tony, Jackson, Easton, Jada)
- **VA onboarding call — Wednesday, July 15, 12:00 PM PT** (same group)

To move forward with the FounderOS build as scoped above, sign below.

<br/>

Accepted for Lost Horizon Spirits:

Signature: _______________________________  Date: _______________

Robert DeLeon

<br/>

KeyBuild by KeyPlayers
