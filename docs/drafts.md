# Drafts & Approvals

![Approvals in the KeyPlayers Command Center](/docs-images/drafts.png)

**Approvals** (labelled **Approvals** in the left navigation, and still reachable at `/drafts`) is your approval queue. Everything your agents create that could go out into the world — content posts, emails, texts, meetings, campaigns — lands here first as a **draft**. **Nothing executes without your explicit approval.**

![the Drafts page with pending items awaiting approval](images/drafts-1.png)

---

## What it is

When KeyPlayer or any specialist agent produces something actionable, it saves a **draft** here instead of acting on it. You review each one and decide: approve it, reject it, or (once approved) execute it — publish a post, send an email, confirm a meeting to your calendar.

## Why it matters

This is the safety net that lets you put agents to work without worrying they'll post or send something you didn't sign off on. Drafts is where you stay in control.

---

## How to use it

1. Open **Approvals** from the left navigation. By default it shows **pending** items.
2. Click any draft's title to expand and read the full content.
3. For each pending draft:
   - **Approve** — accept it. For posts/emails/texts/meetings, approving unlocks the execute step.
   - **Reject** — discard it.
4. For an approved item with a next step, click the execute button:
   - **Publish** (content post)
   - **Send** (email or SMS)
   - **Confirm to calendar** (meeting)

Use the **pending / approved / all** tabs at the top to change what you're looking at.

### Publishing is real

When a platform is [connected](./connections.md), **Publish** actually ships it:

- Posts tagged for **X**, **LinkedIn**, or **Facebook Pages** go out through your own connected account (long X posts become a thread automatically).
- Comment replies post back to the original **YouTube** or **Instagram** comment.
- **Email** delivers through your AgentMail account.
- **SMS** sends via your connected Twilio number.

Platforms that aren't wired up yet still flip the draft's status but stamp a clear *"simulated"* note, so the record never pretends something went out. If a real publish fails (an expired connection, a missing permission), the draft **stays approved** with the error noted — fix the connection and click Publish again.

![an expanded draft showing Approve / Reject buttons](images/drafts-2.png)

### Keeping the queue clean

Drafts can pile up, and some go stale as your priorities change. Two tools help:

- **Still needed?** — on any open draft, click this to have KeyCommand re-check whether the draft is still worth acting on, given your current goals and what's already shipped. It returns a verdict (still needed: yes/no/unclear) with a short rationale.
- **Run triage sweep** — re-validates a batch of open drafts at once, flagging any that are no longer needed or have been superseded. Flagged drafts get a **needs review** badge so you can clear them quickly.

---

## Download & export

Sometimes you want a draft out of the app — to hand it to a client, share it with a teammate, or keep an offline copy. Every item here has an **Export** control that downloads the content you're already looking at, formatted for the file type you pick. The same **Export** control lives on your **Reports**, so you can download those the same way.

Choose the format that fits where it's going:

- **PDF (.pdf)** — a polished, locked-down deliverable. Reach for this when you're sending something to a client and want it to look finished and read the same everywhere.
- **Word (.docx)** — like PDF, but editable. Pick this when the person on the other end needs to make changes or drop it into their own document.
- **PowerPoint (.pptx)** — a quick slide deck. Each heading in the content becomes a new slide, so a well-structured draft turns into a presentation in one click.
- **Excel (.xlsx)** — for tabular data. Any tables in the content come across as spreadsheet rows you can sort, filter, or chart.
- **Markdown (.md)** — clean, plain text for reuse — pasting into another tool, a docs site, or back into a draft elsewhere.
- **HTML (.html)** — the content as a self-contained web page, handy for embedding or sharing as a link.

Whatever you download is exactly the content you see, just dressed for that file type — nothing is sent anywhere, and the original draft stays put.

---

## Tips

- **Make Drafts a daily habit.** A quick pass each morning keeps your agents productive and your output flowing.
- **Approve isn't the same as "live."** For content, email, SMS, and meetings, approving is step one — you still click **Publish/Send/Confirm** to actually ship it. This double-step is intentional.
- **Use the triage sweep weekly** to clear stale drafts so the queue reflects what actually matters now.
- **Want fewer manual approvals?** Raise your [autonomy level](./concepts.md#the-autonomy-gate) so trusted draft types execute on their own — but only when you're ready.
