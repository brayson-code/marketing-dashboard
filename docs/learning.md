# Learning

Your agents get better the more they work — and **Learning** is where you can see it happen. Every time an agent finishes a run, that run gets a **score**: did you approve it, how well did it perform, and how reliably did it run? Over time those scores add up into a track record for each agent, and the system leans toward the approaches that are working. It's a simple reward-based learning loop, and it's the engine behind [Strategy Genes](./strategy-genes.md).

![Learning — how each agent is scored and improving over time](images/learning-1.png)

Find it at **Learning** in the left navigation.

---

## How a run gets scored

When an agent run completes, it earns a **reward** — a single score that rolls up three things:

- **Did you approve it?** Work you approve scores higher than work you reject. Your decisions in [Drafts & Approvals](./drafts.md) are the strongest signal the system has — you're effectively teaching it what "good" looks like.
- **How did it perform?** Where there's a measurable result — a draft that got published, a goal it moved forward — that feeds the score.
- **How reliable was it?** A clean run that finished without errors scores better than one that stumbled, retried, or failed partway.

You don't have to grade anything by hand. Approving and rejecting drafts as you normally would *is* the grading.

---

## What you see

The Learning page turns those scores into a track record you can actually read:

- **Runs scored** — how many completed runs have been graded.
- **Mean reward** — the average score across them, so you can see the overall trend at a glance.
- **By-role breakdown** — the same numbers split out per role, so you can tell which parts of your squad are pulling their weight and which need attention. A researcher and a content writer get judged on their own terms.

Watching the mean reward climb over time is the clearest sign that the loop is doing its job — your agents are converging on what works for your business.

---

## How it improves the team

Scoring isn't just a report card — it changes what happens next:

1. **Runs get scored** as they complete, building each agent's track record.
2. **Patterns surface.** When a particular approach keeps scoring well, the system notices.
3. **Lessons get proposed.** The strongest patterns become candidate [Strategy Genes](./strategy-genes.md) — short, plain-English rules you can review and approve.
4. **Approved lessons spread.** Once you make a gene active, it's folded into the relevant agents' instructions, so the whole squad benefits from what one run discovered.

So Learning is the quiet engine underneath: it measures, and [Strategy Genes](./strategy-genes.md) is where those measurements turn into rules you control.

---

## Good to know

- **Your approvals do the teaching.** The single biggest thing you can do to steer the loop is approve and reject drafts thoughtfully — that's the clearest signal it learns from.
- **Give it time.** Mean reward is most meaningful once each agent has a few scored runs behind it; early numbers swing around.
- **Read it by role.** The by-role breakdown is where the useful detail lives — it tells you *which* kind of work is improving, not just that things are.
- **It feeds Strategy Genes.** If you want to act on what Learning reveals, head to [Strategy Genes](./strategy-genes.md) — that's where patterns become rules your agents apply.
