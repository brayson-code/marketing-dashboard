# Connections

**Connections** is where you link the accounts and services your agents watch, post to, and act through. It's the single home for both your **social accounts** and your **API keys**.

![the Connections page with social tiles and the API keys grid](images/connections-1.png)

---

## What it is

The Connections page has two parts:

1. **Social accounts & platform connections** — Instagram, Facebook, LinkedIn, YouTube, X, TikTok, and Google. These connect with one tap: you log in to the platform and approve access. No keys to copy.
2. **API keys & other services** — tools like Apify, Deepgram, AgentMail, Twilio, and the AI providers. These connect by pasting a key you create on that service's website.
3. **MCP servers** — remote Model Context Protocol servers your agents can call as tools. Each one gets a card with an on/off toggle.

All secrets are **encrypted at rest** and scoped to your workspace only.

## Why it matters

KeyCommand is "bring your own keys." When you connect *your* accounts, agents act through your brand and your billing — and you read your *own* real usage and analytics. Nothing is shared across workspaces.

The most important key is your **Anthropic (Claude) key** — the AI your whole team runs on. It's strict bring-your-own: agents run on *your* key (so your data and AI spend stay under your account) and **stay paused until you connect it**. Connecting it is step one of setup. See [Getting Started](./getting-started.md#3-connect-your-claude-key--step-one).

---

## How to connect a social account or platform

1. Open **Connections**.
2. In the **Social accounts** section, find the platform tile (Instagram, Facebook, LinkedIn, YouTube, X, TikTok, or Google).
3. Click **Connect** and complete the platform's login/approval popup.
4. The tile flips to **connected**. To remove it later, use **Disconnect**.

Social connections power publishing, reading your analytics, and pulling your brand voice. (Some platforms require the workspace owner to have finished platform setup first; if a tile says it's not available yet, that step is still pending.)

![connecting via the one-tap flow](images/connections-2.png)

---

## How to connect an API key

1. Open **Connections** and scroll to **API keys & other services**.
2. Use the category filter (AI, Messaging, Email, Calendar, Social, Analytics, Other tools) to find a service, or browse the grid.
3. Click **Connect** on the tile, paste the required key(s), and click **Save**. The tile shows **connected**.
4. To replace a key, click **Update**. To remove it, use the clear (✕) button.

> For some services (HeyGen Hyperframes, Anthropic) the key is **checked against the service before it's saved** — so **connected** means "this key actually works," not just "a key was entered." If the key is wrong, you'll see the error right away instead of at the first failed run.

---

## What each connection unlocks

### Google (all-in-one)

**Connect Google** is a single connection that grants access to all six Google services at once — Drive, Docs, Sheets, Gmail, Calendar, and Meet. You see one tile and one consent screen; there are no separate tiles per service.

After connecting, flip **Settings → Google Workspace actions** on to let agents actually create, edit, and send. (It's off by default, so nothing happens until you're ready.) See [Google Workspace](./google-workspace.md) for the full list of what your agents can do.

### Most useful for content & competitor work

| Service | What it unlocks | Where to get it |
|---------|-----------------|-----------------|
| **Apify** | **Competitor Reel Intel** — scraping competitor reels for analysis. This is the key that turns on the Competitors feature. | Free signup at apify.com → copy your API token |
| **Deepgram** | Transcribes a reel's audio when it has no on-screen subtitle track, giving deeper teardowns and powering the "Optimize my reel" scan. Comes with free starting credit. | deepgram.com → API key |
| **Instagram (via Meta)** | Reading your own reel performance (reach, plays, watch time) so the "Optimize my reel" scanner uses real numbers. | A Meta Page access token, or connect Instagram in the Social section |

### SMS & messaging

| Service | What it unlocks |
|---------|-----------------|
| **Twilio** | Agent-sent SMS and the SMS inbox in Engagement — your agents can text contacts, and you get a two-pane chat to read and reply to inbound texts. Paste your Account SID, Auth Token, and From number. See [SMS & Text Messaging](./sms.md). |
| **LoopMessage** | iMessage — let agents send iMessages and text with your lead agent over iMessage. Paste your LoopMessage auth key. |
| **AgentMail** | Email agents — your own inboxes, sending, and replies, all under your AgentMail account. Create the account and API key at agentmail.to. |
| **Telegram** | Route KeyCommand notifications to a Telegram bot instead of (or in addition to) email. Connect a bot token to get workspace alerts in Telegram. |

### AI providers

| Service | What it unlocks |
|---------|-----------------|
| **Anthropic (Claude API)** | **The AI your entire team runs on — connect this first.** Strict bring-your-own: agents run on your key, and they stay paused until it's connected. The key is verified against Anthropic before it's saved. |
| **OpenAI** | An alternative AI provider. |

### MCP servers

Add a remote MCP server and your agents can use its tools automatically. Each server gets a card with a toggle — off by default, no effect until you turn it on. See [MCP Servers](./connectors-mcp.md).

### Analytics & other services

| Service | What it unlocks |
|---------|-----------------|
| **Plausible** / **Google Analytics 4** | Site traffic data for your agents to reason over. |
| **X (Twitter)**, **LinkedIn** | Posting and reading via API key (in addition to the one-tap social tiles). |
| **HeyGen Hyperframes** | In-app reel rendering — the **Render** button in [Hyperframes](./hyperframes.md) produces the finished video on your HeyGen account. Create a key at app.heygen.com → Settings → API. Note: HeyGen's API is paid (per-render credits), separate from any web plan. |

---

## Tips

- **Connect Apify first.** It's the single highest-value connection because it unlocks the whole competitor-intel-to-script workflow.
- **Use the single Connect Google tile.** One approval covers Drive, Docs, Sheets, Gmail, Calendar, and Meet — then flip the Settings toggle on when you're ready for agents to write.
- **Add Deepgram if your reels (or your competitors') don't have captions.** Without it, caption-less reels get a shallower teardown.
- **Connect Instagram before using "Optimize my reel."** Real performance data makes that report dramatically more useful.
- **You can disconnect anytime.** Removing a key only affects the features that use it; the rest of KeyCommand keeps working.
- **Your usage is yours.** Because keys are your own, the [Usage page](./usage.md) reads each vendor's real numbers straight from your accounts.
