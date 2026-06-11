# KeyCommand V2 — Product Requirements Document
**Project:** KeyCommand (command.keyplayers.com)  
**Author:** Mitch Conquer  
**Version:** 2.0  
**Date:** 2026-05-24  
**Developer:** Brayson  
**Stack:** Next.js 14 + React + Tailwind + Supabase (ca-central-1) + Claude API (Sonnet)

---

## 1. Overview

KeyCommand is the AI-powered command centre that ships with every KeyPlayers Managed VA placement. It gives clients — and their VA — a single dashboard where AI executives run 24/7 alongside the human assistant, a second brain grows from every connected tool, and the ROI of the entire relationship is measured in real time.

This document covers the V2 overhaul: a complete UI redesign, a world-class onboarding wizard, a live ROI tracker anchored to the Key Audit, an AI Boardroom, agent training controls, and Dream Mode.

---

## 2. Design Principles

- **Visual-first.** Real images. Real logos. Real data. No wireframe vibes on a live product.
- **Value before instruction.** The user should see their agents do something useful before the onboarding closes.
- **Progressive disclosure.** Home screen = cockpit. Complexity lives one click deeper.
- **Trust through transparency.** Every agent action is logged. Every recommendation has a reason.
- **Premium but approachable.** Dark, rich, glass-panel aesthetic. Feels like a Bloomberg terminal crossed with a beautiful SaaS dashboard — not a Notion clone.

---

## 3. Visual Design Direction

### 3.1 Design Language — "Liquid Glass Command"

| Element | Spec |
|---------|------|
| Background | Deep near-black `#0A0A0F` base with subtle radial gradient overlay |
| Panels | Frosted glass — `rgba(255,255,255,0.04)` with `backdrop-blur-md`, 1px white/10% border |
| Primary accent | Emerald `#10D982` (active states, live indicators, success) |
| Secondary accent | Warm amber `#F5A623` (alerts, escalations, Dream Mode) |
| Text primary | `#F0F0F0` |
| Text secondary | `#8A8A9A` |
| Font | Inter (body), Sora or Clash Display (headlines) |
| Radii | `rounded-2xl` default, `rounded-3xl` for large cards |
| Shadows | Layered `box-shadow` with subtle color glow matching accent |

### 3.2 Imagery

- Use **GPT-image-1 / DALL-E 3** or **Midjourney** to generate:
  - Hero image for onboarding steps (dark, cinematic, business-relevant)
  - Agent avatar portraits for each AI Executive (photorealistic but slightly abstract — not cartoony)
  - Boardroom background scene for the AI Boardroom page
- Pull **real logos** from Clearbit / SimpleIcons for:
  - Anthropic (Claude) — `anthropic.com`
  - OpenAI (ChatGPT) — `openai.com`
  - Google Drive, Gmail, Google Calendar
  - Slack, Notion, ClickUp, Microsoft 365, Obsidian, Granola
- Logo display: white-on-dark SVG preferred, fallback to brand color initials badge

### 3.3 Animation & Motion

- Page transitions: fade + slight Y-translate (`framer-motion`)
- Card hover: subtle scale `1.01` + border glow
- Onboarding step transitions: smooth horizontal slide
- Live counters: number odometer animation on load
- Dream Mode activation: full-screen dark overlay with floating particle effect (similar to ClaudeOS confetti pattern but stars/particles, not confetti)
- Agent "thinking" state: pulsing ring around avatar

---

## 4. Navigation Redesign

### 4.1 Current → New Sidebar Map

| Current Label | New Label | Notes |
|---------------|-----------|-------|
| Squads | **Agents** | More intuitive for AI context |
| Comms | **Inbox** | Clearer |
| Boardroom | **Boardroom** | Keep — but redesign the page |
| Tasks | **Tasks** | Keep |
| Drafts | **Drafts** | Keep |
| Campaigns | **Campaigns** | Keep |
| Goals | **Goals** | Keep |
| Workspace | **Knowledge** | Rename — this is the business brain |
| Content | **Content** | Keep |
| Research | **Research** | Keep |
| Issues | **Issues** | Keep |
| KPIs | **KPIs** | Keep |
| Analytics | **Analytics** | Keep |
| Settings | **Settings** | Keep |

