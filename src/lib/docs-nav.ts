// Public docs navigation — the curated table of contents for the in-app
// knowledge base at /docs. Kept free of any Node/`fs` imports so it can be
// shared by both the server-side content loader (docs-content.ts) AND the
// client sidebar/search components without dragging `node:fs` into the browser
// bundle.
//
// Internal/dev docs (keycommand-v2-plan.md, nango-oauth-setup.md) are
// deliberately NOT listed here — this is what end users see.

export type DocNavItem = { slug: string; title: string; blurb?: string };
export type DocNavGroup = { group: string; items: DocNavItem[] };

export const DOCS_NAV: DocNavGroup[] = [
  {
    group: 'Start here',
    items: [
      { slug: 'getting-started', title: 'Getting Started', blurb: 'Sign in, set up, and what to do first' },
      { slug: 'overview', title: 'Overview & Dashboard', blurb: 'Your home base — agents, goals, and queues' },
      { slug: 'concepts', title: 'Core Concepts', blurb: 'The vocabulary: agents, drafts, tenants, and more' },
    ],
  },
  {
    group: 'Features',
    items: [
      { slug: 'competitors', title: 'Competitor Reel Intel', blurb: 'Watch competitor reels and tear down why they won' },
      { slug: 'content-lab', title: 'Content Lab', blurb: 'Trend Radar, Trial Reel Generator, and reel scans' },
      { slug: 'script-studio', title: 'Script Studio', blurb: 'Edit reel scripts and read them off a teleprompter' },
      { slug: 'hyperframes', title: 'Hyperframes', blurb: 'Turn a brief into a short-form script + storyboard, then hand it to HeyGen' },
      { slug: 'media', title: 'Media Library', blurb: 'Drop your own a-roll, b-roll, and images for agents and reels to use' },
      { slug: 'engagement', title: 'Engagement', blurb: 'Triage YouTube/Instagram comments and inbound email, with one-click AI replies' },
      { slug: 'agents', title: 'Agents & Agent Studio', blurb: 'View, edit, and create your AI specialists' },
      { slug: 'boardroom', title: 'Boardroom', blurb: 'Chat with your lead agent and watch agents collaborate' },
      { slug: 'tasks', title: 'Tasks Board', blurb: 'Watch every agent run live and steer the work' },
      { slug: 'goals-and-missions', title: 'Goals, Campaigns & Missions', blurb: 'Set outcomes, group work into campaigns, and launch missions' },
      { slug: 'analytics', title: 'Analytics', blurb: 'Web + social performance — YouTube, Instagram, Facebook Ads, and TikTok' },
    ],
  },
  {
    group: 'Setup & control',
    items: [
      { slug: 'connections', title: 'Connections', blurb: 'Connect your social accounts and API keys' },
      { slug: 'invite-emails', title: 'Invite Emails', blurb: 'How invites reach clients and teammates, and how to enable sending' },
      { slug: 'drafts', title: 'Drafts & Approvals', blurb: 'The approval queue — nothing ships without you' },
      { slug: 'cron', title: 'Scheduled Jobs', blurb: 'Run agents on a recurring schedule' },
      { slug: 'usage', title: 'Usage & Spend', blurb: 'Track what your agents cost' },
    ],
  },
];

export const DOC_TITLES: Record<string, string> = Object.fromEntries(
  DOCS_NAV.flatMap((g) => g.items.map((i) => [i.slug, i.title])),
);

export function allDocSlugs(): string[] {
  return DOCS_NAV.flatMap((g) => g.items.map((i) => i.slug));
}

export function groupOf(slug: string): string | null {
  for (const g of DOCS_NAV) if (g.items.some((i) => i.slug === slug)) return g.group;
  return null;
}
