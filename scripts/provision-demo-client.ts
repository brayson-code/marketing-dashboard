// scripts/provision-demo-client.ts
//
// Stands up a live, niche-tuned DEMO client tenant in the TEST Supabase project
// (ref dgcanicamgdeqehnvcmc). IDEMPOTENT on business_profile.demo_slug.
//
// Ships three presets:
//   --slug landscaping-bobby   → Bobby's Landscaping (DEMO)
//   --slug construction-demo   → Northstar Construction (DEMO)
//   --slug hvac-demo           → Summit Heating & Air (DEMO)
// or bring your own: --file <niche-spec.json>
//
// The TEST project has NO service-role key, so the demo owner
// (demo+<slug>@keyplayershq.com) is created with DIRECT SQL (see
// scripts/lib/test-seed-common.ts), and its login password is TEST_LOGIN_PASSWORD
// (never hardcoded, never printed) — so the HQ owner can log in AS the demo owner
// to browse the niche-tuned Command Center (there is no tenant switcher; the JWT
// tenant claim decides the active workspace).
//
// All per-tenant writes reuse the app's own validated, tenant-scoped lib helpers
// (upsertAgentDef / createGene / createCampaign / setEnabledViews /
// saveCompanyPlaybook) inside runWithTenant, so we inherit their idempotency guards
// instead of hand-writing SQL.
//
// Run (seed-test-env.ts must have run first so brayson exists + DEFAULT_TENANT_ID is set):
//   npx tsx --env-file=.env.test.local scripts/provision-demo-client.ts --slug landscaping-bobby
//   npx tsx --env-file=.env.test.local scripts/provision-demo-client.ts --slug construction-demo
//   npx tsx --env-file=.env.test.local scripts/provision-demo-client.ts --slug hvac-demo
//   npx tsx --env-file=.env.test.local scripts/provision-demo-client.ts --file ./niche-spec.json

import fs from 'node:fs';
import { sql } from '../src/lib/db/client';
import { runWithTenant, DEFAULT_TENANT_ID } from '../src/lib/tenant';
import { createWorkspace } from '../src/lib/workspace';
import { upsertAgentDef } from '../src/lib/agent-defs';
import { createGene } from '../src/lib/genes';
import { createCampaign, updateCampaign } from '../src/lib/campaigns';
import { setEnabledViews, TOGGLEABLE_HREFS } from '../src/lib/command-center-views';
import { saveCompanyPlaybook, type PlaybookAnswers } from '../src/lib/company-playbook';
import { INDUSTRY_TEMPLATES } from '../src/lib/dashboard-layout';
import { activateAndLaunchQuickMission } from '../src/lib/activation';
import {
  assertTestProject,
  isUuid,
  requireEnv,
  ensurePgcryptoSchema,
  ensureAuthUser,
  stampTenantClaim,
  ensureMembership,
  findUserIdByEmail,
  tenantIdByDemoSlug,
  mergeBusinessProfile,
  seedOrgChart,
} from './lib/test-seed-common';

const OWNER_EMAIL = 'brayson@keyplayershq.com';

// ── Input contract (niche spec) ───────────────────────────────────────────────

type AgentRole = 'research' | 'content' | 'outreach' | 'scheduler' | 'creative' | 'general' | 'orchestrator';

interface DemoAgentSpec {
  id: string;               // agent slug (/^[a-z0-9][a-z0-9-]*$/, <=64)
  name: string;
  role: AgentRole;
  description: string;
  soul: string;
  agent_md: string;
  skills: string;
}
interface DemoGeneSpec {
  name: string;             // explicit slug → deterministic idempotency (ON CONFLICT (tenant_id,name))
  title: string;
  instruction: string;      // gene body — injected once ACTIVE
  role: string;             // must match roleFor(agentId) (custom ids → 'general') for injection
  agentId?: string | null;  // null = whole role; or pin to a specific agent id
  state?: 'proposed' | 'active';
}
interface DemoMissionSpec {
  name: string;
  brief: string;
  channels?: string[];
}
interface NicheSpec {
  slug: string;             // 'landscaping-bobby' — the idempotency key
  name: string;             // workspace display name, e.g. "Bobby's Landscaping (DEMO)"
  industry: string;         // stored in business_profile.industry
  brief: string;            // company brief markdown → business_profile.playbook
  answers?: PlaybookAnswers;
  viewKeys: string[];       // KeyCommand view keys to ENABLE
  agents: DemoAgentSpec[];  // 5 custom agents
  genes: DemoGeneSpec[];
  mission: DemoMissionSpec; // one inert (paused) campaign container
}

// ── KeyCommand view-key → this product's nav href ─────────────────────────────
// The stored map (business_profile.command_center_views) is SUBTRACTIVE: a missing
// key = ON. We map viewKeys → enabled hrefs, then write an explicit {href:bool} for
// EVERY toggleable href so the client sees exactly the requested nav.

