// The content behind /how-it-works — the guide that teaches a founder and their
// Executive Assistant how KeyCommand actually gets used day to day.
//
// WHY THIS EXISTS: the walkthrough in src/components/walkthrough is SETUP-driven. It
// walks you through connecting a Claude key and setting a goal, then auto-retires once
// those signals flip true. Nothing then teaches operation — so once a workspace is
// configured, everyone is on their own. This is the missing half.
//
// PURE data (no sql, no React) so the page can render it in the client bundle and so the
// copy lives in one reviewable place instead of being buried in JSX.
//
// Two principles run through all of it:
//   1. CHAT FIRST. Most real use is a group chat (iMessage / Telegram) with KeyPlayer,
//      not clicking around in here. Every section therefore says what you'd TEXT, not
//      just where to click — that's the question people actually ask.
//   2. ROLE-AWARE. A founder and an assistant use the same section for different
//      reasons. One line each beats a paragraph that serves neither.

export type Role = 'founder' | 'ea';

export const ROLE_LABEL: Record<Role, string> = {
  founder: 'Founder',
  ea: 'Executive Assistant',
};

export const ROLE_BLURB: Record<Role, string> = {
  founder:
    "You ask for things and decide things. Most of what you do happens in a text message — you shouldn't need to live in here.",
  ea: "You run the day. This is your workspace: it holds everything you need to know about the founder, and the AI team that does the heavy lifting with you.",
};

/** The core loop, in the order it actually happens. Shown as the spine of the page. */
export const FLOW: ReadonlyArray<{
  step: number;
  title: string;
  body: string;
  founder: string;
  ea: string;
}> = [
  {
    step: 1,
    title: 'The system learns how the founder works',
    body: 'Founder Profile and the company playbook are read by every AI agent before it does anything — hours, communication style, what can be approved without asking, what must always escalate.',
    founder: 'Answer the questions once. Everything downstream gets more accurate.',
    ea: "Keep it current. Every time you learn something about how they like things done, put it here — it's the difference between agents that sound like they know them and agents that don't.",
  },
  {
    step: 2,
    title: 'You ask for something',
    body: 'Usually by text — iMessage or Telegram — to KeyPlayer, the orchestrator. You can also use Ask the Team in here. Plain language is fine; you never write a prompt.',
    founder: '"Get me a summary of where we are with the Henderson deal before my 3pm."',
    ea: '"Draft the follow-up to everyone who came to the webinar and show me before it goes."',
  },
  {
    step: 3,
    title: 'KeyPlayer picks the right specialists',
    body: 'It reads the request, chooses which of the AI team to put on it, and gives them the founder context automatically. You do not pick agents by hand.',
    founder: "You don't need to know which agent did what. Ask for the outcome.",
    ea: 'You can see who worked on what in Tasks and Activity Log if something looks off.',
  },
  {
    step: 4,
    title: 'Anything that leaves the building stops for a human',
    body: 'Agents can research, draft, organise and record freely. Anything that sends, publishes or spends waits in Approvals until a person says yes.',
    founder: "Nothing reaches a client or costs money without someone approving it. That's enforced, not a promise.",
    ea: 'Approvals is your queue. Clearing it is a big part of the job.',
  },
  {
    step: 5,
    title: 'The work lands somewhere you can find it',
    body: 'Drafts and documents go to Files, summaries to Briefings, anything worth remembering to the Second Brain, personal commitments to Personal Life.',
    founder: 'Briefings is the one to read. It is the short version.',
    ea: 'Put durable facts in the Second Brain rather than leaving them in a chat thread — that is what survives you being off for a week.',
  },
  {
    step: 6,
    title: 'It keeps running without being asked',
    body: 'Goals set the direction, Schedules run recurring work automatically, and Learning tunes the agents on what actually worked.',
    founder: 'Set the goal. Check the briefing. That is most of your job in here.',
    ea: 'Put anything you do more than twice on a Schedule so it stops needing you.',
  },
];

