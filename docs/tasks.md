# Tasks Board

**Tasks** is the live board of what your AI team is doing right now — and the place to step into any piece of work, refine the instruction, and send the agent back at it.

![the Tasks board with the four kanban columns](images/tasks-1.png)

---

## What it is

The default **Board** view is a kanban that updates in real time, with four columns:

- **Up Next** — drafts waiting on *your* approval. This is the only column where the next move is yours.
- **Doing** — what agents are actively working on right now.
- **Done** — work completed in the last 24 hours.
- **Stuck** — runs that errored and need a look.

Two more views sit behind the toggle: **Activity** (a chronological list of every run) and **Pipeline** (the flow view).

## Why it matters

Approvals shows you what's *waiting on you*; the Tasks board shows you the whole machine — whose move it is, what's in flight, what just shipped, and what broke — on one screen.

---

## How to use it

### Work inside a task

**Click any card** to open it in a slide-over drawer:

- Read the **full instruction** the agent was given and its **output** (streaming live if the task is still running), with the duration and token cost.
- The composer at the bottom comes **pre-filled with the task's instruction**. Edit it — sharpen the ask, add what was missing — and click **send** to dispatch the refined version to the same agent. The new run appears in **Doing** immediately, no page-hopping.
- For a draft card from **Up Next**, the drawer offers **Approve / Reject** right there, so you can clear your queue without leaving the board.

### Triage the columns

1. Clear **Up Next** first — those cards are blocked on you.
2. Glance at **Stuck** — open the card to read the error, then dispatch a corrected instruction or fix the underlying connection.
3. Let **Doing** and **Done** reassure you the machine is running.

---

## Tips

- **Refine, don't re-type.** Because the drawer pre-fills the original instruction, the fastest fix for a mediocre result is usually one edited sentence and a re-send.
- **The board is live.** Cards move between columns on their own as agents work — no refresh needed.
- **Esc closes the drawer.** Handy when you're triaging a long column.