### 4.2 Sidebar Structure (New)

```
COMMAND
  Overview (Home)
  Boardroom
  Agents
  Dream Mode  ← NEW

WORK
  Tasks
  Inbox
  Drafts
  Campaigns

GROW
  Goals
  KPIs
  Analytics
  Research

BUILD
  Knowledge
  Content
  Automations

SETTINGS
  Integrations
  Settings
```

### 4.3 Top Nav

- Company logo + name (left)
- Post count / Sent count / Pipeline count (center — keep existing data)
- Search (right)
- Notifications bell with unread badge
- Agent status dot (green = agents running, amber = escalation needed, red = error)
- User avatar + plan badge

---

## 5. Home / Overview Page Redesign

### 5.1 Hero Stats Row (top of page)

Three large glass cards, same pattern as ClaudeOS home:

1. **Hours Saved** — `[X] hrs` this month. Sparkline trend. Click → ROI detail page.
2. **Value Reclaimed** — `$[X]` — hours saved × client's dollar-per-hour rate. Sparkline.
3. **Active Agents** — `[X]/[total]` running. Click → Agents page.

### 5.2 Boardroom Preview

Horizontal row of AI Executive cards (condensed). Each card:
- Agent portrait image
- Name + title
- Status chip: `Active` / `Standby` / `Needs Review`
- Last action (1 line)
- "Chat" button → opens chat modal

### 5.3 Dream Mode Summary Card

- Last night's Dream Mode results (most recent 3 cards)
- Amber accent border when unread
- "View full report →" link
- If Dream Mode hasn't run yet: CTA to activate

### 5.4 Activity Feed

Real-time log of agent actions. Each entry:
- Agent avatar + name
- Action description
- Timestamp
- Cost (optional — show if > $0.01)
- Status chip

### 5.5 Connected Integrations Status

Small icon row. Green dot = connected, grey = disconnected. Click → Integrations page.

---

## 6. Onboarding Wizard

> This is the most important feature in V2. It must feel premium, simple, and visually rich. Model it after the ClaudeOS onboarding but designed for a client/VA duo, not a power user.

### 6.1 Trigger Logic

- Fires on first login (no `onboarding_complete` flag in user record)
- Full-screen takeover, same pattern as ClaudeOS
- Progress bar at top (not step numbers — visual bar only)
- Skip not available until Step 6 (after business profile is set)
- Completion fires confetti/particle celebration + sets `onboarding_complete = true`

### 6.2 Visual Treatment Per Step

Each step has:
- **Left panel:** A rich, generated image (dark, cinematic, relevant to the step topic)
- **Right panel:** The form/question (glass card, clean, max 2-3 inputs per screen)
- Step name in small amber caps above the heading
- Smooth horizontal slide transition between steps

### 6.3 Onboarding Steps (Detailed)

---

**STEP 1 — Welcome & Role Selection**

Image: Dark boardroom table with soft window light.

> "Welcome to your Command Centre."
> Subtext: "Let's get you set up. This takes about 4 minutes."

Question: "Who are you setting this up as?"
- [ ] I'm the business owner / client
- [ ] I'm the virtual assistant assigned to this account
- [ ] I'm setting this up for a client (KeyPlayers team)

→ Branches onboarding path based on role. VA path is shorter and focused on connecting tools + understanding agents. Client path goes through Key Audit.

---

**STEP 2 — Business Profile**

Image: Entrepreneur at a desk with laptop and city window.

> "Tell us about your business."

Fields:
- Business name
- Industry (dropdown — Real Estate, Marketing, E-Commerce, Finance, Professional Services, Other)
- Team size (1-5 / 5-20 / 20-100 / 100+)
- Website URL ← triggers Firecrawl scrape (background, non-blocking)
- Social handles: LinkedIn, Instagram (optional but encouraged)

Note under social fields: *"We'll use these to build your business brain — so your agents actually know your brand."*

---

**STEP 3 — Key Audit (The ROI Calculator)**

Image: Split-screen — person overwhelmed with tasks (left) vs. same person relaxed at clean desk (right).

> "Let's find out what your time is actually worth."

