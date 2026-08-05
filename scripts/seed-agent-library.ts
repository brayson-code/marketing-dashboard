// seed-agent-library.ts — POPULATE the GLOBAL public.agent_library catalog
// (migration 0058) from every authored agent source the two scouts found:
//
//   1. bundled agents/keyplayer/**            → 1 rich orchestrator
//   2. bundled agents/sub-agents/**           → 21 rich specialists
//   3. EXEC_SPECS (test-seed-common.ts)       → 5 rich C-suite executives
//   4. keycommand-provisioning default-agents → 5 universal defaults (rich when a
//                                               bundled cousin exists, else thin)
//   5. keycommand-provisioning niche-config   → 15 RICH archetype rows (was 110
//                                               near-duplicate niche rows). The
//                                               110 niche custom agents collapse
//                                               into 15 authored archetypes; we
//                                               now seed ONE row per archetype
//                                               carrying default_niches = the
//                                               UNION of every industry that uses
//                                               it and alias:<name> tags for every
//                                               niche display name it answers to.
//                                               (See DEDUPE note below.)
//
// ── DEDUPE (2026-07) ──────────────────────────────────────────────────────────
// The 110 per-niche rows were 15 authored, niche-agnostic archetype prompt-block
// sets photocopied across 22 industries (with 5 names literally repeated). This
// seed now emits 15 archetype rows instead — a 47-row catalog total, zero
// duplicate prompt bodies. The LIVE CONTRACT the dedupe preserves:
// keycommand-provisioning's resolveNicheSlugsByName() must still map every
// (niche, name) pair inference can emit to a non-null library slug, and
// agentsForNiche(niche) must still surface the row so the picker can pre-select
// it. We keep that intact WITHOUT touching niche-config.json by:
//   • Half A (this file): each archetype row's default_niches = UNION of every
//     industry that used the archetype, and tags carry alias:<name> for every
//     distinct niche display name the archetype answers to.
//   • Half B (sibling repo): resolveNicheSlugsByName() indexes byName from BOTH
//     the row `name` AND its alias:<name> tags, so a chosen niche name still
//     reconciles to its archetype's single slug.
// A cleanup DELETE (idempotent) removes the old source='niche' / id LIKE 'niche-%'
// rows so a rerun leaves exactly the 47-row catalog.
//
// Idempotent: UPSERT on the slug PK, so a rerun refreshes content without
// duplicating. Deterministic slugs (see slugify + nicheSlug) keep reruns stable.
//
// This ONLY writes the global catalog. It does NOT touch any tenant's agent_defs
// and it does NOT run the migration — the coordinator applies 0058 + runs this
// against TEST. Run with:
//   npx tsx --env-file=.env.test.local scripts/seed-agent-library.ts
//
// NOTE: unlike the tenant seeders, this catalog is tenant-agnostic; every write
// targets public.agent_library with no tenant_id.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { sql } from '../src/lib/db/client';
import { SUBAGENT_REGISTRY } from '../src/lib/subagent';
import { EXEC_SPECS } from './lib/exec-specs';
import { ARCHETYPE_SOULS } from './lib/archetype-souls';
import { departmentFor } from '../src/lib/agent-department';

// keycommand-provisioning lives as a sibling repo. Resolve relative to this file
// so the script works regardless of the process cwd.
const KEYCOMMAND_DIR = join(__dirname, '..', '..', 'keycommand-provisioning');
const AGENTS_DIR = join(__dirname, '..', 'agents');

type Richness = 'thin' | 'rich';

interface LibRow {
  id: string;
  name: string;
  category: string;
  role: string;
  department: string | null;
  is_executive: boolean;
  does: string;
  soul: string;
  agent_md: string;
  skills: string;
  default_niches: string[];
  tags: string[];
  richness: Richness;
  source: string;
}

// ── slug helpers ──────────────────────────────────────────────────────────────

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// (The per-niche slug prefix map used by the old 110-row niche seeder was removed
// in the 2026-07 dedupe — archetype rows use deterministic 'archetype-<tag>' ids.)

// ── archetype inference (collapses the 110 niche agents into 15 archetypes) ────
//
// The 110 niche agents collapse into 15 authored archetypes. We infer the
// archetype from the name + `does` so we can (a) fold every niche display name
// into the single archetype row that serves it (via alias:<name> tags) and (b)
// keep the catalog filterable ("show me every Follow-up/Chaser"). Purely a tag —
// it drives which archetype row a niche name lands on, never the prompt bodies
// (those come from ARCHETYPE_SOULS, keyed by the same tag).

