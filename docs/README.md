# KeyCommand Documentation

**KeyCommand** is a marketing command center that pairs a team of AI agents with your own social and tooling accounts. It watches your competitors, tears down what's working, turns winning ideas into scripts you can record, and drafts your content, emails, and outreach — while you keep final approval over everything that goes out.

These docs are written for the people who **use** KeyCommand day to day: marketers, founders, and operators. You don't need to be technical. Every page tells you what a feature is, why it matters, and exactly how to use it.

![the KeyCommand Overview dashboard on first load](images/readme-1.png)

---

## What you can do with KeyCommand

- **Watch competitors automatically.** Track competitor Instagram handles, scrape their reels on a schedule, and get an agent's breakdown of *why each reel won*.
- **Turn trends into content.** See what's hot across everything you've analyzed, generate trial reel concepts, and scan your own reels for a full optimization report.
- **Write and record scripts.** Generate reel scripts from a kept idea or a competitor teardown, edit them, and read them off a built-in teleprompter.
- **Run a team of agents.** A roster of specialist agents (research, content, outreach, and more) does the work; you can view, edit, and create them in the Agent Studio.
- **Stay in control.** Everything agents produce lands in **Approvals** for your one-tap approval. You decide how much autonomy they have.
- **Connect your stack.** Bring your own API keys and social accounts so agents act through *your* tools and *your* brand. Your AI team runs on your own Claude key — connect it first and your agents come to life.
- **Teach the team your business once.** A short **company playbook** captures your objective, audience, and voice, and every agent reads it before doing any work.

---

## Feature map

| Area | What it's for |
|------|---------------|
| [Overview / Dashboard](./overview.md) | Your home base — agents, goals, the operator queue, competitor and content cards |
| [Agents & Agent Studio](./agents.md) | View, edit, and create the AI specialists that do the work |
| [Competitor Reel Intel](./competitors.md) | Watch competitor reels and tear down why they won |
| [Content Lab](./content-lab.md) | Trend Radar, Trial Reel Generator, and the "Optimize my reel" scanner |
| [Script Studio](./script-studio.md) | Edit reel scripts and read them off a teleprompter |
| [Hyperframes](./hyperframes.md) | Turn a brief into a short-form script + storyboard, then hand it to HeyGen |
| [Media Library](./media.md) | Drop your own a-roll, b-roll, and images for agents and reels to draw from |
| [Connections](./connections.md) | Connect your social accounts and API keys (Apify, Deepgram, AgentMail, Instagram, and more) |
| [Approvals](./drafts.md) | The approval queue — nothing ships without you |
| [Cron / Scheduled Jobs](./cron.md) | Run agents on a recurring schedule |
| [Boardroom](./boardroom.md) | Chat with your lead agent and watch agents talk to each other |
| [Goals, Campaigns & Missions](./goals-and-missions.md) | Set outcomes, group work into campaigns, and launch missions |
| [Usage & Spend](./usage.md) | Track what your agents cost across Claude, Apify, and Deepgram |

**Reference**

- [Getting Started](./getting-started.md) — sign in, set up, and what to do first
- [Concepts & Glossary](./concepts.md) — agents, drafts, goals, the autonomy gate, and more

---

## New here? Start with these three

1. **[Getting Started](./getting-started.md)** — sign in, connect your Claude key (step one — agents stay paused until you do), and let the guided walkthrough lead you through setup.
2. **[Competitor Reel Intel](./competitors.md)** — paste a competitor's reel link and watch an agent break it down. It's the fastest way to see KeyCommand in action.
3. **[Content Lab](./content-lab.md)** — turn what you learned into reel concepts and scripts.

---

## Publishing these docs

These files are plain Markdown, so the simplest way to make them public is **GitHub Pages**: in your repository settings, open **Settings → Pages**, choose the branch that holds this folder, and set the source folder to `/docs`. GitHub will host the docs at a public URL within a minute. If you'd rather use a dedicated docs site, you can paste these files into a [Notion](https://www.notion.so) page or import the `docs/` folder into a [Mintlify](https://mintlify.com) or [Docusaurus](https://docusaurus.io) project — the Markdown will carry over with its headings, links, and tables intact. To add images later, drop screenshots into a `docs/images/` folder and replace the `> _Screenshot: …_` placeholder lines with standard Markdown image tags (`![caption](images/your-file.png)`).