Subtext: *"This is the same audit our team runs on sales calls. It takes 60 seconds and it will change how you see your VA."*

**Input fields:**
1. Annual business revenue (or monthly — toggle): `$_____`
2. Estimated annual business profit: `$_____`
3. Hours worked per week by founder/owner: `_____ hrs`
4. Estimated % of those hours spent on admin/ops work: `____%`

**Real-time calculation (shown below the inputs as they type):**

```
YOUR DOLLAR-PER-HOUR VALUE
Before KeyPlayers: $[calc] / hr
  (Annual profit ÷ annual hours worked)

ADMIN HOURS WASTED PER WEEK
[admin%] × [hrs/week] = [X] hrs/week of low-value work
= [X × 52] hrs/year

COST OF THAT TIME
[admin hrs/year] × $[old $/hr] = $[Y] /year trapped in admin

After KeyPlayers (projected):
New $/hr = same profit ÷ (hours - admin hours recovered)
= $[Z] /hr

VALUE RECLAIMED (projected):
[hours saved/year] × $[Z] = $[W] /year
```

This data seeds the Hours Saved tracker and ROI dashboard. Store in `key_audit` table tied to the workspace.

CTA: "This is what your VA is designed to recover. Let's set it up."

---

**STEP 4 — Connect Your Stack**

Image: Clean dark interface with floating integration logos.

> "Connect the tools your business already runs on."

Display logo tiles in a grid (4 per row). Categories:

**Productivity & Docs**
- Google Drive
- Google Docs
- Microsoft 365 / OneDrive
- Notion
- Obsidian
- Granola

**Communication**
- Gmail
- Google Calendar
- Slack
- Microsoft Teams
- Outlook

**Project Management**
- ClickUp
- Asana
- Trello
- Monday.com

**CRM / Sales**
- HubSpot
- GoHighLevel (GHL)
- Salesforce

**Social & Content**
- Instagram (Meta)
- LinkedIn
- YouTube

Each tile: Logo + name. State: Not connected (grey border) / Connecting (amber pulse) / Connected (green border + checkmark).

Clicking a tile opens OAuth flow in a modal (not a new tab).

**Minimum to proceed:** 1 connection required.

"Skip for now" available but shows: *"Your agents work best when connected. You can add more anytime in Settings → Integrations."*

---

**STEP 5 — Meet Your AI Boardroom**

Image: Round boardroom table with four distinct AI figures (photorealistic but slightly stylized).

> "Meet the team that never sleeps."

Animated cards reveal one by one (stagger 200ms) for the 4 default AI Executives:

1. **ATLAS — Chief of Staff** (Orchestrator)
   - Routes everything. Knows what every other agent knows.
   - "Talk to Atlas about anything — he'll get it to the right agent."

2. **REX — Revenue Agent** (CRO)
   - Tracks pipeline, identifies growth opportunities, monitors outreach.

3. **MARA — Growth Agent** (CMO)  
   - Brand, content strategy, campaign performance, competitive moves.

4. **NOVA — Operations Agent** (COO)
   - Workflows, tasks, automation opportunities, efficiency gaps.

Optional unlock (shown as locked cards):
- **VEGA — Finance Agent** (CFO) — unlock with Pro plan
- **ARIA — Client Experience Agent** (CXO) — unlock with Pro plan

Each card: Agent portrait, name, title, 1-line description, specialties as chips.

CTA: "Your agents are ready. Let's activate them."

---

**STEP 6 — Autonomy Settings**

Image: Dial/control panel in a dark cockpit aesthetic.

> "How much should your agents do on their own?"

**The Autonomy Dial** (4 levels, visual slider):

```
[ Observe ] — [ Propose ] — [ Act + Notify ] — [ Full Auto ]

Observe:     Agents watch and report. No actions without you.
Propose:     Agents draft and recommend. You approve before anything sends.
Act + Notify: Agents execute and tell you what they did. You can reverse it.
Full Auto:   Agents run. You review summaries. Recommended for Dream Mode.
```