interface Archetype { tag: string; category: string; role: string; test: RegExp }

const ARCHETYPES: Archetype[] = [
  { tag: 'speed-to-lead', category: 'outreach', role: 'outreach', test: /instant|first-touch|first-response|speed|in seconds|in minutes|internet-lead|live-lead|intake|responder|quote-speed|rate-inquiry|overflow|after-hours|storm-surge|candidate\/client/i },
  { tag: 'follow-up', category: 'outreach', role: 'outreach', test: /follow-?up|chaser|chase|nudge|nudger|proposal follow|estimate (chaser|follow)|submission|trade-in|pbc|doc collection|sign-up follow|status-request/i },
  { tag: 'reactivation', category: 'outreach', role: 'outreach', test: /reactivat|revival|revive|win-?back|reactivator|dead-?lead|dead-?list|lapsed|unsold|redeploy|dead crm|dormant/i },
  { tag: 'scheduler', category: 'scheduling', role: 'scheduler', test: /schedul|booker|book|appointment|showing|test-drive|site-visit|dispatch|reservation|tour booker|coordinator|interview coordinat|rebook|reschedul/i },
  { tag: 'no-show', category: 'scheduling', role: 'scheduler', test: /no-?show|slot|filler|reducer|refill/i },
  { tag: 'renewal', category: 'outreach', role: 'outreach', test: /renew|renewal|maintenance-plan|refi-window|membership renewal/i },
  { tag: 'collections', category: 'outreach', role: 'outreach', test: /ar chaser|rent ar|collections|unpaid|invoic|dso|cash reconcil/i },
  { tag: 'referral', category: 'outreach', role: 'outreach', test: /referral/i },
  { tag: 'research-scout', category: 'research', role: 'research', test: /scout|research|expansion|dev-area|new-state|location-acquisition|at-risk flagger|refi-window watcher/i },
  { tag: 'upsell', category: 'sales', role: 'general', test: /upsell|cross-sell|package upsell|reorder|depletion|promo coordinat|maintenance-plan renewer/i },
  { tag: 'review', category: 'content', role: 'content', test: /review generator|review responder|review booker|reviews/i },
  { tag: 'estimator', category: 'content', role: 'content', test: /estimator|estimate creator|bid draft|proposal renderer|quote draft/i },
  { tag: 'report-builder', category: 'client', role: 'general', test: /report builder|owner-report|ops watcher|multi-unit|meeting prep|discovery-call prep|deadline tracker|status updater|permit status/i },
  { tag: 'doc-rag', category: 'knowledge', role: 'general', test: /rag|records|case-doc|license-doc|doc organizer|doc collector|onboarding (doc )?collect/i },
  { tag: 'monitor', category: 'general', role: 'general', test: /watcher|monitor|alerter|tracker|downtime|stockout|depletion/i },
];

function inferArchetype(name: string, does: string): Archetype {
  const hay = `${name} ${does}`;
  for (const a of ARCHETYPES) if (a.test.test(hay)) return a;
  return { tag: 'general', category: 'general', role: 'general', test: /.^/ };
}

// ── editorial names for the 15 archetype rows ─────────────────────────────────
//
// Each archetype row gets ONE clean, niche-agnostic display name + one capability
// line (the per-niche variants live on as alias:<name> tags for reconciliation +
// the swap-browser's niche-specific card title). Keys are the 15 ARCHETYPE_SOULS
// tags; every tag must appear here (asserted in archetypeRows()).
const ARCHETYPE_DISPLAY: Record<string, string> = {
  'speed-to-lead':   'Speed-to-Lead Responder',
  'follow-up':       'Follow-up Chaser',
  'reactivation':    'Dead-Lead Reactivator',
  'scheduler':       'Appointment Scheduler',
  'no-show':         'No-Show Filler',
  'renewal':         'Renewal Nurturer',
  'collections':     'Invoice & AR Chaser',
  'referral':        'Referral Nurturer',
  'research-scout':  'Research Scout',
  'upsell':          'Upsell & Reorder Prompter',
  'review':          'Review Generator',
  'estimator':       'Estimate & Proposal Drafter',
  'report-builder':  'Owner-Report Builder',
  'doc-rag':         'Document & Records Organizer',
  'monitor':         'Ops Monitor & Alerter',
};