/** Every section of the Command Centre: what it is, who touches it, and — the bit people
 *  actually ask for — what you'd text to use it without opening the app. */
export interface SectionGuide {
  href: string;
  label: string;
  section: string;
  what: string;
  founder: string;
  ea: string;
  /** A message you could send in the group chat to do this without opening the app. */
  say?: string;
  /** What this feeds, by label — drives the "what connects to what" map. */
  feeds?: string[];
}

export const SECTION_GUIDES: ReadonlyArray<SectionGuide> = [
  {
    href: '/founder', label: 'Founder Profile', section: 'Founder Profile',
    what: 'How this founder works: hours, communication, writing style, what can be approved without asking, what must escalate.',
    founder: 'Fill it in once, add to it when something changes.',
    ea: 'The highest-leverage page in here. Every agent reads it before it does anything.',
    say: '"Add to my profile: never book anything before 9am."',
    feeds: ['Every agent', 'Ask the Team'],
  },
  {
    href: '/tasks', label: 'Tasks', section: 'Daily Operations',
    what: 'Work in flight — what the AI team is doing right now and what it finished.',
    founder: 'Glance here if you want to see progress without asking.',
    ea: 'Your view of what is running. Check it when something feels slow.',
    say: '"What are you working on right now?"',
    feeds: ['Briefings', 'Activity Log'],
  },
  {
    href: '/drafts', label: 'Approvals', section: 'Daily Operations',
    what: 'Everything waiting on a human decision before it can leave the building.',
    founder: 'The only queue you genuinely have to look at. Nothing sends until you or your EA says yes.',
    ea: 'Clear this daily. A full approvals queue is the most common reason work stalls.',
    say: '"What is waiting on me?"',
    feeds: ['Outreach', 'Content'],
  },
  {
    href: '/goals', label: 'Goals', section: 'Daily Operations',
    what: "What you're driving at, with a definition of done. Agents use goals to decide what matters when they have a choice.",
    founder: 'Set two or three. This is how the system knows what to prioritise without being told each time.',
    ea: 'Keep progress notes on them so briefings have something real to report.',
    say: '"Set a goal: 20 booked calls this month, and tell me weekly how we are tracking."',
    feeds: ['Briefings', 'Schedules', 'Every agent'],
  },
  {
    href: '/cron', label: 'Schedules', section: 'Daily Operations',
    what: 'Recurring work that runs on its own — a weekly summary, a daily inbox triage, a monthly report.',
    founder: "You mostly won't touch this. It's why things show up without you asking.",
    ea: 'Anything you do more than twice belongs here.',
    say: '"Every Monday at 8am, send me a summary of last week."',
    feeds: ['Briefings', 'Tasks'],
  },
  {
    href: '/personal', label: 'Personal Life', section: 'Personal Life',
    what: "The founder's personal side — travel, birthdays and gifts, family, health, errands. Separate from company work.",
    founder: 'Mention it once and it stops being your problem to remember.',
    ea: "Set a lead time so you're prompted to act in time, not on the day. Recurring dates roll forward on their own.",
    say: '"Olivia\'s birthday is the 12th — sort a gift."',
    feeds: ['Schedules'],
  },
  {
    href: '/kg', label: 'Second Brain', section: 'Company Knowledge',
    what: 'What the business knows — people, clients, decisions, facts worth keeping. It survives anyone leaving.',
    founder: 'You should rarely need to explain the same thing twice.',
    ea: 'Put durable facts here rather than in a chat thread. This is the handover document that writes itself.',
    say: '"Remember that Henderson only wants to be contacted by email."',
    feeds: ['Every agent', 'Briefings'],
  },
  {
    href: '/memory', label: 'Briefings', section: 'Company Knowledge',
    what: 'The short version — summaries and reports produced for you rather than by you.',
    founder: 'If you read one thing in here, read this.',
    ea: 'Generate one before a meeting so the founder walks in prepared.',
    say: '"Brief me before my 3pm with Henderson."',
  },
  {
    href: '/agents/workspace', label: 'Files', section: 'Company Knowledge',
    what: 'Working documents the agents produce and you edit — proposals, SOPs, reports.',
    founder: 'Where the actual deliverable ends up.',
    ea: 'Promote a good document to standing knowledge so agents follow it from then on.',
  },
  {
    href: '/learning', label: 'Learning', section: 'Company Knowledge',
    what: 'How the AI team is improving — what worked, what got rejected, what changed as a result.',
    founder: 'Evidence it is getting better rather than just busier.',
    ea: 'Worth a look monthly. Rejections here tell you what to fix in the Founder Profile.',
  },
  {
    href: '/crm', label: 'Contacts', section: 'Relationships',
    what: 'The people around the business and where each relationship stands.',
    founder: 'Ask who you owe a reply to.',
    ea: 'Keep last-contact notes current so follow-ups are informed rather than generic.',
    say: '"Who have I not followed up with in three weeks?"',
  },
  {
    href: '/boardroom', label: 'Ask the Team', section: 'Your AI Team',
    what: 'Talk to the AI executives directly, in here, when you want a conversation rather than a task.',
    founder: 'Use it like a strategy session. It knows your business and your profile.',
    ea: 'Good for thinking something through before turning it into work.',
    say: 'Anything you would ask a smart colleague.',
    feeds: ['Tasks', 'Approvals'],
  },
  {
    href: '/agents/squads', label: 'Agents', section: 'Your AI Team',
    what: 'The full roster of specialists available to the business.',
    founder: "Worth a look once so you know what's possible. You never have to pick one.",
    ea: 'You do not assign agents by hand — KeyPlayer does. This is a reference.',
  },
  {
    href: '/agents/comms', label: 'Messages', section: 'Your AI Team',
    what: 'The chat channels — iMessage, Telegram — that connect the group chat to everything here.',
    founder: 'This is the one to set up. It is how you will actually use KeyCommand.',
    ea: 'Make sure the founder is connected here before anything else.',
    feeds: ['Every agent'],
  },
];

