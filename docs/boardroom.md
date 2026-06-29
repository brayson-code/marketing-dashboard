# Boardroom

![Boardroom in the KeyPlayers Command Center](/docs-images/boardroom.png)

The **Boardroom** is where you talk to your lead agent (**KeyPlayer**) and watch your agents coordinate. It's the conversational front door to KeyCommand — ask for anything, and the orchestrator figures out who should do it. You'll find it under the **Agents** section of the left nav.

![the orchestrator chat with a conversation in progress](images/boardroom-1.png)

---

## What it is

The page has two tabs:

- **Orchestrator agent** — chat with KeyPlayer, the orchestrator. Ask questions, request work, paste screenshots for it to read. This conversation works right here in the app, and if you've connected iMessage (via LoopMessage) you can carry it on from your phone too — it's the same thread either way.
- **Agent ↔ Agent** — a live view of how your agents talk to *each other* while they work.

## Why it matters

Most of KeyCommand's pages are structured tools. The Boardroom is the open-ended one: when you're not sure which page to use, just describe what you want here and let the orchestrator route it. The Agent ↔ Agent tab also gives you a rare window into *how* the work actually gets done.

---

## How to use it

### Chat with KeyPlayer

1. Open the **Boardroom** (you'll land on the **Orchestrator agent** chat tab).
2. Type a request — *"Draft three reel hooks about our new feature,"* or *"What did our competitors post this week?"*
3. KeyPlayer plans the work, dispatches specialists if needed, and replies. Anything it produces for action shows up in [Drafts](./drafts.md).

**Send it a screenshot.** Use the attach button in the chat box — or just paste or drag-and-drop an image straight into the conversation — and KeyPlayer can read it. It's handy for "here's a reel I saw, what do you think?" or pasting a dashboard you want it to interpret.

### Watch agents collaborate

Switch to the **Agent ↔ Agent** tab to see the back-and-forth between agents on a task — who asked whom for what, and what came back.

### Cost transparency

Each reply can show its token cost — click the small info icon on a message to see how many tokens it used and roughly what it cost.

---

## Approving costly actions inline

When enabled for your workspace, the biggest, most expensive moves pause for your go-ahead right here in the chat. Before KeyPlayer kicks off a full multi-wave research campaign or spins up a sub-agent to take on extra work, it stops and shows you an **Approve** / **Deny** card in the conversation.

Nothing runs until you decide. Tap **Approve** and the action kicks off; tap **Deny** and KeyPlayer drops it and moves on. You stay in control of the moments that cost the most.

This is the same "you sign off before it acts" idea behind [Drafts](./drafts.md) — just brought inline for the big, in-the-moment calls instead of routing them to a separate queue.

---

## Tips

- **Use it as your catch-all.** When no specific page fits, describe the goal to the orchestrator and let it pick the right specialists.
- **Paste screenshots liberally.** Visual context (a competitor reel, a dashboard, a design) often gets you a much better answer.
- **Remember the approval rule.** The orchestrator can *propose* anything, but it still routes actions through Drafts for your sign-off (unless you've raised [autonomy](./concepts.md#the-autonomy-gate)).
- **The Agent ↔ Agent tab is great for learning** how your team operates — and for spotting where an agent could be tuned in the [Agent Studio](./agents.md).