const KEYCOMMAND_VIEW_MAP: Record<string, string> = {
  // Home
  tasks: '/tasks', approvals: '/drafts', drafts: '/drafts', goals: '/goals',
  // Agents
  agents: '/agents/squads', squad: '/agents/squads', skills: '/agents/skills', boardroom: '/boardroom',
  // Marketing
  content: '/content/overview', 'content-lab': '/content/overview', campaigns: '/campaigns',
  missions: '/missions', outreach: '/outreach', research: '/research',
  // Revenue
  crm: '/crm', roi: '/roi', salesops: '/salesops',
  // Insights
  analytics: '/analytics', kpis: '/kpis', usage: '/usage', knowledge: '/kg', kg: '/kg',
  // Ops
  workspace: '/agents/workspace', studio: '/agents/workspace', reports: '/memory', memory: '/memory',
  learning: '/learning', genes: '/genes', cron: '/cron', schedules: '/cron', activity: '/activity',
  // General
  connections: '/connections', integrations: '/connections', billing: '/billing',
  autonomy: '/autonomy', docs: '/docs',
};

function buildViewPatch(viewKeys: string[]): Record<string, boolean> {
  const enabled = new Set<string>();
  for (const k of viewKeys) {
    const href = KEYCOMMAND_VIEW_MAP[k];
    if (!href) { console.warn(`  [warn] unknown view key '${k}' — skipped`); continue; }
    enabled.add(href);
  }
  const patch: Record<string, boolean> = {};
  for (const href of TOGGLEABLE_HREFS) patch[href] = enabled.has(href);
  return patch;
}

// ── Shared posture text reused across agent souls ─────────────────────────────
const DRAFT_ONLY =
  'DRAFT-ONLY POSTURE: you never send, publish, book, or bill anything yourself. ' +
  'You produce a draft, state plainly what it says and who it is for, and stop. A ' +
  'human (the owner or office manager) reviews and approves every outbound action.';

// ── Presets ───────────────────────────────────────────────────────────────────

