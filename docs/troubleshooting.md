# Troubleshooting

Concrete fixes for the most common "it's not working" moments. If you don't see your issue here, the [FAQ](./faq.md) covers the broader how-does-this-work questions.

---

## My agents won't run at all

**Connect your Claude key.** Your AI team runs on **your own Anthropic (Claude) key**, and every agent stays paused until it's connected. Open **Connections → AI providers → Anthropic (Claude API)**, click **Connect**, paste your key, and save. The key is checked against Anthropic before it's stored, so **connected** means it actually works. Don't have one? Create it at [console.anthropic.com](https://console.anthropic.com) → **API Keys**. See [Getting Started](./getting-started.md#3-connect-your-claude-key--step-one).

---

## An agent drafted something but never sent it

**It's waiting in Approvals.** By default agents draft rather than act. Open [Approvals](./drafts.md), find the item, and approve it. If you'd rather agents act on their own for certain output types, raise the [autonomy gate](./concepts.md#the-autonomy-gate) (start at **Propose**, raise as you get comfortable).

---

## Google sign-in bounces or won't connect

**An admin has to finish the OAuth setup first.** Google sign-in and Workspace actions depend on your workspace's Google connection being fully configured. If sign-in fails or the **Connect Google** tile won't complete, ask whoever administers your workspace to finish the Google OAuth setup. Also make sure you're signing in with the Google account that uses the **same email** as your KeyCommand account. See [Google Workspace](./google-workspace.md).

---

## SMS isn't sending

Work through these in order:

1. **Connect Twilio.** Open **Connections → Twilio** and paste your Account SID, Auth Token, and From number. (For iMessage threads, connect **LoopMessage** instead.)
2. **Register / verify your From number.** Texts go out from the Twilio number you entered — it must be a number on your Twilio account.
3. **Check the daily send cap.** There's a per-day limit (50 messages per workspace by default). If you've hit it, new messages wait until the count resets at midnight.
4. **Approve the draft.** Agent-sent texts route through [Approvals](./drafts.md) first.

See [SMS & Text Messaging](./sms.md).

---

## The Hyperframes canvas won't generate

**Connect a Google AI key.** The node canvas renders images with **Nano Banana Pro** and video with **Veo**, both Google models — so generation needs a Google AI connection in place. Add it on **Connections**, then reopen the canvas. Rendering the finished reel additionally uses your **HeyGen** connection. See [Hyperframes](./hyperframes.md#the-node-canvas).

---

## Analytics panels are empty

**Connect the platform's API first.** Each per-platform panel (YouTube, Instagram, Facebook Ads, TikTok, website, X, LinkedIn) only fills in once that platform is connected on [Connections](./connections.md). Until then it shows a connect prompt instead of charts. Connect the account, then re-open Analytics and pick your time range. See [Analytics](./analytics.md).

---

## My MCP server's tools aren't available to agents

**Flip the toggle on.** Every MCP server you add starts **toggled off** — it's registered but inert until you enable it. Open **Connections → MCP Servers** and turn the server's toggle on. See [MCP Servers](./connectors-mcp.md).

---

## Autonomous runs suddenly paused

**You may have hit your daily token budget.** A spend cap pauses *autonomous* runs (it doesn't fail them) once the day's budget is reached; interactive chat is never blocked. Raise the budget or wait for the daily reset on [Usage & Spend](./usage.md).

---

**Related:** [FAQ](./faq.md) · [Connections](./connections.md) · [Getting Started](./getting-started.md)
