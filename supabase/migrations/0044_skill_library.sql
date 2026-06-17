-- Skill Library — a global, curated catalog of reusable agent skills that users
-- can install into any of their agents (appends to agent_defs.skills). Synced from
-- a GitHub repo (manifest.json) and seeded with a starter set. Global (no tenant):
-- read by everyone, written only by the HQ sync (service role).
create table if not exists public.skill_library (
  id          bigint generated always as identity primary key,
  slug        text not null unique,
  name        text not null,
  category    text not null default 'general',
  description text not null default '',
  body        text not null default '',
  source_url  text,
  updated_at  timestamptz not null default now()
);

alter table public.skill_library enable row level security;
-- Public read for any authenticated user; writes go through the service role.
drop policy if exists skill_library_read on public.skill_library;
create policy skill_library_read on public.skill_library for select using (true);

insert into public.skill_library (slug, name, category, description, body) values
 ('cold-email-opener', 'Cold Email Opener', 'outreach',
  'Write pattern-interrupt first lines for cold outreach that earn the next sentence.',
  'When writing a cold email, open with a specific, earned observation about THEM — a recent launch, hire, post, or number — never "I hope this finds you well." One sentence, no flattery, no "I''m reaching out because." The opener must prove you did 30 seconds of homework. Then bridge to a single concrete outcome you can create for them.'),
 ('hook-writer', 'Short-form Hook Writer', 'content',
  'Generate scroll-stopping first lines for reels, shorts, and posts.',
  'For any short-form video or post, write the first line as a hard hook in one of these molds: a contrarian claim, a specific number + result, a callout of a painful mistake, or an open loop ("Here''s what nobody tells you about X"). Never start with context or "Hey guys." The hook must make scrolling past feel like missing out.'),
 ('objection-handling', 'Objection Handling', 'sales',
  'Respond to common sales objections without being defensive.',
  'When a prospect raises an objection (price, timing, "need to think about it"), acknowledge it sincerely in one line, reframe it around the cost of inaction, and end with a low-friction next step. Never argue or discount immediately. "Too expensive" → reframe to ROI/payback. "Not now" → tie to a time-sensitive cost. "Send me info" → offer a 10-minute walkthrough instead.'),
 ('competitor-teardown', 'Competitor Teardown Framework', 'research',
  'Reverse-engineer why a competitor''s content or offer is working.',
  'When analyzing a competitor''s reel, post, or offer, extract: (1) the hook and why it stops the scroll, (2) the core promise/transformation, (3) the structure beat-by-beat, (4) the proof they use, (5) the CTA. Then state the single most adaptable lesson for our own content — never copy, always adapt the underlying mechanism.'),
 ('seo-title', 'SEO Title & Thumbnail', 'content',
  'Write titles + thumbnail text optimized for click-through.',
  'For YouTube/blog titles, lead with the outcome or the curiosity gap, keep it under ~60 characters, and front-load the keyword. Pair every title with a 2-4 word thumbnail phrase that does NOT repeat the title — it should add tension or a number. Avoid clickbait you can''t pay off; the content must deliver the promise.')
on conflict (slug) do nothing;
