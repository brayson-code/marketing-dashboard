# Getting Started

This page walks you through your first session in KeyCommand: signing in, getting your bearings on the Overview, connecting your first account, and choosing what to do first.

![the KeyCommand sign-in screen](images/getting-started-1.png)

---

## 1. Sign in

KeyCommand opens to a sign-in screen. There are two ways in:

- **Email + password** — enter the credentials for your KeyCommand account and click **Sign in**.
- **Continue with Google** — sign in with the Google account that uses the **same email** as your KeyCommand account. The first time, it links to your existing account automatically, and your password keeps working alongside it.

If you don't have an account yet, ask your KeyCommand administrator to create one for you — KeyCommand is invite-only, so signing in with a brand-new Google account won't create a workspace either. Each account belongs to a single workspace — everything you create (competitors, scripts, drafts, connections) stays private to your workspace.

> **Forgot your password or can't get in?** Contact whoever set up your workspace. There's no public self-serve signup.

---

## 2. Get your bearings on the Overview

After you sign in, you land on the **Overview** — your home base. From top to bottom you'll see:

- **Lens tabs** at the very top let you switch which part of the team you're looking at (Leadership, Marketing, Revenue, Operations, Client Experience).
- A **status strip** of key metrics.
- A **72-hour activation card** that nudges you through your first wins (it disappears once you're set up).
- Your **goals** and **top priorities**.
- A row of **agent cards** — the AI specialists on the active team.
- The **Operator Queue** — things waiting for your decision.
- **Competitor Intel** and **Content Lab** preview cards.
- Your **Claude usage / spend** at the bottom.

Don't worry about understanding every widget yet. The [Overview page](./overview.md) explains each one.

![the Overview with the activation card and agent cards visible](images/getting-started-2.png)

---

## 3. Connect your Claude key — step one

**This is the first thing to do, before anything else.** Your AI team runs on **your own Anthropic (Claude) key**, so your data and your AI spend stay under your account. Until that key is connected, **your agents stay paused** — KeyCommand won't run any of them on a borrowed key.

1. Open **Connections** from the left navigation.
2. In **AI providers**, find the **Anthropic (Claude API)** tile.
3. Click **Connect**, paste your Anthropic API key, and click **Save**. The key is checked against Anthropic before it's saved, so **connected** means it actually works. Once it's connected, your agents wake up.

> Don't have a key yet? Create one at [console.anthropic.com](https://console.anthropic.com) → **API Keys**.

---

## 4. Let the guided walkthrough lead the way

The first time you open KeyCommand, a **guided setup walkthrough** kicks in. It's an active tour: a small coaching bubble points at exactly which tab to click for each setup step, in order — starting with **Connect your Claude key** above — and retires each step the moment you actually finish it. A persistent **Finish setup** checklist tracks your progress so you can pick up where you left off.

You don't have to follow it in lockstep — click **Skip** on any step or **Turn off** to dismiss the tour — but it's the fastest way to a working workspace. The required steps are: connect your Claude key, pick a plan, turn on your AI executives, set a goal, and build your [company playbook](./concepts.md#company-playbook).

---

## 5. Build your company playbook

Open **Settings** — the **Company brief** card sits at the top — and answer a few short questions about your business: what you do, your #1 objective, your ideal customer, your voice, and your hard no-gos. KeyCommand turns those answers into a tight **business brief** that **every agent and the orchestrator read before doing any work**, so your AI team sounds like *your* business instead of generic. You can regenerate or hand-edit it anytime. See [the company playbook in Concepts](./concepts.md#company-playbook).

---

## 6. Connect your other accounts

KeyCommand is most useful once it can act through *your* accounts. Back on **Connections**, there are two kinds of connections beyond your Claude key:

- **Social accounts** (Instagram, Facebook, LinkedIn, YouTube, X, TikTok) connect with one tap — you log in to the platform and approve access.
- **API keys & other services** (Apify, Deepgram, AgentMail, and more) connect by pasting a key you create on that service's website.

**Next after your Claude key, connect Apify.** It's the key that unlocks Competitor Reel Intel — the feature that best shows off what KeyCommand can do.

1. Open **Connections**.
2. Scroll to **API keys & other services** and find the **Apify** tile.
3. Click **Connect**, paste your Apify API token, and click **Save**.

See the [Connections page](./connections.md) for what every connection unlocks and where to get each key.

![the Connections page with the Apify tile highlighted](images/getting-started-3.png)

---

## 7. Do your first real thing

Now you're set up. Here's the fastest path to seeing value:

1. **Analyze a competitor reel.** Open **Content → Competitors**, paste any Instagram reel link into the **Analyze reels** box, and click **Analyze**. Watch the live board scrape it and tear down *why it won*. → [Competitor Reel Intel](./competitors.md)
2. **Generate content ideas.** Open **Content → Ideas** and hit **Generate ideas** to spin up trial reel concepts based on what's trending. → [Content Lab](./content-lab.md)
3. **Write a script.** Keep an idea you like and click **Write script**, then open **Content → Scripts** to edit it and run the teleprompter. → [Script Studio](./script-studio.md)
4. **Check your Approvals.** Anything your agents create for approval waits in **Approvals**. Approve what you like; reject the rest. → [Approvals](./drafts.md)

---

## A note on control

KeyCommand never publishes, sends, or posts anything without your say-so by default. Agents draft; you approve. When you're ready to let them do more on their own, you raise the **autonomy** setting — but that's always your choice. See [the autonomy gate in Concepts](./concepts.md#the-autonomy-gate).

---

**Next:** [Overview / Dashboard →](./overview.md)
