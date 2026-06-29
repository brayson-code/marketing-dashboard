# FAQ

Short answers to the questions people ask most. If something here doesn't unblock you, the [Troubleshooting](./troubleshooting.md) page has concrete "if X, do Y" fixes.

---

## Getting set up

### How do I connect my accounts?
Everything connects on one page: open **Connections** from the left navigation. Social accounts (Instagram, Facebook, LinkedIn, YouTube, X, TikTok) and **Google** connect with one tap; API-key services (Apify, Deepgram, AgentMail, Twilio, and more) connect by pasting a key. Your **Anthropic (Claude) key** is the first one to add — your agents stay paused until it's connected. See [Connections](./connections.md) and [Getting Started](./getting-started.md).

### I forgot my password — what do I do?
On the sign-in screen, click **Forgot password?** and enter your email. We'll send a password-reset link to that address — open it and you'll be signed in once so you can set a new password. If the email doesn't show up within a few minutes, check your spam or junk folder. If you still can't get in, see [Troubleshooting](./troubleshooting.md#cant-sign-in--forgot-password).

### Why isn't my agent posting / doing anything?
Two common reasons:

1. **It's waiting for your approval.** By default, agents *draft* — they don't publish on their own. Check [Approvals](./drafts.md) and approve the item. If you want agents to act without asking, raise the [autonomy gate](./concepts.md#the-autonomy-gate).
2. **A required connection is missing.** Agents won't run at all until your **Claude key** is connected, and a given action needs the right account linked (e.g. publishing to Instagram needs Instagram connected). See [Troubleshooting](./troubleshooting.md).

### How do approvals work?
Anything an agent produces that could go out — a post, an email, a meeting, a script — lands in **Approvals** as a draft. You approve, reject, or execute it. Nothing ships without your sign-off unless you raise autonomy. See [Drafts & Approvals](./drafts.md).

### How do I set a spending cap?
Open **Usage & Spend** and set a **daily token budget**. It caps *autonomous* agent runs (they pause, not fail, when the budget is hit) while your interactive chat stays unblocked. See [Usage & Spend](./usage.md).

---

## Day-to-day

### What's the difference between Goals, Missions, Tasks, and Campaigns?
- **Goal** — a verifiable *outcome* you want (e.g. "1,000 subscribers"). Agents work toward it; you confirm when it's done.
- **Mission** — one big request run as a series of **waves** of coordinated agent work, ending in a report.
- **Campaign** — a bigger container: a themed, multi-channel push over a date range that bundles the missions under it.
- **Tasks** — the live board of individual agent runs as they happen.

See [Goals, Campaigns & Missions](./goals-and-missions.md) and the [Tasks Board](./tasks.md).

### How do I talk to my orchestrator over SMS or iMessage?
Chat with **KeyPlayer** (your lead agent) in the [Boardroom](./boardroom.md). If you've connected **iMessage** (via LoopMessage) you can carry the same conversation on from your phone — it's one thread either way. Connecting **Twilio** also gives agents the ability to send SMS and gives you an [SMS inbox](./sms.md) in Engagement.

### Is my data private / isolated per workspace?
Yes. Each login belongs to a single **workspace**, and everything you create — competitors, scripts, drafts, connections, goals — is private to that workspace and never visible to another. See [Your Data](./your-data.md) and the [Privacy Policy](./privacy.md).

### How do I add an MCP server?
On **Connections**, scroll to **MCP Servers**, click **Add MCP server**, paste the server URL and any auth, and save. New servers start **toggled off** — flip the toggle on to let your agents use its tools. See [MCP Servers](./connectors-mcp.md).

### What models power the Hyperframes node canvas?
Each frame runs a chain: a **Prompt** node feeds an **Image** node rendered by **Nano Banana Pro**, which feeds a **Video** node rendered by **Veo**, and the **Assemble** node stitches the connected frames into a finished reel via the Hyperframes / HeyGen pipeline. See [Hyperframes](./hyperframes.md#the-node-canvas).

---

**Related:** [Troubleshooting](./troubleshooting.md) · [Getting Started](./getting-started.md) · [Concepts & Glossary](./concepts.md)