const ARCHETYPE_DOES: Record<string, string> = {
  'speed-to-lead':   'Catches a brand-new inbound the instant it lands and drafts a fast, human first reply (never auto-sends).',
  'follow-up':       'Chases open estimates, proposals, documents, and quiet leads with polite, well-timed nudges until they move.',
  'reactivation':    'Revives dead, aged, and lapsed leads/clients with a warm win-back sequence the owner approves.',
  'scheduler':       'Books, coordinates, and reschedules appointments, showings, and jobs against the real calendar.',
  'no-show':         'Backfills no-shows and empty slots by pulling from the waitlist so the schedule stays full.',
  'renewal':         'Nurtures renewals, memberships, and maintenance plans toward on-time re-commitment.',
  'collections':     'Chases unpaid invoices, rent, and AR with firm-but-friendly reminders and clean status tracking.',
  'referral':        'Turns happy clients into referrals with well-timed, non-pushy asks and post-close nurture.',
  'research-scout':  'Scouts expansion areas, new markets, and at-risk accounts, then hands the owner a decision-ready brief.',
  'upsell':          'Spots reorder timing and upgrade openings and prompts the right cross-sell at the right moment.',
  'review':          'Generates review requests and drafts on-brand responses to grow reputation.',
  'estimator':       'Drafts estimates, bids, and proposals from the details on hand for the owner to price and approve.',
  'report-builder':  'Assembles owner-ready status reports, meeting prep, and deadline/permit trackers across the business.',
  'doc-rag':         'Collects, organizes, and answers questions over the business’s documents, records, and case files.',
  'monitor':         'Watches for downtime, stockouts, and depletion and alerts the owner before it costs a sale.',
};

// The inference table falls back to a 'general' tag for a name no regex catches
// (today: exactly one — fitness's "Trial Converter", a follow-up by intent). That
// tag has no ARCHETYPE_SOULS block, so we route any such alias onto this authored
// archetype instead of dropping it — otherwise its alias:<name> tag would never be
// seeded and resolveNicheSlugsByName() could not reconcile the name. Any future
// unmatched niche name lands here too (surfaced as a warning in archetypeRows()).
const ARCHETYPE_FALLBACK_TAG = 'follow-up';

// ── bundled file loaders ──────────────────────────────────────────────────────

function readMd(dir: string, file: string): string {
  const p = join(dir, file);
  try { return existsSync(p) ? readFileSync(p, 'utf-8') : ''; } catch { return ''; }
}

// Best-effort category/role for the bundled specialists (mirrors squad.ts META
// roles + agent-defs BUNDLED_ROLE, generalized to the library's categories).
const SPECIALIST_CATEGORY: Record<string, { category: string; role: string; niches: string[] }> = {
  'research-analyst':     { category: 'research',   role: 'research',  niches: [] },
  'lead-research':        { category: 'research',   role: 'research',  niches: [] },
  'reel-analyst':         { category: 'research',   role: 'research',  niches: [] },
  'content-writer':       { category: 'content',    role: 'content',   niches: [] },
  'content-cascade':      { category: 'content',    role: 'content',   niches: [] },
  'carousel-generator':   { category: 'content',    role: 'content',   niches: [] },
  'reel-ideator':         { category: 'content',    role: 'content',   niches: [] },
  'reel-optimizer':       { category: 'content',    role: 'content',   niches: [] },
  'hyperframes-agent':    { category: 'content',    role: 'content',   niches: [] },
  'thumbnail-generator':  { category: 'content',    role: 'creative',  niches: [] },
  'outreach-sender':      { category: 'outreach',   role: 'outreach',  niches: [] },
  'sponsor-pitch':        { category: 'sales',      role: 'outreach',  niches: [] },
  'pipeline-review':      { category: 'sales',      role: 'general',   niches: [] },
  'inbox-triage':         { category: 'comms',      role: 'general',   niches: ['landscaping'] },
  'calendar-scheduler':   { category: 'scheduling', role: 'scheduler', niches: [] },
  'community-pulse':      { category: 'client',     role: 'content',   niches: [] },
  'weekly-client-status': { category: 'client',     role: 'general',   niches: [] },
  'client-onboarding-doc':{ category: 'client',     role: 'general',   niches: [] },
  'scope-of-work':        { category: 'client',     role: 'general',   niches: [] },
  'deliverable-qa':       { category: 'quality',    role: 'general',   niches: [] },
  'memory-compactor':     { category: 'knowledge',  role: 'general',   niches: [] },
};

