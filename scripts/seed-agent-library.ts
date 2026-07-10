// seed-agent-library.ts — POPULATE the GLOBAL public.agent_library catalog
// (migration 0058) from every authored agent source the two scouts found:
//
//   1. bundled agents/keyplayer/**            → 1 rich orchestrator
//   2. bundled agents/sub-agents/**           → 21 rich specialists
//   3. EXEC_SPECS (test-seed-common.ts)       → 5 rich C-suite executives
//   4. keycommand-provisioning default-agents → 5 universal defaults (rich when a
//                                               bundled cousin exists, else thin)
//   5. keycommand-provisioning niche-config   → 110 thin niche custom agents
//                                               (name + `does` only), tagged by
//                                               niche + inferred archetype, with
//                                               default_niches = [that industry]
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

// Short, stable per-niche prefix so a niche agent's slug is deterministic AND
// collision-free across the 22 industries (e.g. 'niche-pi-instant-intake-
// responder'). Keyed on the industry slug from niche-config.json.
const NICHE_PREFIX: Record<string, string> = {
  personal_injury_law: 'pi',
  real_estate: 're',
  construction: 'construction',
  beverage: 'beverage',
  med_spa: 'medspa',
  dental: 'dental',
  hvac: 'hvac',
  roofing: 'roofing',
  mortgage: 'mortgage',
  insurance: 'insurance',
  property_mgmt: 'propmgmt',
  financial_advisors: 'finadvisor',
  accounting: 'accounting',
  concierge_medicine: 'concierge',
  solar: 'solar',
  auto_dealership: 'auto',
  staffing: 'staffing',
  fitness: 'fitness',
  restaurants: 'restaurants',
  coaching: 'coaching',
  vending: 'vending',
  landscaping: 'landscaping',
};

function nichePrefix(industrySlug: string): string {
  return NICHE_PREFIX[industrySlug] ?? slugify(industrySlug);
}

// ── archetype inference for the thin niche agents ─────────────────────────────
//
// The 110 niche agents collapse into ~15 archetypes (see Scout B). We infer the
// archetype from the name + `does` so the catalog is filterable ("show me every
// Follow-up/Chaser") and so provisioning can map a thin niche agent to its rich
// cousin later. Purely a tag — it never changes what gets seeded.

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
      department: null,
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

// ── keycommand niche custom agents (110 thin, per-industry) ───────────────────

interface Industry { slug: string; name: string; custom_agents: Array<{ name: string; does: string }> }

function nicheRows(): LibRow[] {
  const cfg = JSON.parse(readFileSync(join(KEYCOMMAND_DIR, 'config', 'niche-config.json'), 'utf-8')) as { industries: Industry[] };
  const rows: LibRow[] = [];
  const seen = new Set<string>();
  for (const ind of cfg.industries) {
    for (const a of ind.custom_agents ?? []) {
      const arch = inferArchetype(a.name, a.does);
      let id = `niche-${nichePrefix(ind.slug)}-${slugify(a.name)}`;
      // Deterministic de-dup guard (slug collisions within a niche are unlikely
      // but keep the PK safe).
      let n = 2;
      while (seen.has(id)) { id = `niche-${nichePrefix(ind.slug)}-${slugify(a.name)}-${n++}`; }
      seen.add(id);
      // If the inferred archetype has authored prompt blocks (archetype-souls.ts),
      // the niche agent inherits them and becomes RICH — at provision time the
      // platform layers the niche/company context (brief + genes) on top. An
      // archetype with no authored blocks (or the 'general' fallback) stays THIN
      // (name + `does` only). Blocks are archetype-agnostic to the niche, so the
      // same three strings serve every niche sharing that archetype.
      const blocks = ARCHETYPE_SOULS[arch.tag];
      rows.push({
        id,
        name: a.name,
        category: arch.category,
        role: arch.role,
        department: null,
        is_executive: false,
        does: a.does,
        soul: blocks?.soul ?? '',
        agent_md: blocks?.agent_md ?? '',
        skills: blocks?.skills ?? '',
        default_niches: [ind.slug],
        tags: ['niche', `niche:${ind.slug}`, `archetype:${arch.tag}`],
        richness: blocks ? ('rich' as Richness) : ('thin' as Richness),
        source: 'niche',
      });
    }
  }
  return rows;
}

// ── util ──────────────────────────────────────────────────────────────────────

function titleize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
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
    ...nicheRows(),
  ];

  // Guard against accidental duplicate slugs across sources before writing.
  const ids = new Set<string>();
  for (const r of all) {
    if (ids.has(r.id)) throw new Error(`Duplicate library slug across sources: ${r.id}`);
    ids.add(r.id);
  }

  for (const r of all) await upsert(r);

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
  console.log(`\n  distinct niches covered: ${new Set(all.flatMap((r) => r.default_niches)).size}`);
  console.log(`  gap to 200: ${Math.max(0, 200 - all.length)} rows\n`);

  await sql().end({ timeout: 5 });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