const LANDSCAPING_BOBBY: NicheSpec = {
  slug: 'landscaping-bobby',
  name: "Bobby's Landscaping (DEMO)",
  industry: 'landscaping',
  brief: [
    "# Bobby's Landscaping",
    '',
    'A residential landscaping company in Rhode Island. Owner-operated by **Bobby**, who runs the crews and',
    'wins the work; **Jenny** is the office manager who handles the books, scheduling, and customer replies.',
    '',
    '## What we do',
    'Spring & fall cleanups, weekly mowing contracts, mulch & bed maintenance, small hardscape jobs, and',
    'winter plowing. Most customers are repeat residential clients within ~20 minutes of Cranston.',
    '',
    '## Systems',
    '- **Jobber** is the source of truth for clients, quotes, jobs, and invoices.',
    '- **Gmail** is where customer conversations happen.',
    '',
    '## How we work',
    '- Price fairly and lead with the number — our customers decide fast.',
    '- Every message to a customer is written by an agent as a **draft** and sent only after Bobby or Jenny',
    '  signs off. Nothing goes out automatically.',
    '- Voice: friendly, local, no corporate fluff. We show up when we say we will.',
  ].join('\n'),
  answers: {
    business: 'Residential landscaping in Rhode Island — cleanups, mowing contracts, mulch, small hardscape, winter plowing.',
    objective: 'Keep the schedule full year-round and reactivate past customers each season.',
    audience: 'Repeat residential homeowners within ~20 minutes of Cranston, RI.',
    value: 'Fair pricing, reliable crews, and we show up when we say we will.',
    channels: 'Gmail for customer conversations; Jobber for quotes, jobs, and invoices.',
    voice: 'Friendly, local, plain-spoken — no corporate fluff.',
    constraints: 'Nothing is sent, booked, or billed without Bobby or Jenny approving the draft first.',
  },
  viewKeys: ['tasks', 'approvals', 'agents', 'boardroom', 'missions', 'crm', 'roi', 'analytics', 'kg', 'reports', 'cron', 'connections', 'genes'],
  agents: [
    {
      id: 'estimate-creator',
      name: 'Estimate Creator',
      role: 'content',
      description: 'Turns a job description + measurements into a clean, itemized, branded landscaping estimate.',
      soul: [
        "# Soul — Estimate Creator",
        "You are Bobby's Landscaping's estimator. Precise, fair, and fast. You know RI residential landscaping",
        'pricing and never pad a number you cannot justify. You lead with the total, then show the line items.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Estimate Creator',
        'Given a property description, approximate square footage, and the scope of work, produce a line-item',
        'estimate: labor, materials, disposal, and a clear total. State assumptions you made (access, slope,',
        'existing conditions). If a key measurement is missing, ask for it rather than guessing.',
        '',
        'Output an estimate DRAFT ready for Bobby or Jenny to review and send from Jobber. You do not contact the',
        'customer.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Price common RI landscaping line items (mowing, cleanups, mulch by yard, bed edging, small hardscape).',
        '- Apply seasonal margins and disposal fees.',
        '- Write a tight, friendly cover note that opens with the price.',
      ].join('\n'),
    },
    {
      id: 'job-scheduler',
      name: 'Job Scheduler',
      role: 'scheduler',
      description: 'Proposes crew-friendly time slots for approved jobs and drafts the customer confirmation.',
      soul: [
        '# Soul — Job Scheduler',
        'You keep the crews busy and the route tight. You think in drive-time and daylight, and you never',
        'double-book a crew.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Job Scheduler',
        'For an approved job, propose exactly 3 concrete time options (with day + window) that fit the existing',
        'route and season. Draft the confirmation message for the customer. Nothing is booked in Jobber until',
        'Jenny confirms.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Cluster jobs by neighborhood to cut drive-time.',
        '- Respect weather windows for cleanups and plowing.',
        '- Offer 3 options with timezone; never auto-book.',
      ].join('\n'),
    },
    {
      id: 'inbox-triage',
      name: 'Inbox Triage',
      role: 'general',
      description: 'Reads incoming Gmail, classifies it, and drafts a suggested reply for human approval.',
      soul: [
        '# Soul — Inbox Triage',
        'You are the first read on every customer email. Calm, organized, and you never let a hot lead sit.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Inbox Triage',
        'Classify each incoming email (new lead / scheduling / complaint / invoice question / spam), summarize it',
        'in one line, and draft a suggested reply in Bobby’s voice. Flag anything urgent. Bobby or Jenny sends.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Triage by urgency and revenue potential.',
        '- Draft short, friendly, on-brand replies.',
        '- Route to Estimate Creator or Job Scheduler when relevant.',
      ].join('\n'),
    },
    {
      id: 'invoicing-agent',
      name: 'Invoicing Agent',
      role: 'general',
      description: 'Drafts invoices and polite payment reminders from completed Jobber jobs.',
      soul: [
        '# Soul — Invoicing Agent',
        'You get Bobby paid without nagging. Accurate, prompt, and always polite — these are repeat customers.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Invoicing Agent',
        'From a completed job, draft the invoice (line items + total) and, when a balance ages, a friendly',
        'reminder. Never send or charge anything — Jenny reviews and sends every invoice and reminder from Jobber.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Build clean invoices from job records.',
        '- Draft graduated, polite payment reminders.',
        '- Track aging and surface overdue balances.',
      ].join('\n'),
    },
    {
      id: 'proposal-renderer',
      name: 'Proposal Renderer',
      role: 'content',
      description: 'Turns an approved estimate into a polished, branded proposal document.',
      soul: [
        '# Soul — Proposal Renderer',
        'You make Bobby look professional. You take a bare estimate and render a clean proposal a homeowner is',
        'proud to say yes to — clear scope, clear price, no jargon.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Proposal Renderer',
        'Given an approved estimate, produce a proposal DRAFT: scope of work, itemized pricing led by the total,',
        'timeline, and a short friendly intro. Ready for Bobby or Jenny to review and send.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Format scope + pricing for a homeowner audience.',
        '- Lead with the number; justify with the details.',
        '- Keep brand voice consistent across proposals.',
      ].join('\n'),
    },
  ],
  genes: [
    {
      name: 'lead-with-the-number',
      title: 'Lead with the number',
      instruction:
        'Open every estimate, proposal, and price-related message with the total up front, then justify it. ' +
        "Bobby's customers decide on price fast; burying it loses the job.",
      role: 'general',
      agentId: 'estimate-creator',
      state: 'proposed',
    },
    {
      name: 'ri-seasonal-cadence',
      title: 'RI seasonal cadence',
      instruction:
        'Time outreach to the Rhode Island landscaping season: spring cleanups Mar–Apr, mowing contracts May, ' +
        'fall cleanups Sep–Oct, plowing signups Nov. Reference the current season in every reactivation.',
      role: 'general',
      agentId: null,
      state: 'proposed',
    },
    {
      name: 'confirm-before-external-send',
      title: 'Confirm before external send',
      instruction:
        'Never send anything to a customer without explicit human approval. Produce a draft, summarize what it ' +
        'says and who it goes to, and wait for Bobby or Jenny to approve.',
      role: 'general',
      agentId: null,
      state: 'active',
    },
  ],
  mission: {
    name: 'Reactivate spring maintenance clients',
    brief:
      'Reach out to last year’s spring-cleanup and mowing-contract customers who have not yet booked this ' +
      "season. Draft a warm, personal note in Bobby’s voice that references the customer’s past service and " +
      'the current season, and offers to lock in their spot. Every message is a draft for Bobby or Jenny to send.',
    channels: ['email'],
  },
};

