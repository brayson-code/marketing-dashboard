# Usage & Spend

The **Usage** page shows what your agents cost — across the AI that powers them and the outside services they use. Because your connections are your own keys, these are your *real* numbers. You can also set a **daily token budget** to make sure a busy day of agent work doesn't quietly overshoot what you want to spend.

![the Usage page with spend cards and the daily chart](images/usage-1.png)

---

## What it is

Usage tracks two things:

- **Claude API consumption** — the tokens and cost from KeyPlayer and all your sub-agents, charted over time and broken down by agent.
- **Spend across services** — meters showing what you're spending with Claude, **Apify** (competitor scraping), and **Deepgram** (transcription).

It updates frequently (the token data refreshes every few seconds), so it's always current.

## Why it matters

AI agents do real work, and real work has a cost. Usage keeps that cost visible and attributable, so you can see which agents are expensive, whether a feature is worth its spend, and how much headroom you have on your connected services.

---

## How to use it

1. Open **Usage** from the left navigation.
2. Choose a **time range** (7, 14, 30, or 90 days) at the top.
3. Read the **Spend** cards:
   - **Claude** — your AI cost and total tokens.
   - **Apify** — your competitor-scraping spend and plan (or "not connected").
   - **Deepgram** — your transcription credit and usage.
4. Scroll to the **charts**:
   - A daily series of tokens and cost over your selected range.
   - A **per-agent breakdown** — which agents are doing the most work and costing the most.

![the per-agent usage breakdown](images/usage-2.png)

---

## Daily token budget (usage cap)

You can set a **daily token budget** in Settings to put a ceiling on how many Claude tokens your workspace uses each day.

**How it works:**

- When your agents hit the daily cap, **new agent work pauses** — no new missions start, no new scheduled jobs fire, no new autonomous runs begin.
- **Anything already running finishes.** Mid-run work is never cut off mid-stream; the cap only blocks new starts.
- **Paused missions resume the next day** (when the counter resets), or immediately if you raise the cap during the day.
- **Your interactive chat with your lead agent is not capped.** The budget only applies to autonomous agent runs, not to conversations you're actively in.

To set or adjust the cap:

1. Open **Settings**.
2. Find **Daily token budget** (or **Usage cap**).
3. Enter a token limit and save.

Leave it blank if you don't want a cap.

---

## Good to know

- **The numbers come from your own accounts.** Apify and Deepgram are read directly from your accounts on those services, so they match your real bills. Scraping and transcribing don't consume Claude tokens — those are separate vendors.
- **A condensed spend strip also lives on your [Overview](./overview.md)** so cost stays visible without a detour.

---

## Tips

- **Watch the per-agent breakdown** to spot a runaway agent. If one specialist dominates your spend, consider switching it to a cheaper model in the [Agent Studio](./agents.md).
- **Set a daily cap before launching missions or heavy cron schedules.** It's a safety net, not a straitjacket — you can raise it anytime.
- **Use the time-range buttons** to compare a quiet week against a busy one and understand what drives your costs.
- **"Not connected" on Apify or Deepgram is normal** if you haven't added those keys — connect them on the [Connections page](./connections.md) when you need the features they power.