function bundledSpecialists(): LibRow[] {
  const rows: LibRow[] = [];
  for (const id of Object.keys(SUBAGENT_REGISTRY)) {
    const dir = join(AGENTS_DIR, 'sub-agents', id);
    const meta = SPECIALIST_CATEGORY[id] ?? { category: 'general', role: 'general', niches: [] };
    const soul = readMd(dir, 'soul.md');
    const agent_md = readMd(dir, 'agent.md');
    const skills = readMd(dir, 'skills.md');
    rows.push({
      id,
      name: titleize(id),
      category: meta.category,
      role: meta.role,
      // Was hardcoded null, which is why bundled specialists landed in the org chart's
      // "General" bucket. Derived from category where production data is unanimous;
      // still null where it genuinely is not (see agent-department.ts).
      department: departmentFor({ id, category: meta.category }),
      is_executive: false,
      does: SUBAGENT_REGISTRY[id].description,
      soul, agent_md, skills,
      default_niches: meta.niches,
      tags: ['specialist', meta.category],
      richness: (soul || agent_md || skills) ? 'rich' : 'thin',
      source: 'bundled',
    });
  }
  return rows;
}

function bundledOrchestrator(): LibRow {
  const dir = join(AGENTS_DIR, 'keyplayer');
  const soul = readMd(dir, 'soul.md');
  const agent_md = readMd(dir, 'agent.md');
  const skills = readMd(dir, 'skills.md');
  return {
    id: 'keyplayer',
    name: 'KeyPlayer',
    category: 'orchestration',
    role: 'orchestrator',
    department: 'leadership',
    is_executive: false,
    does: 'The main orchestrator. Plans the work, dispatches the squad, and talks to the owner. Never a spawnable specialist.',
    soul, agent_md, skills,
    default_niches: [],
    tags: ['orchestrator', 'core'],
    richness: (soul || agent_md || skills) ? 'rich' : 'thin',
    source: 'bundled',
  };
}

function execRows(): LibRow[] {
  return EXEC_SPECS.map((e) => ({
    id: e.id,
    name: e.name,
    category: 'leadership',
    role: 'general',
    department: e.department,
    is_executive: true,
    does: e.description,
    soul: e.soul,
    agent_md: e.agent_md,
    skills: e.skills,
    default_niches: [],
    tags: ['executive', 'c-suite', e.department],
    richness: 'rich' as Richness,
    source: 'exec',
  }));
}

// ── keycommand default agents (universal, installed on every command center) ──
//
// 4 of the 5 defaults are role-keys for a rich bundled cousin; we point the
// default row at that cousin's rich prompt so a provisioned command center gets
// a souled agent, not a stub. 'daily-brief' has no rich cousin → thin.
interface DefaultAgent { role: string; name: string; does: string }
const DEFAULT_COUSIN: Record<string, string | null> = {
  'research-analyst': 'research-analyst',
  'comms-triage': 'inbox-triage',
  scheduler: 'calendar-scheduler',
  'knowledge-librarian': 'memory-compactor',
  'daily-brief': null,
};

function defaultRows(specialistsById: Map<string, LibRow>): LibRow[] {
  const raw = JSON.parse(readFileSync(join(KEYCOMMAND_DIR, 'config', 'default-agents.json'), 'utf-8')) as { default_agents: DefaultAgent[] };
  const rows: LibRow[] = [];
  for (const d of raw.default_agents) {
    const cousinId = DEFAULT_COUSIN[d.role] ?? null;
    const cousin = cousinId ? specialistsById.get(cousinId) : undefined;
    rows.push({
      id: `default-${slugify(d.role)}`,
      name: d.name,
      category: cousin?.category ?? 'general',
      role: cousin?.role ?? 'general',
      department: null,
      is_executive: false,
      does: d.does,
      soul: cousin?.soul ?? '',
      agent_md: cousin?.agent_md ?? '',
      skills: cousin?.skills ?? '',
      default_niches: [],
      tags: ['default', 'universal', ...(cousinId ? [`cousin:${cousinId}`] : [])],
      richness: (cousin && (cousin.soul || cousin.agent_md || cousin.skills)) ? 'rich' : 'thin',
      source: 'default',
    });
  }
  return rows;
}