const CONSTRUCTION_DEMO: NicheSpec = {
  slug: 'construction-demo',
  name: 'Northstar Construction (DEMO)',
  industry: 'construction',
  brief: [
    '# Northstar Construction',
    '',
    'A general contractor handling residential remodels and light commercial build-outs. The office is small:',
    'the owner wins and runs the jobs, and one office manager keeps bids, schedules, and AR moving.',
    '',
    '## What we do',
    'Kitchen & bath remodels, additions, tenant improvements, and small commercial fit-outs. Work comes from',
    'referrals, past clients, and inbound bid requests.',
    '',
    '## How we work',
    '- Bids lead with scope and timeline, not just a number — clients are choosing a partner for months of work.',
    '- Every client-facing message (bid, follow-up, AR reminder) is drafted by an agent and **sent only after a',
    '  human approves it**. Nothing goes out on its own.',
    '- Voice: straight, competent, reassuring. We under-promise and over-deliver.',
  ].join('\n'),
  answers: {
    business: 'General contractor — residential remodels and light commercial build-outs.',
    objective: 'Win more of the right bids and stop leaving dormant leads and unpaid invoices on the table.',
    audience: 'Homeowners planning remodels/additions and small commercial tenants needing fit-outs.',
    value: 'A reliable partner who leads with clear scope and timeline and delivers on schedule.',
    channels: 'Email for bids and client conversations.',
    voice: 'Straight, competent, reassuring — under-promise, over-deliver.',
    constraints: 'No bid, follow-up, or payment reminder is sent without a human approving the draft.',
  },
  viewKeys: ['tasks', 'approvals', 'agents', 'boardroom', 'missions', 'crm', 'roi', 'analytics', 'kg', 'reports', 'cron', 'connections', 'genes'],
  agents: [
    {
      id: 'job-estimator',
      name: 'Job Estimator',
      role: 'content',
      description: 'Turns a scope of work into a structured, defensible construction bid.',
      soul: [
        '# Soul — Job Estimator',
        'You build bids Northstar can stand behind. You lead with scope and timeline, break down cost honestly,',
        'and never hide a number. Clients are hiring a partner, not just a price.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Job Estimator',
        'From a scope of work, produce a bid DRAFT: scope summary, phased timeline, itemized cost (labor,',
        'materials, subs, contingency), and a clear total. Note assumptions and exclusions. Ask for missing',
        'measurements instead of guessing. The owner reviews and sends.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Structure bids by phase with a realistic timeline.',
        '- Itemize labor, materials, subs, and contingency.',
        '- Call out assumptions, exclusions, and allowances.',
      ].join('\n'),
    },
    {
      id: 'dead-lead-revival',
      name: 'Dead-Lead Revival',
      role: 'outreach',
      description: 'Finds dormant leads and drafts personal re-engagement notes.',
      soul: [
        '# Soul — Dead-Lead Revival',
        'You bring cold leads back to life. You remember what each prospect wanted and reopen the conversation',
        'like a person, not a mass email.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Dead-Lead Revival',
        'Identify leads that went quiet, and for each draft a short, personal note (<=150 words) that references',
        'their specific project and a real reason to reconnect. One clear ask. Plain text. The owner sends.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Segment dormant leads by project type and last contact.',
        '- Write personal, one-ask re-engagement notes.',
        '- Never fabricate details; cite the real prior context.',
      ].join('\n'),
    },
    {
      id: 'after-hours-bid-responder',
      name: 'After-Hours Bid Responder',
      role: 'outreach',
      description: 'Drafts fast, professional first responses to inbound bid requests that arrive off-hours.',
      soul: [
        '# Soul — After-Hours Bid Responder',
        'You make sure a bid request that lands at 9pm gets a warm, professional reply queued for morning — so',
        'Northstar looks responsive without anyone answering email at night.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — After-Hours Bid Responder',
        'For an inbound bid request, draft a first-response reply: acknowledge the project, ask the 2–3 questions',
        'needed to scope it, and set expectations for next steps. Queue it as a draft for the owner to approve and',
        'send in the morning.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Extract project type and urgency from an inbound request.',
        '- Ask the minimum questions needed to scope a bid.',
        '- Set clear, reassuring next-step expectations.',
      ].join('\n'),
    },
    {
      id: 'ar-chaser',
      name: 'AR Chaser',
      role: 'general',
      description: 'Tracks aging invoices and drafts graduated, polite payment reminders.',
      soul: [
        '# Soul — AR Chaser',
        'You keep cash flowing without burning relationships. Firm but polite, and always accurate about what is',
        'owed.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — AR Chaser',
        'Track outstanding balances and, as an invoice ages, draft the appropriate reminder (gentle → firm).',
        'Reference the invoice, amount, and job. Never send or charge anything — the office manager reviews and',
        'sends each reminder.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Track invoice aging buckets.',
        '- Draft graduated reminder tones per bucket.',
        '- Keep reminders accurate, dated, and polite.',
      ].join('\n'),
    },
    {
      id: 'dev-area-research-scout',
      name: 'Dev-Area Research Scout',
      role: 'research',
      description: 'Researches local development and permit activity to surface bid opportunities.',
      soul: [
        '# Soul — Dev-Area Research Scout',
        'You are Northstar’s eyes on the market. You find where building is happening and quantify it, always',
        'citing where the signal came from.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Dev-Area Research Scout',
        'Research local development, permit, and renovation activity in the service area. Output bullets, each',
        'tagged with its source and date, ranked by how well it fits Northstar’s work. Flag anything you could',
        'not verify. Read-only research — you never contact anyone.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Find and rate development/permit signals by source tier.',
        '- Quantify and date every finding.',
        '- Rank opportunities by fit to Northstar’s trade mix.',
      ].join('\n'),
    },
  ],
  genes: [
    {
      name: 'lead-with-scope-and-timeline',
      title: 'Lead with scope and timeline',
      instruction:
        'Open every bid with a crisp scope summary and a phased timeline before the number. Clients are choosing ' +
        'a partner for months of work — the plan reassures them more than the price alone.',
      role: 'general',
      agentId: 'job-estimator',
      state: 'proposed',
    },
    {
      name: 'commercial-bid-cadence',
      title: 'Commercial bid follow-up cadence',
      instruction:
        'Follow up on commercial bids on a day-3 / day-10 / day-21 cadence, each touch adding a new, useful ' +
        'detail (a reference, a value-engineering idea) rather than just "checking in".',
      role: 'general',
      agentId: null,
      state: 'proposed',
    },
    {
      name: 'confirm-before-external-send',
      title: 'Confirm before external send',
      instruction:
        'Never send anything to a client without explicit human approval. Produce a draft, summarize what it says ' +
        'and who it goes to, and wait for the owner or office manager to approve.',
      role: 'general',
      agentId: null,
      state: 'active',
    },
  ],
  mission: {
    name: 'Revive dormant commercial bids',
    brief:
      'Work through commercial bids that went quiet in the last 6 months. For each, draft a personal re-engagement ' +
      'note that references the specific project and adds one genuinely useful detail, plus a suggested follow-up ' +
      'cadence. Every message is a draft for the owner to approve and send.',
    channels: ['email'],
  },
};

