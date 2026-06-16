# Strategy Genes

As your agents work, they don't just produce — they *learn*. **Strategy Genes** are the lessons they've picked up about what works for **this** business, written in plain English you can read at a glance: *"Lead with the number," "Hook in the first sentence," "Keep CTAs to one line."* Each gene is a small, reusable rule, and the ones you approve get woven into your agents' instructions so the whole squad applies the lesson — not just the agent that discovered it.

![Strategy Genes — the lessons your agents have learned](images/genes-1.png)

Strategy Genes is a **Pro** feature, found at **Genes** in the left navigation.

---

## What a gene is

A gene is one short, plain-language lesson about what tends to win for your business. Every gene carries a little context so you can judge it:

- **The lesson** — the rule itself, in a sentence (e.g. *"Open with a concrete result, not a question"*).
- **Status** — where the gene is in its life: **proposed**, **active**, or **retired** (more on these below).
- **Track record** — how it's actually performed: how many times it's been **tried**, how many of those were **wins**, and its **mean reward** (the average score of the runs that used it).
- **Source** — where it came from: **you wrote it**, or the [learning](./learning.md) loop **proposed it** after noticing a pattern in your results.

Because every gene shows its track record, you're never asked to trust a rule blind — you can see whether it's earning its place.

---

## Proposed vs. active

The most important distinction on the page is between a gene that's merely *suggested* and one that's actually *in use*:

- **Proposed** — a candidate lesson, waiting for you. It came either from you or from the learning loop spotting a pattern, but it is **not** influencing any agent yet. Proposed genes are inert until you say otherwise.
- **Active** — an approved gene that **is** being applied. Active genes get injected into the relevant agents' instructions, so the next time those agents run, they follow the lesson automatically.
- **Retired** — a gene you've taken out of rotation. It stops influencing agents but stays on record, so you keep the history (and can bring it back later).

Nothing a gene "learns" reaches your agents until **you** promote it from proposed to active. You're always the one who decides which lessons the squad adopts.

---

## How it works

1. **Lessons accumulate.** As runs complete and get scored by the [learning](./learning.md) loop, patterns emerge — and the strongest ones surface as **proposed** genes. You can also write your own at any time.
2. **You review.** Open **Genes** and read what's proposed. Each gene shows its track record so you can tell a real pattern from a fluke.
3. **You approve the good ones.** Promote a proposed gene to **active** and it's immediately folded into the instructions of the agents it applies to.
4. **The squad applies it.** From that point on, the relevant agents work with the lesson baked in — every researcher, writer, and outreach agent it touches.
5. **You prune what stops working.** If an active gene's track record slips, **retire** it. The squad goes back to working without it on the next run.

---

## Staying in control

Strategy Genes is built so the agents can suggest, but you decide. The safety controls:

- **Approval required.** A proposed gene changes nothing until you make it active.
- **Retire any time.** Pull an active gene out of rotation with one click; its lesson stops being injected on the next run.
- **Master kill switch.** One toggle disables *all* gene influence at once — every agent immediately goes back to its base instructions, no matter how many genes are active.
- **Revert.** Roll back to a previous state if a recent change didn't land the way you wanted.

These work alongside the [autonomy gate](./concepts.md#the-autonomy-gate): autonomy controls how much agents can *do* on their own, while Strategy Genes controls what they've *learned* to do it better. Even at the same autonomy level, nothing an agent learns goes live without your sign-off.

---

## Good to know

- **Start by reading, not approving.** Let a few proposed genes build a track record before you promote them — the tries/wins counts get more trustworthy with use.
- **A gene is only as good as its record.** Lean on the **mean reward** and the **wins-out-of-tries** count, not just whether the lesson "sounds right."
- **Write your own.** If you already know a rule that works for your brand, add it directly as a gene and make it active — you don't have to wait for the loop to discover it.
- **Retire freely.** Retiring isn't deleting. The gene's history stays, and you can reactivate it later if conditions change.
- **The kill switch is your panic button.** If results ever feel off and you suspect a learned rule, flip the master switch to take every gene out of the loop in one move, then re-enable the ones you trust.
- **It's powered by Learning.** Strategy Genes is the visible, editable layer on top of the scoring engine described in [Learning](./learning.md) — that's where the patterns behind your proposed genes come from.