// ── keycommand archetype rows (15 rich, deduped from the 110 niche agents) ─────
//
// The 110 per-niche custom agents in niche-config.json are 15 authored,
// niche-agnostic archetype prompt-block sets (ARCHETYPE_SOULS) photocopied across
// 22 industries. Instead of 110 near-duplicate rows we emit ONE rich row per
// archetype, carrying:
//   • default_niches = UNION of every industry that pre-selects the archetype
//     (so agentsForNiche(niche) still surfaces it as "recommended for this niche"),
//   • tags: alias:<name> for EVERY distinct niche display name the archetype
//     answers to (so resolveNicheSlugsByName can still map a chosen niche name →
//     this single slug — see Half B in the sibling repo).
// niche-config.json is UNCHANGED: inference still emits the same 103 names; each
// now reconciles to its archetype's row via an alias tag.

interface Industry { slug: string; name: string; custom_agents: Array<{ name: string; does: string }> }

function loadNicheConfig(): { industries: Industry[] } {
  return JSON.parse(readFileSync(join(KEYCOMMAND_DIR, 'config', 'niche-config.json'), 'utf-8')) as { industries: Industry[] };
}

function archetypeRows(): LibRow[] {
  const cfg = loadNicheConfig();

  // Fold the config into: per archetype tag, the union of niches it serves and
  // the union of distinct niche display names it answers to.
  const byArch = new Map<string, { niches: Set<string>; aliases: Set<string> }>();
  for (const ind of cfg.industries) {
    for (const a of ind.custom_agents ?? []) {
      let tag = inferArchetype(a.name, a.does).tag;
      // Route any name whose inferred tag has no authored archetype blocks (the
      // 'general' fallback) onto ARCHETYPE_FALLBACK_TAG so its alias is never
      // dropped — otherwise the name could not reconcile to a slug.
      if (!ARCHETYPE_SOULS[tag]) {
        console.warn(
          `  [archetype] "${a.name}" (${ind.slug}) inferred tag '${tag}' has no ARCHETYPE_SOULS block — ` +
            `folding into '${ARCHETYPE_FALLBACK_TAG}' so its alias reconciles.`,
        );
        tag = ARCHETYPE_FALLBACK_TAG;
      }
      const e = byArch.get(tag) ?? { niches: new Set<string>(), aliases: new Set<string>() };
      e.niches.add(ind.slug);
      e.aliases.add(a.name);
      byArch.set(tag, e);
    }
  }

  // One row per authored archetype (the 15 keys of ARCHETYPE_SOULS).
  return Object.entries(ARCHETYPE_SOULS).map(([tag, blocks]) => {
    const meta = ARCHETYPES.find((a) => a.tag === tag);
    if (!meta) throw new Error(`ARCHETYPE_SOULS tag '${tag}' has no entry in the ARCHETYPES table.`);
    const display = ARCHETYPE_DISPLAY[tag];
    const does = ARCHETYPE_DOES[tag];
    if (!display || !does) {
      throw new Error(`Archetype '${tag}' is missing an ARCHETYPE_DISPLAY name and/or ARCHETYPE_DOES line.`);
    }
    const e = byArch.get(tag) ?? { niches: new Set<string>(), aliases: new Set<string>() };
    const niches = [...e.niches].sort();
    const aliases = [...e.aliases].sort();
    return {
      id: `archetype-${tag}`,
      name: display,
      category: meta.category,
      role: meta.role,
      department: null,
      is_executive: false,
      does,
      soul: blocks.soul,
      agent_md: blocks.agent_md,
      skills: blocks.skills,
      default_niches: niches,
      tags: ['archetype', `archetype:${tag}`, ...aliases.map((n) => `alias:${n}`)],
      richness: 'rich' as Richness,
      source: 'archetype',
    };
  });
}

// ── util ──────────────────────────────────────────────────────────────────────

function titleize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

