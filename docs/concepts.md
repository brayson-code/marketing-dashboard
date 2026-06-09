# Concepts & Glossary

A short reference for the ideas and terms that show up across KeyCommand. Read this once and the rest of the app will make more sense.

---

## Agents

The AI **specialists** that do KeyCommand's work — researching, writing content, drafting outreach, analyzing reels, and more. Each agent has a defined voice, instructions, and set of tools, and runs on a chosen AI model. You manage them in the [Agent Studio](./agents.md).

## KeyPlayer (the orchestrator)

The **lead agent**. KeyPlayer takes your requests, plans the work, and dispatches the right specialists to carry it out. You talk to it in the [Boardroom](./boardroom.md). It's the one agent you interact with directly most of the time.

## Soul · Agent · Skills

The three plain-language fields that define any agent:

- **Soul** — its voice, values, and personality (how it *sounds*).
- **Agent** — its operating instructions (how it *works*).
- **Skills** — the tools and capabilities it can use.

Editing these in the [Agent Studio](./agents.md) changes how the agent behaves — live, no redeploy.

## Drafts

The **approval queue**. Anything an agent produces that could go out — a post, an email, a meeting, a script — is saved as a draft for you to approve, reject, or execute. Nothing ships without your sign-off (unless you raise autonomy). See [Drafts](./drafts.md).

## The autonomy gate

The setting that controls **how much agents can do on their own**, found on the **Autonomy** page. There are four levels:

- **Observe** — agents watch and learn but never produce drafts or send anything.
- **Propose** — agents draft everything for your one-tap approval. *(The safe default.)*
- **Act + Notify** — agents auto-run the draft types you specifically approve; the rest still wait as drafts.
- **Full Auto** — agents run every executable action end-to-end, hands-off.

You can also set per-type overrides (e.g. auto-publish content but always approve emails). The autonomy gate is your master dial for trust: start at **Propose**, raise it as you get comfortable. See the [autonomy controls](./drafts.md) and Concepts above.

![the Autonomy page with the four levels](images/concepts-1.png)

## Goals

Verifiable **outcomes** you want to reach (e.g. "1,000 subscribers"). Agents work toward them and report progress, but you confirm when a goal is actually done. See [Goals & Missions](./goals-and-missions.md).

## Missions & Campaigns

A **Mission** is a big request executed as a series of **waves** — rounds of coordinated agent work that build on each other toward an objective, ending in a final report. **Campaigns** are the same wave-based work viewed from a campaign angle. See [Goals & Missions](./goals-and-missions.md).

## Cron jobs

**Recurring tasks** — an agent plus a schedule (e.g. a daily competitor sweep). KeyCommand runs them automatically and records each run. See [Cron](./cron.md).

## Reel teardown / "Why it won"

The reel analyst's **breakdown of why a reel performed** — the winning hook, key phrases, and structure. The heart of [Competitor Reel Intel](./competitors.md).

## Trend Radar

The [Content Lab](./content-lab.md) view that aggregates everything you've analyzed into "what's hot right now" — top content tags, top reels, and the analyst's running observations.

## Connections

Your linked **accounts and API keys** — social platforms (one-tap) and services like Apify, Deepgram, and AgentMail (paste-a-key). KeyCommand is "bring your own keys," so agents act through *your* accounts. See [Connections](./connections.md).

## Tenants / Workspaces

A **workspace** (sometimes called a tenant) is your isolated space in KeyCommand. Everything you create — competitors, scripts, drafts, connections, goals — is private to your workspace and never visible to another. If you have one login, you have one workspace; you don't need to think about this beyond knowing your data is yours alone.

## Usage & Spend

What your agents **cost** — Claude tokens plus your real spend on connected services like Apify and Deepgram. See [Usage](./usage.md).

---

**Back to:** [Documentation home →](./README.md)