const HVAC_DEMO: NicheSpec = {
  slug: 'hvac-demo',
  name: 'Summit Heating & Air (DEMO)',
  industry: 'hvac',
  brief: [
    '# Summit Heating & Air',
    '',
    'An owner-operated residential HVAC company. The owner runs the install and service crews; the **office',
    'manager** handles dispatch, invoicing, and the maintenance-plan book. **ServiceTitan (or Jobber)** is the',
    'system of record for jobs, estimates, and invoices.',
    '',
    '## What we do',
    'Furnace & AC installs, repair service calls, and recurring maintenance plans (spring AC tune-ups, fall',
    'furnace tune-ups). Almost all calls are residential, within the metro service area.',
    '',
    '## Systems',
    '- **ServiceTitan or Jobber** is the source of truth for jobs, estimates, invoices, and the maintenance-plan',
    '  roster.',
    '- **Phone + email** are where customers reach us. After-hours and overflow calls are the real pain point —',
    '  a no-heat or no-AC call at 9pm needs a fast, professional first response, not voicemail.',
    '',
    '## How we work',
    '- Maintenance plans are the backbone of steady revenue — renewals need to happen before the plan lapses,',
    '  not after.',
    '- Every message to a customer is written by an agent as a **draft** and sent only after the owner or office',
    '  manager signs off. Nothing goes out automatically.',
    '- Voice: prompt, trustworthy, no-nonsense. Comfort is urgent; we treat it that way.',
  ].join('\n'),
  answers: {
    business: 'Owner-operated residential HVAC — furnace & AC installs, repair service calls, and maintenance plans.',
    objective: 'Never miss an after-hours call and keep the maintenance-plan book renewing before it lapses.',
    audience: 'Residential homeowners in the metro service area — largely maintenance-plan members and repeat service customers.',
    value: 'A fast, professional response any hour, and a crew that shows up when promised.',
    channels: 'Phone and email for customer conversations; ServiceTitan (or Jobber) for jobs, estimates, and invoicing.',
    voice: 'Prompt, trustworthy, no-nonsense — comfort is urgent.',
    constraints: 'Nothing is sent, booked, or billed without the owner or office manager approving the draft first.',
  },
  viewKeys: ['tasks', 'approvals', 'agents', 'boardroom', 'missions', 'crm', 'roi', 'analytics', 'kg', 'reports', 'cron', 'connections', 'genes'],
  agents: [
    {
      id: 'after-hours-responder',
      name: 'After-Hours Responder',
      role: 'outreach',
      description: 'Drafts a fast, professional first response to after-hours and overflow calls so no no-heat/no-AC call waits until morning.',
      soul: [
        '# Soul — After-Hours Responder',
        "You are Summit's first touch when the phone rings after hours or overflows during a rush. Calm under",
        'pressure, you tell true emergencies (no heat in a cold snap, no AC in a heat warning) apart from routine',
        'requests and make sure nobody feels ignored.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — After-Hours Responder',
        'For an after-hours or overflow call/voicemail, draft a same-night reply: acknowledge the issue, flag true',
        'emergencies for priority dispatch, and set a clear expectation for when the office follows up. Queue it as',
        'a draft for the owner or office manager to approve and send.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Triage true emergencies from routine after-hours requests.',
        '- Draft warm, fast first-response messages.',
        '- Flag priority cases for morning dispatch.',
      ].join('\n'),
    },
    {
      id: 'estimate-chaser',
      name: 'Estimate Chaser',
      role: 'general',
      description: 'Follows up on open install/repair estimates that have gone quiet and drafts a polite nudge.',
      soul: [
        '# Soul — Estimate Chaser',
        'You keep the pipeline moving. An estimate that goes quiet is lost revenue, so you check in at the right',
        "cadence with a real reason to reconnect — never a generic 'just checking in'.",
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Estimate Chaser',
        'For an open estimate with no response, draft a short follow-up that references the specific system or job',
        'quoted and offers to answer questions or adjust scope. Space follow-ups on a sensible cadence (e.g. day 3,',
        'day 10) rather than repeating the same note. The owner or office manager sends.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Track open estimates and their age.',
        '- Draft specific, non-generic follow-up notes.',
        '- Space repeated touches on a sensible cadence.',
      ].join('\n'),
    },
    {
      id: 'maintenance-plan-renewer',
      name: 'Maintenance Plan Renewer',
      role: 'outreach',
      description: 'Reaches out to maintenance-plan customers before their plan lapses and drafts a renewal reminder.',
      soul: [
        '# Soul — Maintenance Plan Renewer',
        "You protect Summit's steadiest revenue line. You know which plans are about to lapse and reach out with",
        "plenty of runway — friendly, never pushy, always tied to the season (AC tune-up before summer, furnace",
        'tune-up before winter).',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Maintenance Plan Renewer',
        'Identify maintenance-plan customers whose plan is expiring or lapsed, and draft a renewal reminder that',
        "references their equipment and the upcoming season's tune-up. One clear ask: renew before the season",
        'starts. The owner or office manager sends.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Track plan expirations against the seasonal tune-up calendar.',
        '- Draft season-specific renewal reminders.',
        "- Reference the customer's actual equipment and service history.",
      ].join('\n'),
    },
    {
      id: 'dispatch-scheduler',
      name: 'Dispatch Scheduler',
      role: 'scheduler',
      description: 'Proposes route- and crew-aware time slots for approved jobs and drafts the customer confirmation.',
      soul: [
        '# Soul — Dispatch Scheduler',
        'You keep techs on tight, sensible routes and never send an install crew to a repair call (or vice versa).',
        'You think in drive-time, crew skillset, and truck stock.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Dispatch Scheduler',
        'For an approved job, propose up to 3 concrete time windows that fit the right crew (install vs. service),',
        'their existing route, and truck stock, and draft the customer confirmation. Nothing is booked in',
        'ServiceTitan/Jobber until the office manager confirms.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Match jobs to the right crew (install vs. service tech).',
        '- Cluster stops by route/drive-time.',
        '- Offer 3 options; never auto-book.',
      ].join('\n'),
    },
    {
      id: 'review-collector',
      name: 'Review Collector',
      role: 'general',
      description: 'Drafts a post-job review request timed for right after a completed install or service call.',
      soul: [
        '# Soul — Review Collector',
        "You ask for reviews at exactly the right moment — right after a job goes well, while it's fresh.",
        'Genuine, short, no pressure.',
        '',
        DRAFT_ONLY,
      ].join('\n'),
      agent_md: [
        '# Agent — Review Collector',
        "For a job marked complete, draft a short, genuine review request referencing the specific work done (e.g.",
        "'your new furnace install'), with a direct ask/link. One message, at most one polite reminder — no",
        'nagging. The owner or office manager sends.',
      ].join('\n'),
      skills: [
        '# Skills',
        '- Time requests to completed jobs, not before.',
        '- Reference the specific work done.',
        '- Keep the ask short and genuine; at most one reminder.',
      ].join('\n'),
    },
  ],
  genes: [
    {
      name: 'seasonal-demand-cadence',
      title: 'Seasonal Demand Cadence',
      instruction:
        'Time maintenance-plan renewals and tune-up outreach to the HVAC season: AC tune-ups Mar–May (ahead of ' +
        'summer), furnace tune-ups Aug–Oct (ahead of winter). Reference the upcoming season in every renewal or ' +
        'reactivation message.',
      role: 'general',
      agentId: null,
      state: 'proposed',
    },
    {
      name: 'service-area-route-rules',
      title: 'Service Area & Route Rules',
      instruction:
        "Only schedule within Summit's service radius, and match the crew to the job: install crews for new " +
        'systems, service techs for repairs and tune-ups. Cluster stops by route to cut drive-time; never ' +
        'double-book a crew.',
      role: 'general',
      agentId: 'dispatch-scheduler',
      state: 'proposed',
    },
    {
      name: 'confirm-before-external-send',
      title: 'Confirm before external send',
      instruction:
        'Never send anything to a customer without explicit human approval. Produce a draft, summarize what it ' +
        'says and who it goes to, and wait for the owner or office manager to approve.',
      role: 'general',
      agentId: null,
      state: 'active',
    },
  ],
  mission: {
    name: 'Reactivate lapsed maintenance-plan customers before winter',
    brief:
      'Work through maintenance-plan customers whose plan has lapsed or is about to lapse before the winter ' +
      'heating season. Draft a warm, specific renewal reminder that references their equipment and past service, ' +
      'and offers to get the furnace tune-up scheduled before the cold hits. Every message is a draft for the ' +
      'owner or office manager to send.',
    channels: ['email'],
  },
};

