import type Database from 'better-sqlite3';

/**
 * Seed demo agent-to-agent conversations for the chat panel.
 * Called from db.ts after migration — safe to re-run (checks for existing messages).
 */
export function seedChatMessages(db: Database.Database) {
  // Disabled — legacy demo seeds (Hermes/Apollo/Maya) belonged to the old OpenClaw branding.
  // KeyPlayer/sub-agent chats are now generated from real activity and don't need fixtures.
  // Set KEYPLAYERS_SEED_DEMO_CHATS=true if you ever want the old fixtures back.
  if (process.env.KEYPLAYERS_SEED_DEMO_CHATS !== 'true') return;

  const count = (db.prepare('SELECT COUNT(*) as c FROM messages').get() as { c: number })?.c ?? 0;
  if (count > 0) return; // Already seeded

  const now = Math.floor(Date.now() / 1000);
  const hour = 3600;

  const messages = [
    // Hermes → Apollo: Lead signal handoff
    {
      conversation_id: 'hermes_apollo',
      from_agent: 'hermes',
      to_agent: 'apollo',
      content: 'Found high-intent signal on X: @sarahdev is frustrated with manual outbound — "spending 4h/day on cold emails with 2% reply rate." Company is 50-200 employees, B2B SaaS. Matches our ICP perfectly.',
      message_type: 'text',
      created_at: now - 8 * hour,
    },
    {
      conversation_id: 'hermes_apollo',
      from_agent: 'apollo',
      to_agent: 'hermes',
      content: 'Received. Scored as **Tier A** lead (ICP match: 92%). Starting 3-touch personalized sequence. First email focuses on the "4h/day manual outbound" pain point with our automation angle.',
      message_type: 'text',
      created_at: now - 7 * hour - 45 * 60,
    },
    {
      conversation_id: 'hermes_apollo',
      from_agent: 'hermes',
      to_agent: 'apollo',
      content: 'Good. I\'ll engage with her X thread first — drop a value-add reply about outbound automation benchmarks. That way when your email lands, she\'ll recognize the Hermes name.',
      message_type: 'text',
      created_at: now - 7 * hour - 30 * 60,
    },
    {
      conversation_id: 'hermes_apollo',
      from_agent: 'apollo',
      to_agent: 'hermes',
      content: 'Smart coordination. Sequence scheduled: Email 1 tomorrow 9 AM, follow-up in 3 days. Subject: "Re: outbound automation." Let me know if she responds to your X reply — I\'ll adjust tone accordingly.',
      message_type: 'text',
      created_at: now - 7 * hour - 15 * 60,
    },

    // Apollo daily triage report
    {
      conversation_id: 'hermes_apollo',
      from_agent: 'apollo',
      to_agent: 'hermes',
      content: 'Evening triage complete. 3 new replies:\n- Marcus Rivera @ TechScale: **Interested** — asking for demo. Moving to Stage 3.\n- Priya Sharma @ DataFlow: Objection (budget). Sending case study.\n- 1 bounce from old domain. Added to suppression.',
      message_type: 'text',
      created_at: now - 3 * hour,
    },
    {
      conversation_id: 'hermes_apollo',
      from_agent: 'hermes',
      to_agent: 'apollo',
      content: 'Marcus Rivera demo request is great — he was engaging with our LinkedIn content last week. I\'ll draft a LinkedIn post tagging DevTools community tonight, might create social proof before his demo.',
      message_type: 'text',
      created_at: now - 2 * hour - 50 * 60,
    },

    // Direct conversation with Hermes
    {
      conversation_id: 'agent_hermes',
      from_agent: 'nyk',
      to_agent: 'hermes',
      content: 'How is the content calendar looking for this week?',
      message_type: 'text',
      created_at: now - 6 * hour,
    },
    {
      conversation_id: 'agent_hermes',
      from_agent: 'hermes',
      to_agent: 'nyk',
      content: 'Calendar is loaded for the week:\n\n**Monday**: LinkedIn carousel — "5 Experiments Every DevTool Founder Should Run"\n**Tuesday**: X thread on outbound automation benchmarks\n**Wednesday**: LinkedIn post — Hermes case study teaser\n**Thursday**: X engagement day (replies + QTs to ICP conversations)\n**Friday**: Weekly metrics thread + experiment results\n\n3 posts are drafted and pending your approval in the content queue.',
      message_type: 'text',
      created_at: now - 5 * hour - 45 * 60,
    },

    // Direct conversation with Apollo
    {
      conversation_id: 'agent_apollo',
      from_agent: 'nyk',
      to_agent: 'apollo',
      content: 'What\'s the pipeline status? How many active sequences?',
      message_type: 'text',
      created_at: now - 4 * hour,
    },
    {
      conversation_id: 'agent_apollo',
      from_agent: 'apollo',
      to_agent: 'nyk',
      content: 'Pipeline summary:\n\n- **12 active leads** across 3 tiers (4 Tier A, 5 Tier B, 3 Tier C)\n- **8 active sequences** running\n- **3 pending approval** (Tier B leads — need your sign-off)\n- Reply rate this week: **12%** (above 8% target)\n- 2 leads moved to Stage 3 (demo/call requested)\n\nThe 3 pending sequences are in the CRM approval queue.',
      message_type: 'text',
      created_at: now - 3 * hour - 50 * 60,
    },
  ];

  const stmt = db.prepare(`
    INSERT INTO messages (conversation_id, from_agent, to_agent, content, message_type, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  const insertAll = db.transaction(() => {
    for (const msg of messages) {
      stmt.run(msg.conversation_id, msg.from_agent, msg.to_agent, msg.content, msg.message_type, msg.created_at);
    }
  });

  insertAll();

  // Register as seed data
  const seedStmt = db.prepare('INSERT OR IGNORE INTO seed_registry (table_name, record_id) VALUES (?, ?)');
  const rows = db.prepare('SELECT id FROM messages').all() as { id: number }[];
  for (const row of rows) {
    seedStmt.run('messages', String(row.id));
  }
}
