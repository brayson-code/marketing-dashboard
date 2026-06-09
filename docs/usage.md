# Usage & Spend

The **Usage** page shows what your agents cost — across the AI that powers them and the outside services they use. Because your connections are your own keys, these are your *real* numbers.

![the Usage page with spend cards and the daily chart](images/usage-1.png)

---

## What it is

Usage tracks two things:

- **Claude API consumption** — the tokens and cost from KeyPlayer and all your sub-agents, charted over time and broken down by agent.
- **Spend across services** — three meters showing what you're spending with Claude, **Apify** (competitor scraping), and **Deepgram** (transcription).

It updates frequently (the token data refreshes every few seconds), so it's always current.

## Why it matters

AI agents do real work, and real work has a cost. Usage keeps that cost visible and attributable, so you can see which agents are expensive, whether a feature is worth its spend, and how much headroom you have on your connected services.

---

## How to use it

1. Open **Usage** from the left navigation.
2. Choose a **time range** (7, 14, 30, or 90 days) at the top.
3. Read the three **Spend** cards:
   - **Claude** — your AI cost and total tokens.
   - **Apify** — your competitor-scraping spend and plan (or "not connected").
   - **Deepgram** — your transcription credit and usage.
4. Scroll to the **charts**:
   - A daily series of tokens and cost over your selected range.
   - A **per-agent breakdown** — which agents are doing the most work and costing the most.

![the per-agent usage breakdown](images/usage-2.png)

---

## Good to know

- **The numbers come from your own accounts.** Apify and Deepgram are read directly from your accounts on those services, so they match your real bills. Scraping and transcribing don't consume Claude tokens — those are separate vendors.
- **A condensed spend strip also lives on your [Overview](./overview.md)** so cost stays visible without a detour.

---

## Tips

- **Watch the per-agent breakdown** to spot a runaway agent. If one specialist dominates your spend, consider switching it to a cheaper model in the [Agent Studio](./agents.md).
- **Use the time-range buttons** to compare a quiet week against a busy one and understand what drives your costs.
- **"Not connected" on Apify or Deepgram is normal** if you haven't added those keys — connect them on the [Connections page](./connections.md) when you need the features they power.