/** Role-specific "start here" recipes — the three things each role should be able to do
 *  on day one, phrased as actions rather than features. */
export const RECIPES: Record<Role, ReadonlyArray<{ title: string; steps: string[] }>> = {
  founder: [
    {
      title: 'Ask for something without opening the app',
      steps: [
        'Text KeyPlayer in your group chat the way you would text an assistant.',
        'It picks the right specialists and gets to work — you do not name agents.',
        'Anything that sends or spends comes back to you to approve first.',
      ],
    },
    {
      title: 'Stay across the business in two minutes',
      steps: [
        'Open Briefings for the short version of what happened.',
        'Check Approvals for anything waiting on your decision.',
        'That is the whole daily loop.',
      ],
    },
    {
      title: 'Make it work more like you',
      steps: [
        'Open Founder Profile and fill in the Boundaries section.',
        'Say what your assistant can approve alone, and what must always reach you.',
        'Every agent follows it from the next run onwards.',
      ],
    },
  ],
  ea: [
    {
      title: 'Get something produced',
      steps: [
        'Ask in the group chat or in Ask the Team, in plain language.',
        'Watch it in Tasks while it runs.',
        'Review the result in Files, then send it from Approvals.',
      ],
    },
    {
      title: 'Make sure nothing gets forgotten',
      steps: [
        'Anything personal the founder mentions — a trip, a birthday, an appointment — goes in Personal Life.',
        'Set a lead time so you are prompted while there is still time to act.',
        'Anything the business should remember goes in the Second Brain.',
      ],
    },
    {
      title: 'Stop doing the same thing twice',
      steps: [
        'If you have done it twice, put it on a Schedule.',
        'Tell KeyPlayer when it should run and what it should produce.',
        'Check the output in Briefings for the first week, then leave it alone.',
      ],
    },
  ],
};
