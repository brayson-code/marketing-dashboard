# Cron / Scheduled Jobs

**Cron** is where you set agents to run on a recurring schedule — like a daily competitor sweep, a morning research digest, or a weekly content batch. Set it once and it runs on its own.

![the Cron board listing scheduled jobs and recent runs](images/cron-1.png)

---

## What it is

A **cron job** is a recurring task: an agent, a task description, and a schedule (e.g. every day at 9am). KeyCommand runs each job when it's due, records the result, and reschedules it for next time. The competitor "daily watch" you can enable from the [Competitors](./competitors.md) page is a cron job — and so is the **daily follow-ups** automation that keeps your CRM warm.

## Why it matters

Cron is what makes KeyCommand work *while you sleep*. Instead of remembering to check competitors or pull research, you schedule it once and wake up to fresh output.

---

## How to use it

### Create a job in plain English

Schedules are written and read in plain English — you never need to know cron syntax.

1. Open **Cron**.
2. In the **"Describe it in plain English"** box, type something like *"Every morning at 8, research what's trending in our niche and save a digest."*
3. KeyCommand drafts the job for you — it picks the right agent, builds the schedule, and writes out the task — and loads it into the editor for review.
4. Adjust anything, then save. (It never auto-creates a job without your review.)

![the plain-English job composer with a draft job loaded](images/cron-2.png)

### Daily follow-ups

Turn on **daily follow-ups** from the CRM page and KeyCommand creates a cron job that runs every day. Each morning the agent scans your contacts for people who replied to you but never got a response, then **drafts a follow-up for each one** into your [Approvals](./drafts.md) queue. Nothing sends until you approve. See [Engagement](./engagement.md#daily-follow-ups-crm) for the full flow.

### Review runs

Each job records its **runs** — when it fired and what it produced — so you can see your scheduled agents' history and outputs at a glance.

### Schedules feed your Knowledge base

By default, each successful run appends its result to a knowledge document, so other agents (like your email or sales agents) can reuse what a scheduled job found. You can turn this off per job if you don't want it.

---

## Good to know

- **Schedules run on the hour.** Jobs are checked hourly, so a job set for an off-the-hour time (like 9:30) effectively fires at the top of the next hour. If a job "runs late," that's why.
- **Plain English, both ways.** You write schedules in natural language (*"every weekday at 8am"*) and the Cron board also reads them back in plain English — no cron syntax to decode.
- **Each workspace's jobs run independently** and privately.

---

## Tips

- **Start with one daily job** — the competitor watch is the obvious first one. Add more once you trust the rhythm.
- **Describe jobs in plain English** rather than hand-building schedules; it's faster and picks sensible defaults.
- **Check the runs** after a job's first scheduled fire to confirm it's producing what you expected.
- **Lean on the Knowledge feed.** Letting scheduled jobs save to your knowledge base compounds over time — your agents get smarter about your niche the longer the jobs run.
- **Turn on daily follow-ups from the CRM page** to keep warm leads from going cold without lifting a finger.