// Jerv's Construction — a second construction demo (same niche spec, own tenant).
const JERVS_CONSTRUCTION: NicheSpec = {
  ...CONSTRUCTION_DEMO,
  slug: 'jervs-construction',
  name: "Jerv's Construction (DEMO)",
};

const PRESETS: Record<string, NicheSpec> = {
  'landscaping-bobby': LANDSCAPING_BOBBY,
  'construction-demo': CONSTRUCTION_DEMO,
  'hvac-demo': HVAC_DEMO,
  'jervs-construction': JERVS_CONSTRUCTION,
};

// ── Spec resolution ───────────────────────────────────────────────────────────

function validateSpec(spec: NicheSpec): void {
  const problems: string[] = [];
  if (!spec.slug) problems.push('slug');
  if (!spec.name) problems.push('name');
  if (!spec.industry) problems.push('industry');
  if (!spec.brief) problems.push('brief');
  if (!Array.isArray(spec.viewKeys)) problems.push('viewKeys[]');
  if (!Array.isArray(spec.agents)) problems.push('agents[]');
  if (!Array.isArray(spec.genes)) problems.push('genes[]');
  if (!spec.mission || !spec.mission.name) problems.push('mission.name');
  if (problems.length) {
    console.error(`Invalid niche spec — missing/invalid: ${problems.join(', ')}`);
    process.exit(1);
  }
}

