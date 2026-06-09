# Connections

**Connections** is where you link the accounts and services your agents watch, post to, and act through. It's the single home for both your **social accounts** and your **API keys**.

![the Connections page with social tiles and the API keys grid](images/connections-1.png)

---

## What it is

The Connections page has two parts:

1. **Social accounts** — Instagram, Facebook, LinkedIn, YouTube, X, and TikTok. These connect with one tap: you log in to the platform and approve access. No keys to copy.
2. **API keys & other services** — tools like Apify, Deepgram, AgentMail, and the AI providers. These connect by pasting a key you create on that service's website.

All secrets are **encrypted at rest** and scoped to your workspace only.

## Why it matters

KeyCommand is "bring your own keys." When you connect *your* accounts, agents act through your brand and your billing — and you read your *own* real usage and analytics. Nothing is shared across workspaces.

---

## How to connect a social account

1. Open **Connections**.
2. In the **Social accounts** section, find the platform tile (Instagram, Facebook, LinkedIn, YouTube, X, or TikTok).
3. Click **Connect** and complete the platform's login/approval popup.
4. The tile flips to **connected**. To remove it later, use **Disconnect**.

Social connections power publishing, reading your analytics, and pulling your brand voice. (Some platforms require the workspace owner to have finished platform setup first; if a tile says it's not available yet, that step is still pending.)

![connecting Instagram via the one-tap flow](images/connections-2.png)

---

## How to connect an API key

1. Open **Connections** and scroll to **API keys & other services**.
2. Use the category filter (AI, Messaging, Email, Calendar, Social, Analytics, Other tools) to find a service, or browse the grid.
3. Click **Connect** on the tile, paste the required key(s), and click **Save**. The tile shows **connected**.
4. To replace a key, click **Update**. To remove it, use the clear (✕) button.

> For some services (HeyGen Hyperframes, Anthropic) the key is **checked against the service before it's saved** — so **connected** means "this key actually works," not just "a key was entered." If the key is wrong, you'll see the error right away instead of at the first failed run.

---

## What each connection unlocks

### Most useful for content & competitor work

| Service | What it unlocks | Where to get it |
|---------|-----------------|-----------------|
| **Apify** | **Competitor Reel Intel** — scraping competitor reels for analysis. This is the key that turns on the Competitors feature. | Free signup at apify.com → copy your API token |
| **Deepgram** | Transcribes a reel's audio when it has no on-screen subtitle track, giving deeper teardowns and powering the "Optimize my reel" scan. Comes with free starting credit. | deepgram.com → API key |
| **Instagram (via Meta)** | Reading your own reel performance (reach, plays, watch time) so the "Optimize my reel" scanner uses real numbers. | A Meta Page access token, or connect Instagram in the Social section |

### Email & messaging

| Service | What it unlocks |
|---------|-----------------|
| **AgentMail** | Email agents — your own inboxes, sending, and replies, all under your AgentMail account. Create the account and API key at agentmail.to. |
| **Gmail** | Reading and composing email through your Gmail. |
| **LoopMessage (iMessage)** | iMessage replies in the [Boardroom](./boardroom.md). |

### AI providers

| Service | What it unlocks |
|---------|-----------------|
| **Anthropic (Claude API)** | The AI that powers your agents. |
| **OpenAI** | An alternative AI provider. |

### Analytics, calendar & social

| Service | What it unlocks |
|---------|-----------------|
| **Plausible** / **Google Analytics 4** | Site traffic data for your agents to reason over. |
| **Google Calendar** | Scheduling and meeting drafts. |
| **X (Twitter)**, **LinkedIn** | Posting and reading via API key (in addition to the one-tap social tiles). |
| **HeyGen Hyperframes** | In-app reel rendering — the **Render** button in [Hyperframes](./hyperframes.md) produces the finished video on your HeyGen account. Create a key at app.heygen.com → Settings → API. Note: HeyGen's API is paid (per-render credits), separate from any web plan. |

---

## Tips

- **Connect Apify first.** It's the single highest-value connection because it unlocks the whole competitor-intel-to-script workflow.
- **Add Deepgram if your reels (or your competitors') don't have captions.** Without it, caption-less reels get a shallower teardown.
- **Connect Instagram before using "Optimize my reel."** Real performance data makes that report dramatically more useful.
- **You can disconnect anytime.** Removing a key only affects the features that use it; the rest of KeyCommand keeps working.
- **Your usage is yours.** Because keys are your own, the [Usage page](./usage.md) reads each vendor's real numbers (Claude tokens, Apify spend, Deepgram credit) straight from your accounts.
