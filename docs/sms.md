# SMS & Text Messaging

Connect Twilio and your agents can send text messages on your behalf — and you get an **SMS inbox** right inside KeyCommand where you can read replies and text back yourself.

> _Screenshot: the SMS lane in the Engagement tab, with a contacts list on the left and a conversation on the right._

---

## What it is

The SMS feature has two parts:

1. **Agent-sent texts** — when your agents draft outreach, follow-ups, or notifications as SMS, they route through [Approvals](./drafts.md) first (same as any other output). Approve the draft and it goes out through your Twilio number.
2. **SMS inbox (Engagement tab)** — a two-pane chat interface in the **Engagement** section. Left pane shows your contacts; right pane shows the full conversation thread and a reply box where you can text back directly.

Inbound replies from contacts land in the inbox automatically, so you always have the full thread in one place.

---

## How to connect

1. Open **Connections** from the left navigation.
2. Find the **Twilio** tile and click **Connect**.
3. Paste your **Account SID**, **Auth Token**, and the **From number** (the Twilio phone number texts will be sent from).
4. Click **Save**. The tile flips to **connected**.

Once connected, the SMS lane appears in the Engagement tab.

> _Screenshot: the Twilio tile on the Connections page in the connected state._

---

## Using the SMS inbox

1. Open **Content Lab → Engagement** (or the **Engagement** tab, depending on your navigation).
2. Click the **SMS** lane at the top of the page.
3. Select a contact from the left pane to open their thread.
4. Read the conversation, type a reply in the box at the bottom, and hit **Send**.

Phone numbers are auto-normalized — you can type `(415) 555-0123` or `4155550123` and KeyCommand figures it out. You don't need to format numbers yourself.

---

## Daily send cap

There's a per-day send limit of **50 messages per workspace** by default. This cap exists so a misconfigured agent or a runaway automation can't rack up unexpected Twilio charges overnight.

- The cap counts all outgoing texts in a calendar day (agent-sent + your own replies).
- When the cap is reached, new outgoing messages are held until midnight when the count resets.
- If you regularly need to send more, contact your workspace administrator to raise the limit.

---

## Good to know

- **Agent texts go through Approvals.** Your agents won't fire off texts without your say-so — they draft, you approve, then it sends.
- **Inbound texts show up automatically.** Replies your contacts send to your Twilio number appear in the SMS inbox in real time (Twilio sends them to KeyCommand via webhook).
- **Only one From number per workspace.** The number you enter when connecting Twilio is the number all texts come from.
- **Twilio charges apply.** Sending texts uses your Twilio account's credits, separate from your Claude AI spend. Check your Twilio dashboard for per-message costs.

---

**Related:** [Connections](./connections.md) · [Engagement](./engagement.md) · [Drafts & Approvals](./drafts.md)
