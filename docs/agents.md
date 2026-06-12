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

Two things every agent shares, no matter which one it is:

- **They run on your workspace's own Claude key.** Agents use the Anthropic key you connect on [Connections](./connections.md) — your data and your AI spend stay under your account. Until that key is connected, agents stay paused. It's [step one of setup](./getting-started.md#3-connect-your-claude-key--step-one).
- **They all read your [company playbook](./concepts.md#company-playbook).** The business brief you build on **Settings** (the **Company brief** card) is injected into every agent (and the orchestrator) before it works, so the whole team knows your objective, audience, voice, and guardrails — and sounds like *your* business, not a generic one.

---

## Viewing your team (`/agents`)

Open **Agents** from the left navigation. The orchestrator gets a highlight card at the top, and the rest of the roster is grouped into two sections:

- **Org chart** — the executive layer: your AI CEO and the rest of the C-suite, who own strategy, oversight, and audit.
- **Specialists** — the workers each executive dispatches; each does one thing well.

Every card shows the agent's **name** and **role**, a **status dot** (active, idle, error, or "not run yet"), and quick **stats** — how many runs, when it was last active, and tokens used.

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
   - **Model** — choose how capable (and how expensive) the underlying AI is. Options range from fast-and-cheap (Haiku) up to the premium **Fable 5** for the hardest work.
   - **Max tokens** — the response budget per run.
   - **Enabled** — turn the agent on or off.
   - **Spawnable** — whether the orchestrator is allowed to call this agent.
   - **Soul**, **Agent**, and **Skills** — the three text fields that define how the agent thinks and works.
3. Click **Save**. Your changes apply on the agent's next run.

> **Good to know:** Once you save, your edited definition takes over from the built-in default. If you later want the original behavior back, you can clear your changes — ask your administrator if you need a clean reset.

### Generate an agent's playbook

You don't have to write the Soul / Agent / Skills fields by hand. Click **Generate playbook** in the editor's header and answer a short questionnaire about *this* agent — its core job, what an excellent result looks like, what it works from, its hard rules, and any tactics it should follow. KeyCommand writes a complete definition from your answers, grounded in your [company playbook](./concepts.md#company-playbook) so the agent aligns with your business. Nothing is saved automatically: the generated fields drop into the editor for you to review, tweak, and **Save**.

### Test run (sandbox)

Below the definition fields, the **Test run** panel lets you try your **current, unsaved draft** on a sample input — type something like *"Draft a LinkedIn post announcing our new pricing tier"* and click **Test run**. It's a single, cheap dry run: nothing is saved, nothing counts as a real task, and nothing goes out. Use it to iterate on the definition until the output feels right, *then* hit Save.

### Creating a new agent

1. Click **New agent** in the sidebar.
2. **Pick a template** — common archetypes like Lead Enricher, Email Outreach Writer, Reel Analyst, Content Writer, Competitor Watcher, or SEO Researcher — or **start custom**. A template pre-fills the name, role, and the playbook questionnaire.
3. Tweak the details: the **ID** (a lowercase slug like `market-researcher` — this can't be changed later), **Name**, **Role**, **Model**, and the questionnaire answers.
4. Click **Create**. KeyCommand provisions the agent *and* generates its Soul, Agent, and Skills in one go — so it's well-defined out of the box, not an empty shell — then opens it in the editor for review.

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