// Idempotent cleanup of the OLD per-niche rows (dedupe migration). Before this
// change the seed wrote 110 rows with source='niche' / id like 'niche-%'. Those
// are fully replaced by the 15 'archetype-%' rows, so on any rerun we delete the
// leftovers. Matches on BOTH source and the id prefix so a partially-seeded table
// (e.g. an interrupted old run) is cleaned regardless. Safe: the new rows use the
// 'archetype-' prefix and source='archetype', so this never touches them.
async function cleanupStaleNicheRows(): Promise<number> {
  const rows = (await sql()`
    DELETE FROM public.agent_library
    WHERE source = 'niche' OR id LIKE 'niche-%'
    RETURNING id
  `) as unknown as Array<{ id: string }>;
  return rows.length;
}

async function upsert(row: LibRow): Promise<void> {
  await sql()`
    INSERT INTO public.agent_library (
      id, name, category, role, department, is_executive, does,
      soul, agent_md, skills, default_niches, tags, richness, source
    ) VALUES (
      ${row.id}, ${row.name}, ${row.category}, ${row.role}, ${row.department}, ${row.is_executive}, ${row.does},
      ${row.soul}, ${row.agent_md}, ${row.skills}, ${row.default_niches}, ${row.tags}, ${row.richness}, ${row.source}
    )
    ON CONFLICT (id) DO UPDATE SET
      name = EXCLUDED.name, category = EXCLUDED.category, role = EXCLUDED.role,
      department = EXCLUDED.department, is_executive = EXCLUDED.is_executive, does = EXCLUDED.does,
      soul = EXCLUDED.soul, agent_md = EXCLUDED.agent_md, skills = EXCLUDED.skills,
      default_niches = EXCLUDED.default_niches, tags = EXCLUDED.tags,
      richness = EXCLUDED.richness, source = EXCLUDED.source
  `;
}

async function main(): Promise<void> {
  const specialists = bundledSpecialists();
  const specialistsById = new Map(specialists.map((r) => [r.id, r]));

  const all: LibRow[] = [
    bundledOrchestrator(),
    ...specialists,
    ...execRows(),
    ...defaultRows(specialistsById),
    ...archetypeRows(),
  ];

  // Guard against accidental duplicate slugs across sources before writing.
  const ids = new Set<string>();
  for (const r of all) {
    if (ids.has(r.id)) throw new Error(`Duplicate library slug across sources: ${r.id}`);
    ids.add(r.id);
  }

  for (const r of all) await upsert(r);

  // Dedupe migration: remove the old 110 per-niche rows now that the 15 archetype
  // rows have been written. Idempotent — a clean table deletes 0.
  const deletedNiche = await cleanupStaleNicheRows();

  // ── report ──
  const bySource = new Map<string, { rich: number; thin: number }>();
  for (const r of all) {
    const b = bySource.get(r.source) ?? { rich: 0, thin: 0 };
    b[r.richness] += 1;
    bySource.set(r.source, b);
  }
  const totalRich = all.filter((r) => r.richness === 'rich').length;
  const totalThin = all.filter((r) => r.richness === 'thin').length;

  console.log('\nagent_library seed complete (upserted, idempotent)\n');
  console.log('  source        rich  thin  total');
  console.log('  ------------  ----  ----  -----');
  for (const [src, b] of [...bySource.entries()].sort()) {
    console.log(`  ${src.padEnd(12)}  ${String(b.rich).padStart(4)}  ${String(b.thin).padStart(4)}  ${String(b.rich + b.thin).padStart(5)}`);
  }
  console.log('  ------------  ----  ----  -----');
  console.log(`  ${'TOTAL'.padEnd(12)}  ${String(totalRich).padStart(4)}  ${String(totalThin).padStart(4)}  ${String(all.length).padStart(5)}`);

  // Alias coverage: every distinct niche display name must live on an archetype
  // row's alias:<name> tags, else resolveNicheSlugsByName can't reconcile it.
  const aliasCount = new Set(
    all.flatMap((r) => r.tags).filter((t) => t.startsWith('alias:')).map((t) => t.slice('alias:'.length)),
  ).size;

  console.log(`\n  distinct niches covered: ${new Set(all.flatMap((r) => r.default_niches)).size}`);
  console.log(`  niche display names aliased for reconciliation: ${aliasCount} (expect 103)`);
  console.log(`  stale niche-* rows deleted this run: ${deletedNiche}\n`);

  await sql().end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