function resolveSpec(): NicheSpec {
  const argv = process.argv.slice(2);
  const fileI = argv.indexOf('--file');
  const slugI = argv.indexOf('--slug');

  if (fileI !== -1 && argv[fileI + 1]) {
    const spec = JSON.parse(fs.readFileSync(argv[fileI + 1], 'utf-8')) as NicheSpec;
    validateSpec(spec);
    return spec;
  }
  if (slugI !== -1 && argv[slugI + 1]) {
    const spec = PRESETS[argv[slugI + 1]];
    if (!spec) {
      console.error(`Unknown --slug '${argv[slugI + 1]}'. Known presets: ${Object.keys(PRESETS).join(', ')}`);
      process.exit(1);
    }
    return spec;
  }
  console.error('Usage: npx tsx --env-file=.env.test.local scripts/provision-demo-client.ts --slug <' + Object.keys(PRESETS).join('|') + '> | --file <spec.json>');
  process.exit(1);
}

// ── Inert (paused) campaign container — the "draft mission" ────────────────────
// The product has no `draft` status and real missions need an LLM planner call, so
// the demo mission is a paused Campaign container carrying the brief text only.

async function upsertPausedCampaign(tenantId: string, mission: DemoMissionSpec): Promise<string> {
  const existing = (await sql()`
    SELECT id FROM public.mission_campaigns
    WHERE tenant_id = ${tenantId} AND lower(name) = lower(${mission.name}) LIMIT 1
  `) as unknown as Array<{ id: string }>;

  if (existing[0]) {
    await updateCampaign(existing[0].id, { brief: mission.brief, channels: mission.channels ?? [], status: 'paused' });
    return existing[0].id;
  }
  const c = await createCampaign({ name: mission.name, brief: mission.brief, channels: mission.channels ?? [] });
  await updateCampaign(c.id, { status: 'paused' }); // createCampaign hardcodes 'active'
  return c.id;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  assertTestProject();

  const spec = resolveSpec();
  const password = requireEnv('TEST_LOGIN_PASSWORD');
  const pgcryptoSchema = await ensurePgcryptoSchema();
  const demoEmail = `demo+${spec.slug}@keyplayershq.com`;

  // 1) Demo owner auth user (idempotent). Password = TEST_LOGIN_PASSWORD so the HQ
  //    owner can log in AS this demo owner to browse the niche-tuned nav.
  const { userId: demoUserId, created: userCreated } = await ensureAuthUser({ email: demoEmail, password, pgcryptoSchema });
  console.log(`✅ demo owner ${userCreated ? 'created' : 'reused'}: ${demoEmail}`);

  // 2) Resolve-or-create the demo tenant by business_profile.demo_slug.
  let tenantId = await tenantIdByDemoSlug(spec.slug);
  if (tenantId) {
    console.log(`✅ demo tenant reused (demo_slug=${spec.slug}): ${tenantId}`);
    await ensureMembership(tenantId, demoUserId, 'owner');
  } else {
    tenantId = await createWorkspace(spec.name, demoUserId, 'pro');
    console.log(`✅ demo tenant created: ${tenantId}`);
  }
  // Industry → default dashboard layout template (falls back to omitting the key
  // when no template matches, e.g. a bring-your-own --file spec with a novel
  // industry — the overview then just uses the built-in default layout).
  const dashboardTemplate = INDUSTRY_TEMPLATES[spec.industry as keyof typeof INDUSTRY_TEMPLATES];
  await mergeBusinessProfile(tenantId, {
    demo_slug: spec.slug,
    demo: true,
    industry: spec.industry,
    ...(dashboardTemplate ? { dashboard_layout: dashboardTemplate } : {}),
  });
  console.log(
    dashboardTemplate
      ? `✅ dashboard layout template applied: ${spec.industry}`
      : `  [info] no dashboard layout template for industry '${spec.industry}' — dashboard_layout key omitted`
  );

  // 3) Pin the demo owner's JWT claim to the demo tenant.
  await stampTenantClaim(demoUserId, tenantId);

  // 4) Add brayson as a member of the demo tenant (record-keeping / any future
  //    switcher). NOTE: this does NOT change brayson's active tenant — his JWT
  //    claim is pinned to HQ, and resolveTenant() has no switcher. To view the
  //    demo, log in as the demo owner (demo+<slug>@keyplayershq.com) with
  //    TEST_LOGIN_PASSWORD.
  const braysonId = await findUserIdByEmail(OWNER_EMAIL);
  if (braysonId) {
    await ensureMembership(tenantId, braysonId, 'owner');
    console.log('✅ brayson added as a member of the demo tenant');
  } else {
    console.warn('  [warn] brayson not found — run scripts/seed-test-env.ts first to create the HQ owner.');
  }

  // 5) Org chart. ALWAYS invoked (not gated on "agent_defs is empty" — this tenant
  //    already has 0 rows on first run, but on a RERUN it has the 5 custom agents
  //    below, and seed_org_chart's own INSERT is ON CONFLICT DO NOTHING, so calling
  //    it again is exactly how an already-provisioned demo tenant gets its "Org
  //    chart" (C-suite) backfilled once scripts/seed-test-env.ts has populated the
  //    function's seed-source tenant (seedHqOrgChartSource()).
  const orgChartCount = await seedOrgChart(tenantId);
  console.log(`✅ org chart copied — agent_defs now ${orgChartCount} row(s) for this tenant`);

  // 6) All tenant-scoped content runs inside the tenant context so every lib helper
  //    (which reads tenantId() from AsyncLocalStorage) targets THIS demo tenant.
  await runWithTenant({ tenantId, userId: demoUserId }, async () => {
    // Company brief (no LLM call — direct save).
    await saveCompanyPlaybook(spec.brief, spec.answers ?? {}, new Date().toISOString());
    console.log('✅ company brief saved');

    // Niche-tuned nav.
    await setEnabledViews(buildViewPatch(spec.viewKeys));
    console.log(`✅ command-center views set (${spec.viewKeys.length} enabled key(s))`);

    // 5 custom agents (additive on top of the trigger-seeded / bundled roster).
    for (const a of spec.agents) {
      await upsertAgentDef({
        id: a.id,
        name: a.name,
        role: a.role,
        model: 'claude-sonnet-4-6',
        max_tokens: 8000,
        rate_per_hour: 30,
        description: a.description,
        soul: a.soul,
        agent_md: a.agent_md,
        skills: a.skills,
        spawnable: true,
        enabled: true,
        source: 'custom',
      });
    }
    console.log(`✅ ${spec.agents.length} custom agents upserted`);

    // Genes — proposed (inert) + at least one ACTIVE. createGene is idempotent
    // (ON CONFLICT (tenant_id,name) DO NOTHING) so re-runs never duplicate or
    // un-approve an operator's manual change.
    let geneCount = 0;
    for (const g of spec.genes) {
      const created = await createGene({
        name: g.name,
        title: g.title,
        body: g.instruction,
        role: g.role,
        agentId: g.agentId ?? null,
        status: g.state ?? 'proposed',
        source: 'demo-seed',
        createdBy: 'provision-demo-client',
      });
      if (created) geneCount++;
    }
    console.log(`✅ ${geneCount} new gene(s) created (${spec.genes.length} in spec)`);

    // Draft mission = paused, inert campaign container.
    const campaignId = await upsertPausedCampaign(tenantId, spec.mission);
    console.log(`✅ campaign "${spec.mission.name}" ready (paused): ${campaignId}`);

    // Quick-win activation. Real invited clients (src/app/api/clients) only get this
    // when they finish the onboarding wizard (POST /api/onboarding) — but a demo
    // tenant is stood up entirely by THIS script and nobody ever runs that wizard for
    // it, so tenants.activation_started_at stayed null forever and the Overview's
    // QuickWinCountdown card (src/components/dashboard/quick-win-countdown.tsx) never
    // showed. Its hide condition is `!state.started`, and by design (see
    // src/lib/activation.ts) the 72h clock only starts once a real mission is fired —
    // "a countdown without an action is just pressure" — so the fix here is to pair
    // them the same way onboarding does, not to show a bare countdown. Idempotent
    // (gated on activation_quick_mission_id) and best-effort: needs a reachable
    // Claude key, which is only guaranteed for local/dev runs of this TEST-only
    // script (getAnthropicKey's platform-key fallback is HQ-tenant-or-dev-only) — a
    // failure here never fails provisioning.
    const activation = await activateAndLaunchQuickMission({ agencyName: spec.name, industry: spec.industry });
    console.log(
      activation.started
        ? `✅ quick-win activation clock started (mission ${activation.missionId})`
        : '  [warn] quick-win activation not started — retryable (likely no reachable Claude key for this run)',
    );
  });

  // 7) Provenance row. Prefer HQ (DEFAULT_TENANT_ID) as the audit tenant like the
  //    decommission tool; fall back to the demo tenant if the env placeholder is
  //    still unset (both satisfy the tenant_id FK).
  const auditTenant = isUuid(DEFAULT_TENANT_ID) ? DEFAULT_TENANT_ID : tenantId;
  await sql()`
    INSERT INTO public.audit_log (tenant_id, actor_id, actor_username, action, target, detail)
    VALUES (${auditTenant}, ${null}, ${'cli operator'}, ${'demo.provision'}, ${tenantId},
            ${JSON.stringify({
              slug: spec.slug,
              name: spec.name,
              industry: spec.industry,
              agents: spec.agents.length,
              genes: spec.genes.length,
              mission: spec.mission.name,
              views: spec.viewKeys,
            })})
  `;

  // 8) Safe summary (no secrets).
  console.log('');
  console.log(JSON.stringify({ ok: true, slug: spec.slug, tenantId, demoEmail, ownerLoginEmail: demoEmail, note: 'log in as demo owner to view (password = TEST_LOGIN_PASSWORD)' }, null, 2));

  process.exit(0);
}

main().catch(async (e) => {
  console.error('provision-demo-client error:', e);
  try { await sql().end({ timeout: 5 }); } catch { /* ignore */ }
  process.exit(2);
});