Default: **Propose** (safe starting point — aggressive enough to feel useful, won't scare them).

Note: "You can change this per agent anytime. Most clients upgrade to Act + Notify within 2 weeks."

---

**STEP 7 — Dream Mode Intro**

Image: Dark city at night with soft glowing screens in an office.

> "Every morning, your AI team will have already been working."

Subtext: "Dream Mode activates each night. Your agents research, find gaps, test workflows, and build a briefing. You wake up to a prioritised to-do list — not a blank Monday."

Toggle: `Enable Dream Mode` — default ON.

Schedule: "Runs nightly at 2:00 AM your time." (auto-detected timezone, editable)

---

**STEP 8 — First Agent Run (The "Wow Moment")**

Image: Live data visualization / agent working graphic.

> "Let's see your agents in action."

Trigger: Atlas (Chief of Staff) runs a first analysis using whatever was connected in Step 4. Examples:
- If Google Drive connected: "I found 47 files in your Drive. Here are the 3 most relevant to your stated goals."
- If Slack connected: "I scanned last week's Slack activity. Here are 3 workflow bottlenecks your team mentioned."
- If website connected via Firecrawl: "I've read your website. Here's a 3-sentence brief of your business that I've added to the knowledge base."

Show a live "thinking" animation (pulsing ring + typing indicator) for 3-5 seconds, then reveal the result.

CTA: "Your command centre is ready." → [Enter the Dashboard] → confetti/particle celebration → redirect to home.

---

## 7. AI Boardroom

### 7.1 Page Layout

Full-page dark design. Top: large headline "YOUR BOARDROOM". Subtext: "AI executives running 24/7. Ask anything."

Layout: 2-column grid of Executive cards at top. Below: full-width chat interface.

### 7.2 Executive Cards

Each card:
- Full agent portrait (tall, cinematic crop)
- Name + title
- Status: `Active` / `Standby`
- Last action summary (1 line, relative time)
- Specialty tags (3-4 chips)
- "Chat with [Name]" button → opens dedicated chat modal
- "View Activity" → filter activity feed to this agent

### 7.3 Chat Interface

Two modes:
1. **Chat with Atlas (Chief of Staff)** — default. Atlas routes to appropriate agent or answers cross-domain.
2. **Chat with specific executive** — click their card. Modal opens with that agent's context and conversation history.

Chat input:
- Full markdown support in responses
- Agent responses include source citations where relevant ("Based on your Google Drive folder...")
- "Thinking" state with animated avatar
- Message history persisted per agent per workspace

### 7.4 Agent Training / Re-prompting

> This is a core V2 feature. Both the VA and client should be able to improve agents over time.

Location: Boardroom → click any Executive card → "Train this Agent" tab (alongside Activity, Chat)

**Training Interface:**

```
AGENT INSTRUCTIONS
[Editable textarea — current system prompt in plain English, not raw JSON]

Placeholder: "Describe how this agent should behave, what to prioritise, 
and any specific context about your business..."

CHARACTER TRAITS
[ ] Formal  [ ] Casual  [ ] Concise  [ ] Detailed  [ ] Proactive  [ ] Conservative

FOCUS AREAS (select up to 5)
[ ] Email drafting  [ ] Research  [ ] Social media  [ ] Reporting  [ ] Calendar management
[ ] CRM updates  [ ] Client communication  [ ] Content creation  [ ] Data analysis

EXAMPLES (optional)
"When I ask for a summary, always include: [user types example output format]"

[Preview changes] → shows example response with new instructions
[Save & Apply]    → stores in Supabase, applies to next agent call
[Reset to default]
```

**Version History:** Last 5 saved instruction versions with timestamps. One-click restore.

**Permission level:** Both client and VA can train agents. VA changes are flagged to client in activity log ("Olivia updated Atlas instructions — [view change]").

---

## 8. Hours Saved & ROI Tracker

### 8.1 Data Model

```
key_audit: {
  workspace_id
  annual_revenue
  annual_profit
  hours_per_week
  admin_percentage
  old_dollar_per_hour      (calculated)
  projected_new_dollar_per_hour (calculated)
  created_at
  updated_at
}

time_savings_log: {
  workspace_id
  agent_id (nullable — for agent-attributed savings)
  action_type  (e.g., "email_drafted", "research_completed", "report_generated")
  minutes_saved
  dollar_value_saved       (minutes_saved × new_dollar_per_hour / 60)
  logged_at
}
```

### 8.2 Calculation Logic

**Old $/hr:** `annual_profit ÷ (hours_per_week × 52)`

**Admin hours/week wasted:** `hours_per_week × (admin_percentage / 100)`

**New $/hr (projected):** `annual_profit ÷ ((hours_per_week - admin_hours_recovered) × 52)`
- `admin_hours_recovered` = total hours saved by agents to date (from `time_savings_log`)

**Value reclaimed:** `SUM(time_savings_log.dollar_value_saved)` cumulative

### 8.3 Time Savings Attribution

Each agent action type has a preset minutes_saved estimate (configurable per workspace):
- Email drafted: 8 min
- Research summary: 20 min
- Report generated: 25 min
- CRM update: 5 min
- Meeting notes processed: 15 min
- Content draft: 30 min
- Calendar scheduled: 5 min
- Document summarized: 10 min

VA can also manually log savings: "I used the research agent and it saved me 45 minutes on this report" → adds to log.

### 8.4 ROI Dashboard Page

Metrics:
- Total hours saved (all time + this month)
- Total value reclaimed ($)
- Old $/hr vs. new $/hr (side by side, with delta badge)
- Agent breakdown — which agent saved the most time
- Monthly trend chart (bar graph — hours saved per month)
- Projected annual value (hours saved this month × 12 × new $/hr)

The "Value Reclaimed" and "Hours Saved" numbers from Step 3 are estimates. As actual logs accumulate, the tracker transitions from "projected" to "actual" — shown with a label change and different color treatment.

---

## 9. Dream Mode

### 9.1 What It Is

An overnight autonomous research and analysis session. Runs nightly (default 2 AM). Accesses all connected tools. Produces a morning briefing of actionable insights, gap analysis, and workflow improvements.

Mirrors the ClaudeOS Dream Engine pattern but scoped to business operations (not personal AI stack).

### 9.2 Dream Mode Page

**Activation state (if not yet run):**
Dark atmospheric page. Centered: moon/stars visual. "Activate Dream Mode" CTA. Description of what it does.

**Active state:**
- Schedule display: "Runs nightly at 2:00 AM EST"
- Last run: "[date] at 2:03 AM — [X] insights generated"
- Toggle on/off
- Autonomy setting for Dream Mode specifically (recommended: Full Auto)

**Morning Briefing (the deliverable):**

Cards in a horizontal scroll row, similar to ClaudeOS DreamCard system:

```
Card types:
- opportunity    (green border) — "New revenue move identified"
- efficiency     (blue border) — "Workflow you could automate"
- risk           (amber border) — "Issue you should know about"
- competitive    (purple border) — "Market signal"
- follow_up      (grey border) — "Things that need your attention today"
```

Each card:
- Type badge (colored)
- Headline (bold, max 12 words)
- 2-3 sentence explanation
- Source: where the insight came from ("Based on your Slack messages, 3 recurring complaints about...")
- Estimated time to act (e.g., "5 min" / "30 min" / "Delegate")
- Action buttons: [Assign to Agent] [Add to Tasks] [Dismiss]
- If monetary: show `$[X] opportunity` or `[Y] hrs/week recoverable` badge

**Morning Digest Email / Slack message:**
- Sent at 7:00 AM (configurable)
- Top 3 Dream Mode cards
- Link back to full briefing in KeyCommand
- Can be sent to client, VA, or both (configured per workspace)

### 9.3 What Dream Mode Accesses

- Connected Google Drive / OneDrive folders
- Slack message history (last 7 days by default)
- ClickUp / Notion tasks (open, overdue, blocked)
- Gmail (unread emails flagged as high priority)
- Knowledge base (checks for gaps — topics mentioned in comms but not documented)
- External: industry news via web search (optional — toggle per workspace)

### 9.4 Dream Mode Technical Notes

- Run via Supabase Edge Function on cron schedule
- Claude API Sonnet — structured output (JSON schema for card types)
- Rate limited: max 1 full run per 24 hours
- Token budget per run: configurable, default ~100K tokens
- Store all runs in `dream_sessions` table with full output for history

---

## 10. Knowledge Base / Business Brain

### 10.1 What It Is

A single, ever-growing repository that all agents pull from. Everything the company knows — brand, clients, products, SOPs, past research, team preferences — lives here and is accessible to every agent.

Populated by:
- Firecrawl website scrape (onboarding Step 2)
- Social media profile pulls (onboarding Step 2)
- Manual uploads (PDFs, docs, URLs)
- Agent-generated content (research outputs, summaries, briefings auto-added)
- Connected tool sync (Google Drive files, Notion pages, ClickUp task context)

### 10.2 Firecrawl Integration

On website URL submission (Step 2 of onboarding):
1. Background Firecrawl scrape of full website
2. Extract: brand voice, services/products, team info, testimonials, contact details
3. Structure into `knowledge_nodes` with source URL and type tags
4. Displayed in Knowledge page as "Website Brain" section
5. Agents immediately gain access on completion

On social handle submission:
1. Pull public profile data (bio, recent posts — where API allows)
2. Extract brand voice signals, content topics, audience language
3. Store as `brand_voice_profile` knowledge node

### 10.3 Knowledge Page

List view of all knowledge nodes. Filters: All / Website / Uploads / Agent-generated / Integrations

Each node:
- Title + type badge
- Source (icon + URL/filename)
- Date added
- Last used by agent (with agent name)
- Edit / Delete controls

**Add knowledge:** Drag & drop files, paste URL, paste text directly, connect a Notion page, connect a Google Drive folder (auto-sync toggle).

---

## 11. Integrations Page

### 11.1 Layout

Categorized tile grid. Each tile: logo, name, status, connect/disconnect button.

Categories:
1. **AI Providers** — Anthropic (Claude), OpenAI (ChatGPT) — show real logos prominently
2. **Productivity** — Google Drive, Notion, Obsidian, Granola, Microsoft 365
3. **Communication** — Gmail, Slack, Outlook, Microsoft Teams, Google Calendar
4. **Project Management** — ClickUp, Asana, Trello, Monday.com, Linear
5. **CRM** — HubSpot, GoHighLevel, Salesforce, Pipedrive
6. **Social** — Instagram, LinkedIn, YouTube, X

### 11.2 Connected State

Each connected integration shows:
- Green connected badge
- Last synced timestamp
- "Re-sync now" button
- Sync scope settings (e.g., which Google Drive folders to include)
- Disconnect button

### 11.3 AI Provider Display

Anthropic (Claude) and OpenAI (ChatGPT) cards are styled differently — premium treatment. Show:
- Logo
- Model in use (e.g., "claude-sonnet-4-6")
- Token usage this month
- Cost this month
- Status: Live

---

## 12. Feature Priority Matrix

### MUST HAVE (Phase 1 — Target Launch)

| # | Feature | Why |
|---|---------|-----|
| 1 | Onboarding Wizard (all 8 steps) | First impression. Activation depends on this. |
| 2 | Key Audit + ROI Calculator | Core lead magnet + value proof. Clients remember the number. |
| 3 | Hours Saved / Value Reclaimed tracker | Makes the ROI tangible. Retention driver. |
| 4 | AI Boardroom (4 executives + chat) | The hero feature. What clients are paying for. |
| 5 | Agent Training / Re-prompting | Required for agents to improve over time. |
| 6 | Firecrawl website scrape on onboarding | Business brain can't start empty. |
| 7 | Core integrations (Google Drive, Slack, Gmail, Notion, ClickUp) | Minimum viable connected stack. |
| 8 | Dream Mode (basic — nightly briefing) | Flagship differentiator. Name it. Market it. |
| 9 | Navigation redesign (Squads → Agents, clean sidebar) | Current nav is scattered. Blocks everything feeling premium. |
| 10 | Knowledge Base (manual + Firecrawl-fed) | Agents are useless without context. |

### NICE TO HAVE (Phase 2 / Post-Launch)

| # | Feature | Why |
|---|---------|-----|
| 1 | Autonomy Dial per-agent granular control | Phase 1 can be workspace-level. Per-agent is ideal but complex. |
| 2 | Morning Digest email/Slack push | High retention value but needs email infra. |
| 3 | Additional AI Executives (CFO, CXO — locked to Pro) | Natural upsell. Phase 2. |
| 4 | Agent version history / rollback | Good to have, not blocking. |
| 5 | Manual time savings logging by VA | Nice for accuracy, not required. |
| 6 | Mobile escalation push notifications | Important for "Act + Notify" mode. Post-Phase 1. |
| 7 | Multi-agent conversation thread view | Shows how agents collaborate. Trust-building but complex. |
| 8 | White-label theming (client logo on dashboard) | Future enterprise feature. |
| 9 | Competitive intelligence cards in Dream Mode | External web search adds cost and complexity. |
| 10 | Agent benchmark comparisons ("top 20% of accounts") | Needs enough user base to be meaningful. |

---

## 13. Database Tables (New/Modified)

```sql
-- Key Audit storage
key_audit (
  id uuid primary key,
  workspace_id uuid references workspaces(id),
  annual_revenue numeric,
  annual_profit numeric,
  hours_per_week numeric,
  admin_percentage numeric,
  old_dollar_per_hour numeric generated,
  created_at timestamptz,
  updated_at timestamptz
)

-- Time savings tracking
time_savings_log (
  id uuid primary key,
  workspace_id uuid references workspaces(id),
  agent_id uuid references agents(id),
  action_type text,
  minutes_saved numeric,
  dollar_value_saved numeric,
  source text,
  logged_at timestamptz
)

-- Agent instructions versioning
agent_instruction_versions (
  id uuid primary key,
  agent_id uuid references agents(id),
  workspace_id uuid references workspaces(id),
  instructions text,
  traits jsonb,
  focus_areas jsonb,
  created_by uuid references users(id),
  created_at timestamptz,
  is_active boolean default false
)

-- Dream Mode sessions
dream_sessions (
  id uuid primary key,
  workspace_id uuid references workspaces(id),
  run_at timestamptz,
  cards jsonb,
  sources_accessed jsonb,
  total_tokens_used integer,
  status text  -- 'complete' | 'error' | 'running'
)

-- Knowledge nodes
knowledge_nodes (
  id uuid primary key,
  workspace_id uuid references workspaces(id),
  title text,
  content text,
  source_type text,  -- 'website' | 'upload' | 'agent' | 'integration'
  source_url text,
  last_used_by_agent uuid,
  last_used_at timestamptz,
  created_at timestamptz
)
```

All tables: RLS enabled. Workspace-scoped policies only.

---

## 14. Open Questions for Brayson

1. **Firecrawl API key** — do we have one set up, or do we need a new account? Confirm env var name.
2. **OAuth for integrations** — which OAuth providers are already wired up vs. net new? Google is likely the first to ship.
3. **Agent execution layer** — are agents currently running via Edge Functions or a separate service? This affects how Dream Mode cron is built.
4. **Onboarding path split** (client vs. VA) — the Key Audit section is client-only. Confirm: does the VA see a simplified onboarding that skips the audit?
5. **Image generation** — Mitch will source/generate the onboarding step images. Brayson just needs to wire up the image slot per step (static asset, configurable path).
6. **Email/Slack for Dream Mode digest** — is there an email provider already set up (Sendblue / Resend)? This can be Phase 2 but worth confirming.

---

## 15. Handoff Notes

- Reference **ClaudeOS** (`~/Desktop/ClaudeOS`) for: onboarding trigger logic, DreamCard data model, global Zustand store pattern, confetti/particle celebration.
- Reference **KeyMatch** (`~/Desktop/KeyMatch`) for: component patterns, Supabase client setup, auth flow.
- Existing **KeyCommand** Supabase project: `qdlfesoejaoxfqziubpd` (ca-central-1).
- KeyBrain bridge: `KEYBRAIN_SUPABASE_URL`, `KEYBRAIN_SERVICE_ROLE_KEY`, `KEYBRAIN_BRIDGE_API_KEY` — agents should be able to pull from KeyBrain knowledge base where relevant.
- All new tables go in KeyCommand Supabase project. RLS on everything.
- Claude API: use `claude-sonnet-4-6` as default model. Prompt caching enabled on agent system prompts (they're large and static).

---

*End of Document — KeyCommand V2 PRD — 2026-05-24*
