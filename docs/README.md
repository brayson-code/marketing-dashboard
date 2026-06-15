# KeyCommand Documentation

**KeyCommand** is a marketing command center that pairs a team of AI agents with your own social and tooling accounts. It watches your competitors, tears down what's working, turns winning ideas into scripts you can record, and drafts your content, emails, and outreach — while you keep final approval over everything that goes out.

![the KeyCommand Overview dashboard on first load](images/readme-1.png)

---

## What you can do with KeyCommand

- **Watch competitors automatically.** Track competitor Instagram handles, scrape their reels on a schedule, and get an agent's breakdown of *why each reel won*.
- **Turn trends into content.** See what's hot across everything you've analyzed, generate trial reel concepts, and scan your own reels for a full optimization report.
- **Write and record scripts.** Generate reel scripts from a kept idea or a competitor teardown, edit them, and read them off a built-in teleprompter.
- **Run a team of agents.** A roster of specialist agents (research, content, outreach, and more) does the work; you can view, edit, and create them in the Agent Studio.
- **Stay in control.** Everything agents produce lands in **Approvals** for your one-tap approval. You decide how much autonomy they have.
- **Reply where it counts.** Triage YouTube and Instagram comments, inbound email, and SMS with one-click AI-drafted replies — approved by you, posted through your own accounts.
- **Connect your stack.** Bring your own API keys and social accounts so agents act through *your* tools and *your* brand. A single **Connect Google** unlocks Drive, Docs, Sheets, Gmail, Calendar, and Meet in one step.
- **Teach the team your business once.** A short **company playbook** captures your objective, audience, and voice, and every agent reads it before doing any work.
- **Launch missions toward any objective.** Content blitz, outreach push, research sprint — describe what you want, review the wave plan, and watch it run.
- **Set a daily spend cap.** A token budget keeps autonomous agent runs in check; your interactive chat is never blocked.
- **Take your data with you.** One-click export of everything your workspace created — documents, agents, CRM, automations, and history.

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
| [Engagement](./engagement.md) | Triage YouTube/Instagram comments, inbound email, and SMS in one place |
| [Tasks Board](./tasks.md) | Watch every agent run live and steer the work from a kanban board |
| [Analytics](./analytics.md) | Web + social performance — YouTube, Instagram, Facebook Ads, and TikTok |
| [Connections](./connections.md) | Connect social accounts, API keys, Google, Twilio, Telegram, and MCP servers |
| [Google Workspace](./google-workspace.md) | One connection: Docs, Sheets, Drive, Gmail, Calendar, and Meet for your agents |
| [SMS & Text Messaging](./sms.md) | Send texts via Twilio and manage replies in the SMS inbox |
| [MCP Servers](./connectors-mcp.md) | Plug in remote MCP servers to extend what your agents can do |
| [Approvals](./drafts.md) | The approval queue — real publishing to X, LinkedIn, Facebook, YouTube, Instagram, and email |
| [Cron / Scheduled Jobs](./cron.md) | Run agents on a recurring schedule; daily follow-ups keep your CRM warm |
| [Goals, Campaigns & Missions](./goals-and-missions.md) | Set outcomes, group work into campaigns, and launch missions toward any objective |
| [Usage & Spend](./usage.md) | Track what your agents cost; set a daily token budget to stay in control |
| [Your Data](./your-data.md) | Export everything your workspace created — your data is yours |
| [Boardroom](./boardroom.md) | Chat with your lead agent and watch agents talk to each other |

**Reference**

- [Getting Started](./getting-started.md) — sign in, connect your Claude key and Google, and what to do first
- [Concepts & Glossary](./concepts.md) — agents, drafts, goals, the autonomy gate, and more

---

## New here? Start with these three

1. **[Getting Started](./getting-started.md)** — sign in, connect your Claude key (step one — agents stay paused until you do), and let the guided walkthrough lead you through setup.
2. **[Competitor Reel Intel](./competitors.md)** — paste a competitor's reel link and watch an agent break it down. It's the fastest way to see KeyCommand in action.
3. **[Content Lab](./content-lab.md) (in the nav as "Content Lab")** — turn what you learned into reel concepts and scripts.

---

## Publishing these docs

These files are plain Markdown, so the simplest way to make them public is **GitHub Pages**: in your repository settings, open **Settings → Pages**, choose the branch that holds this folder, and set the source folder to `/docs`. GitHub will host the docs at a public URL within a minute. If you'd rather use a dedicated docs site, you can paste these files into a [Notion](https://www.notion.so) page or import the `docs/` folder into a [Mintlify](https://mintlify.com) or [Docusaurus](https://docusaurus.io) project — the Markdown will carry over with its headings, links, and tables intact. To add images later, drop screenshots into a `docs/images/` folder and replace the `> _Screenshot: …_` placeholder lines with standard Markdown image tags (`![caption](images/your-file.png)`).
