# Agents & Agent Studio

KeyCommand runs on a team of AI **agents** — specialists that do real work like researching, writing content, and drafting outreach. This page covers how to view your team, dig into a single agent, and use the **Agent Studio** to edit or create agents.

![the Agents page showing the team grid](images/agents-1.png)

---

## What agents are

Think of agents as named teammates, each with a job. There are two kinds:

- **The orchestrator** (called **KeyPlayer**) — the lead agent that takes your requests, plans the work, and dispatches the right specialists. You talk to it in the [Boardroom](./boardroom.md).
- **Specialists** — focused agents like a researcher, a content writer, an outreach agent, a reel analyst, and so on. The orchestrator calls on them as needed.

Each agent is defined by three things, written in plain language:

- **Soul** — its voice, values, and disposition (how it "sounds").
- **Agent** — its operating instructions (how it works).
- **Skills** — the tools and capabilities it can use.

It also has a **model** (the underlying AI it runs on — faster/cheaper or slower/smarter) and a few settings like a token budget.

---

## Viewing your team (`/agents`)

Open **Agents** from the left navigation. You'll see your roster as a grid of cards. Each card shows:

- The agent's **name** and **role**.
- A **status dot** — active, idle, error, or "not run yet".
- Quick **stats** — how many runs, when it was last active, and tokens used.

Click any agent to open its **detail page**. If an agent is editable, the page shows an **Edit** button that takes you straight into the Agent Studio for that agent. The detail view is organized into three tabs:

- **Memory** — what the agent is up to. A **Status** line (its rolling "pulse" — what it's focused on right now, updated at the end of each successful run), an **Activity** strip of recent heartbeats, headline counts (total runs, completed, errors), and a **Recent memory** timeline you can expand to read each past run. A collapsible **Technical details** panel tucks away raw internals (model, token usage, agent ID) for when you want them.
- **Learning** — per-agent learnings ranked by impact. *(Coming soon.)*
- **Tasks** — anything currently running for this agent.

![an individual agent's detail page with the Edit button](images/agents-2.png)

---

## Agent Studio (`/agents/workspace`)

The **Agent Studio** (the **Workspace** tab) is where you view, edit, and create the specialists your orchestrator dispatches. The headline feature: **edits take effect live — no redeploy.** The next time an agent runs, it uses your changes.

![the Agent Studio with the agent list on the left and the editor on the right](images/agents-3.png)

### The layout

- **Left sidebar** — your agents, grouped into **Orchestrator** and **Specialists**. A colored dot shows whether each is enabled. A **New agent** button sits at the top.
- **Right editor** — the full definition of whichever agent you've selected.

### Editing an agent

1. In the Agent Studio, click an agent in the left sidebar (or use the **Edit** button on its detail page).
2. Adjust any of:
   - **Name**, **Role**, and **Description**.
   - **Model** — choose how capable (and how expensive) the underlying AI is. Options range from fast-and-cheap to most-capable.
   - **Max tokens** — the response budget per run.
   - **Enabled** — turn the agent on or off.
   - **Spawnable** — whether the orchestrator is allowed to call this agent.
   - **Soul**, **Agent**, and **Skills** — the three text fields that define how the agent thinks and works.
3. Click **Save**. Your changes apply on the agent's next run.

> **Good to know:** Once you save, your edited definition takes over from the built-in default. If you later want the original behavior back, you can clear your changes — ask your administrator if you need a clean reset.

### Creating a new agent

1. Click **New agent** in the sidebar.
2. Give it an **ID** (a lowercase slug like `market-researcher` — this can't be changed later), a **Name**, a **Role**, and a **Model**.
3. Optionally add a starter **description**.
4. Click **Create agent**. It opens in the editor so you can fill in its Soul, Agent, and Skills.

A new spawnable agent automatically becomes available to the orchestrator — it can start dispatching your custom agent right away.

### Deleting

- **Custom agents** (ones you created) can be deleted with the **Delete** button.
- **Built-in agents** can be **disabled** but not deleted, so you never lose a core part of the team by accident.

---

## Tips

- **Start with the model.** If an agent feels slow or expensive, switch it to a faster model; if its output feels shallow, switch it to a more capable one.
- **Edit the Soul to change tone.** If an agent's writing doesn't sound like your brand, the **Soul** field is the fastest lever.
- **Use "Spawnable" as an on/off switch for the orchestrator.** Turn it off to take an agent out of rotation without deleting it.
- **Changes are live.** There's no deploy step — save, then trigger the agent (or wait for its next scheduled run) to see the new behavior.
- **The orchestrator is special.** KeyPlayer (the lead) and a couple of system agents aren't meant to be edited the same way as specialists — focus your customization on the specialist roster.
