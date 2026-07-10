// import-agent-collections.ts — IMPORT license-verified public agent collections
// into the GLOBAL public.agent_library catalog (migration 0058), alongside the
// bundled/exec/default/archetype rows seeded by scripts/seed-agent-library.ts.
//
// WHAT THIS IS
// ------------
// The archetype dedupe (see the Agent Library dedupe spec) collapses the 110 thin
// niche rows into 15 rich archetypes and leaves the catalog at ~47 curated rows.
// This script is the OTHER half of the library story: it widens the catalog with
// battle-tested, PUBLISHABLE agent definitions from two MIT-licensed public
// collections, adapted into our house soul/agent_md/skills shape and attributed.
//
// Only business-relevant agents are pulled (marketing, content, SEO, sales,
// research, customer experience, ops) — this is a marketing/ops command center
// for local service businesses, so the two source repos' dev-tooling agents
// (backend-architect, fastapi-pro, k8s, …) are deliberately NOT in the shortlist.
// Dev-only / agile-ceremony / framework-meta agents are additionally listed in
// SKIP below with a reason, so the "why isn't X here" question has an answer.
//
// SOURCES (both MIT, license-verified 2026-07-10; pinned to a commit SHA so the
// fetch is reproducible and can't drift under us):
//   • wshobson/agents        @ d7cf7dca8c4c7d0635e284f77204daa85552bfa4  (MIT)
//   • VoltAgent/awesome-claude-code-subagents
//                            @ 947b44ca0c58d606b084e9cb1a2389335b49278b  (MIT)
//
// SAFETY: this script DOES NOT touch the DB by default. It fetches + adapts +
// validates + reports the projected import count by source. Pass `--write` to
// actually UPSERT into public.agent_library (idempotent on the slug PK). Pass
// `--offline` to skip network and adapt from a local cache dir if present.
//
//   # dry run (default) — fetch, adapt, report; no DB writes
//   npx tsx scripts/import-agent-collections.ts
//   # actually write to the catalog (TEST)
//   npx tsx --env-file=.env.test.local scripts/import-agent-collections.ts --write
//
// Slugs are deterministic and namespaced (`import-<sourceKey>-<basename>`) so they
// never collide with the existing bundled/exec/default/archetype/niche slugs.

import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// ── row shape (mirrors seed-agent-library.ts LibRow / migration 0058) ─────────

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

// ── source registry (pinned, license-verified) ───────────────────────────────

interface Source {
  key: string;          // short stable key used in slugs + attribution tags
  repo: string;         // owner/name
  sha: string;          // pinned commit
  license: string;      // SPDX id
  attribution: string;  // human label for the tags: ['source:...']
}

const SOURCES: Record<string, Source> = {
  wshobson: {
    key: 'wshobson',
    repo: 'wshobson/agents',
    sha: 'd7cf7dca8c4c7d0635e284f77204daa85552bfa4',
    license: 'MIT',
    attribution: 'wshobson/agents',
  },
  voltagent: {
    key: 'voltagent',
    repo: 'VoltAgent/awesome-claude-code-subagents',
    sha: '947b44ca0c58d606b084e9cb1a2389335b49278b',
    license: 'MIT',
    attribution: 'VoltAgent/awesome-claude-code-subagents',
  },
};

function rawUrl(src: Source, path: string): string {
  return `https://raw.githubusercontent.com/${src.repo}/${src.sha}/${path}`;
}

// ── the SHORTLIST (verified paths; business-relevant only) ────────────────────
//
// Every entry maps a real file (path verified against the pinned tree) to the
// catalog metadata we want the imported row to carry. `category`/`role` use the
// same vocabulary as migration 0058 (research|content|outreach|sales|scheduling|
// comms|client|quality|knowledge|leadership|general). `niches` pre-selects the
// row for an industry (usually [] — these are cross-niche); `extraTags` are extra
// browse facets on top of the automatic archetype/source/license tags.

interface Pick {
  src: string;               // key into SOURCES
  path: string;              // repo-relative file path (verified)
  category: string;
  role: string;
  niches?: string[];
  archetype?: string;        // optional archetype:<tag> facet (aligns with the 15)
  extraTags?: string[];
}

const SHORTLIST: Pick[] = [
  // ── VoltAgent · 08-business-product ──────────────────────────────────────
  { src: 'voltagent', path: 'categories/08-business-product/content-marketer.md',
    category: 'content', role: 'content', archetype: 'content-strategy' },
  { src: 'voltagent', path: 'categories/08-business-product/content-quality-editor.md',
    category: 'quality', role: 'general', extraTags: ['editing'] },
  { src: 'voltagent', path: 'categories/08-business-product/business-analyst.md',
    category: 'leadership', role: 'general', extraTags: ['analytics'] },
  { src: 'voltagent', path: 'categories/08-business-product/product-manager.md',
    category: 'leadership', role: 'general', extraTags: ['product'] },
  { src: 'voltagent', path: 'categories/08-business-product/customer-success-manager.md',
    category: 'client', role: 'general', extraTags: ['retention'] },
  { src: 'voltagent', path: 'categories/08-business-product/sales-engineer.md',
    category: 'sales', role: 'general', extraTags: ['pre-sales'] },
  { src: 'voltagent', path: 'categories/08-business-product/ux-researcher.md',
    category: 'research', role: 'research', extraTags: ['ux'] },
  { src: 'voltagent', path: 'categories/08-business-product/growth-loops.md',
    category: 'sales', role: 'general', extraTags: ['growth'] },
  // ── VoltAgent · 10-research-analysis ─────────────────────────────────────
  { src: 'voltagent', path: 'categories/10-research-analysis/market-researcher.md',
    category: 'research', role: 'research', archetype: 'research-scout' },
  { src: 'voltagent', path: 'categories/10-research-analysis/competitive-analyst.md',
    category: 'research', role: 'research', archetype: 'research-scout' },
  { src: 'voltagent', path: 'categories/10-research-analysis/trend-analyst.md',
    category: 'research', role: 'research', archetype: 'research-scout' },
  { src: 'voltagent', path: 'categories/10-research-analysis/data-researcher.md',
    category: 'research', role: 'research', extraTags: ['data'] },

  // ── wshobson · content-marketing ─────────────────────────────────────────
  // (wshobson content-marketer is skipped as a dup of VoltAgent's — see SKIP.)
  { src: 'wshobson', path: 'plugins/content-marketing/agents/search-specialist.md',
    category: 'research', role: 'research', archetype: 'research-scout' },
  // ── wshobson · customer-sales-automation ─────────────────────────────────
  { src: 'wshobson', path: 'plugins/customer-sales-automation/agents/customer-support.md',
    category: 'comms', role: 'general', extraTags: ['support'] },
  { src: 'wshobson', path: 'plugins/customer-sales-automation/agents/sales-automator.md',
    category: 'outreach', role: 'outreach', archetype: 'follow-up' },
  // ── wshobson · seo-content-creation ──────────────────────────────────────
  { src: 'wshobson', path: 'plugins/seo-content-creation/agents/seo-content-writer.md',
    category: 'content', role: 'content', extraTags: ['seo'] },
  { src: 'wshobson', path: 'plugins/seo-content-creation/agents/seo-content-planner.md',
    category: 'content', role: 'content', extraTags: ['seo'] },
  { src: 'wshobson', path: 'plugins/seo-content-creation/agents/seo-content-auditor.md',
    category: 'quality', role: 'general', extraTags: ['seo'] },
  // ── wshobson · seo-analysis-monitoring ───────────────────────────────────
  { src: 'wshobson', path: 'plugins/seo-analysis-monitoring/agents/seo-authority-builder.md',
    category: 'content', role: 'content', extraTags: ['seo'] },
  { src: 'wshobson', path: 'plugins/seo-analysis-monitoring/agents/seo-content-refresher.md',
    category: 'content', role: 'content', extraTags: ['seo'] },
  { src: 'wshobson', path: 'plugins/seo-analysis-monitoring/agents/seo-cannibalization-detector.md',
    category: 'quality', role: 'general', extraTags: ['seo'] },
  // ── wshobson · hr-legal-compliance ───────────────────────────────────────
  { src: 'wshobson', path: 'plugins/hr-legal-compliance/agents/hr-pro.md',
    category: 'client', role: 'general', extraTags: ['hr'] },
  { src: 'wshobson', path: 'plugins/hr-legal-compliance/agents/legal-advisor.md',
    category: 'client', role: 'general', extraTags: ['legal'] },
  // ── wshobson · startup-business-analyst ──────────────────────────────────
  { src: 'wshobson', path: 'plugins/startup-business-analyst/agents/startup-analyst.md',
    category: 'leadership', role: 'general', extraTags: ['strategy'] },
];

// ── the SKIP list (why the obvious-adjacent agents are NOT imported) ──────────
//
// Logged so the shortlist is auditable. `reason` is one of:
//   dev-only        — engineering tooling, no marketing/ops transfer
//   ceremony        — agile/PM ceremony agent, not a client-facing operator
//   meta            — framework/repo-internal agent (e.g. license-engineer)
//   duplicate       — substantially overlaps an agent already in the catalog
//   low-quality     — thin/checklist-only, below the "publishable" bar

interface Skip { ref: string; reason: string; note: string }

const SKIP: Skip[] = [
  { ref: 'wshobson/content-marketing/content-marketer', reason: 'duplicate',
    note: 'VoltAgent content-marketer already imported; near-identical scope.' },
  { ref: 'voltagent/10-research-analysis/research-analyst', reason: 'duplicate',
    note: 'collides with the bundled research-analyst specialist already in the catalog.' },
  { ref: 'voltagent/10-research-analysis/search-specialist', reason: 'duplicate',
    note: 'wshobson search-specialist imported instead; same role.' },
  { ref: 'voltagent/08-business-product/scrum-master', reason: 'ceremony',
    note: 'agile ceremony facilitation; not a client-facing marketing/ops operator.' },
  { ref: 'voltagent/08-business-product/project-manager', reason: 'ceremony',
    note: 'internal delivery PM; command center runs on missions/crons, not sprints.' },
  { ref: 'voltagent/08-business-product/backlog-grooming', reason: 'ceremony',
    note: 'sprint backlog ritual; out of scope for the command center.' },
  { ref: 'voltagent/08-business-product/assumption-mapping', reason: 'ceremony',
    note: 'discovery workshop facilitation; not an operating agent.' },
  { ref: 'voltagent/08-business-product/license-engineer', reason: 'meta',
    note: 'repo-internal licensing tooling; no business use.' },
  { ref: 'voltagent/08-business-product/wordpress-master', reason: 'dev-only',
    note: 'WordPress engineering; our publishing path is Instagram/social, not WP.' },
  { ref: 'voltagent/08-business-product/technical-writer', reason: 'duplicate',
    note: 'overlaps content-quality-editor + our bundled content agents.' },
  { ref: 'wshobson/seo-technical-optimization/*', reason: 'dev-only',
    note: 'crawl-budget / rendering / Core-Web-Vitals engineering; not operator work.' },
];

// ── frontmatter parse ─────────────────────────────────────────────────────────
//
// Both collections front their agent files with a small YAML block:
//   ---
//   name: <slug>
//   description: <one-liner, sometimes quoted, sometimes multi-word>
//   model: sonnet|haiku|opus   (optional)
//   tools: Read, Write, ...     (optional)
//   ---
// We only need name + description; a tiny hand-rolled parser avoids a yaml dep and
// tolerates the quoting/spacing variance between the two repos.

interface Frontmatter { name?: string; description?: string; model?: string; tools?: string; body: string }

function parseFrontmatter(raw: string): Frontmatter {
  const text = raw.replace(/^﻿/, '').replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(text);
  if (!m) return { body: text.trim() };
  const fmBlock = m[1];
  const body = text.slice(m[0].length).trim();
  const fm: Frontmatter = { body };
  // Parse simple `key: value` lines (values may be quoted; ignore nested/indented).
  for (const line of fmBlock.split('\n')) {
    const kv = /^([A-Za-z_][A-Za-z0-9_-]*):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const key = kv[1].toLowerCase();
    let val = kv[2].trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key === 'name') fm.name = val;
    else if (key === 'description') fm.description = val;
    else if (key === 'model') fm.model = val;
    else if (key === 'tools') fm.tools = val;
  }
  return fm;
}

// ── house-style helpers ───────────────────────────────────────────────────────

function titleize(id: string): string {
  return id.replace(/[-_]/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/** basename of a repo path without the .md extension, e.g. 'content-marketer'. */
function basename(path: string): string {
  const file = path.split('/').pop() ?? path;
  return file.replace(/\.md$/i, '');
}

/** First sentence / first ~200 chars of a description, for the `does` pick signal. */
function oneLine(desc: string): string {
  const clean = desc.replace(/\s+/g, ' ').trim();
  if (clean.length <= 200) return clean;
  const cut = clean.slice(0, 200);
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('; '));
  return (lastStop > 80 ? cut.slice(0, lastStop + 1) : cut.trimEnd() + '…');
}

// ── the ADAPTER: source file → our three house-style blocks ───────────────────
//
// House style (see agents/sub-agents/**): each block is markdown that opens with
// `# <name> — Soul|Agent Definition|Skills`. We preserve the ORIGINAL prompt
// substance verbatim (the imported author's guidance is the value); we only
// re-frame it under our headers, add the "spawned by KeyPlayer / worker-not-host /
// draft-don't-send" house posture, and stamp provenance. We do NOT rewrite the
// body's content — that would strip the substance the spec says to preserve.
//
// Recipe:
//   soul     = our identity/voice header + posture, then the source's opening
//              persona line ("You are a senior …") if present.
//   agent_md = our mission line (from the description) + the FULL source body
//              (its capabilities/checklists/workflow — the real substance).
//   skills   = a short house preamble (tools/read/write posture) + a distilled
//              capability list pulled from the source's own section headers.

const HOUSE_POSTURE = [
  '## House posture (KeyPlayer command center)',
  '- You are a **worker, not a host**: no greetings, no sign-offs, no filler. Your output goes back to KeyPlayer, who repackages it for the owner.',
  '- **Draft, never send.** Anything customer-facing is a `draft` for owner approval unless the owner has explicitly wired auto-send.',
  '- **Stay scoped and grounded.** Answer the exact task; never invent numbers, names, dates, or prices. Trace claims to a real source.',
  '- The platform injects the business brief, niche genes, and guardrails at run time — you stay niche-agnostic and let that context specialize you.',
].join('\n');

/** Pull the source persona opener (first non-empty paragraph) if it reads like one. */
function personaOpener(body: string): string {
  const para = body.split('\n\n').map((p) => p.trim()).find((p) => p.length > 0) ?? '';
  return /^you are\b/i.test(para) ? para : '';
}

/** Distill a skills list from the source's `##`/`###` section headers. */
function capabilityBullets(body: string): string[] {
  const heads = [...body.matchAll(/^#{2,4}\s+(.+?)\s*$/gm)].map((m) => m[1].trim());
  const drop = /^(purpose|overview|mission|when invoked|response|communication|output|integration|deliverables?)$/i;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const h of heads) {
    const key = h.toLowerCase();
    if (drop.test(h) || seen.has(key)) continue;
    seen.add(key);
    out.push(h);
    if (out.length >= 8) break;
  }
  return out;
}

function adapt(pick: Pick, src: Source, fm: Frontmatter): LibRow {
  const base = basename(pick.path);
  const displayName = titleize(base);
  const description = (fm.description ?? '').trim() || `${displayName} agent imported from ${src.attribution}.`;
  const does = oneLine(description);
  const opener = personaOpener(fm.body);

  const soul = [
    `# ${displayName} — Soul`,
    '',
    `You are the **${base}** agent, spawned by KeyPlayer to bring specialist ${pick.category} judgment to the business. Adapted for the command center from ${src.attribution} (${src.license}).`,
    '',
    '## Voice',
    'Terse, factual, structured — one competent operator handing work back to KeyPlayer. No throat-clearing, no corporate hedging.',
    '',
    opener ? `## Origin persona\n${opener}` : '',
    '',
    HOUSE_POSTURE,
  ].filter((l) => l !== '').join('\n').replace(/\n{3,}/g, '\n\n');

  const agent_md = [
    `# ${displayName} — Agent Definition`,
    '',
    '## Mission',
    description,
    '',
    '## Model',
    '`claude-sonnet-4-6` — judgment and synthesis matter more than raw speed.',
    '',
    '## Behavior & playbook (preserved from source)',
    fm.body,
    '',
    '## Hard constraints (house)',
    '- ❌ No made-up numbers, dates, names, prices, or outcomes.',
    '- ❌ No greetings, sign-offs, or meta-commentary.',
    '- ❌ Never send anything customer-facing yourself — draft for owner approval.',
    `- ℹ️ Imported from ${src.attribution} @ ${src.sha.slice(0, 10)} (${src.license}); prompt substance preserved, framing adapted.`,
  ].join('\n');

  const bullets = capabilityBullets(fm.body);
  const skills = [
    `# ${displayName} — Skills`,
    '',
    '## Tools available',
    fm.tools ? `- Source-declared: ${fm.tools}` : '- KeyPlayer wires the tools this task needs at spawn time.',
    '',
    '## Core capabilities',
    ...(bullets.length ? bullets.map((b) => `- ${b}`) : ['- See the Agent Definition for the full capability set.']),
    '',
    '## Write access',
    '- **Draft-only** for anything customer-facing. You return text; the owner approves before it ships.',
  ].join('\n');

  const tags = [
    'import',
    `source:${src.attribution}`,
    `license:${src.license}`,
    ...(pick.archetype ? [`archetype:${pick.archetype}`] : []),
    `alias:${displayName}`,
    ...(pick.extraTags ?? []),
  ];

  return {
    id: `import-${src.key}-${base}`,
    name: displayName,
    category: pick.category,
    role: pick.role,
    department: null,
    is_executive: false,
    does,
    soul,
    agent_md,
    skills,
    default_niches: (pick.niches ?? []).slice().sort(),
    tags,
    richness: 'rich',
    source: `import:${src.key}`,
  };
}

// ── fetch (network, with a local cache so reruns / offline work) ──────────────

const CACHE_DIR = join(__dirname, '..', '.cache', 'agent-collections');

function cachePath(src: Source, path: string): string {
  return join(CACHE_DIR, src.key, path.replace(/[\/]/g, '__'));
}

async function fetchFile(src: Source, path: string, offline: boolean): Promise<string> {
  const cp = cachePath(src, path);
  if (existsSync(cp)) return readFileSync(cp, 'utf-8');
  if (offline) throw new Error(`--offline set but no cache for ${src.key}:${path}`);
  const url = rawUrl(src, path);
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url} → HTTP ${res.status}`);
  const text = await res.text();
  try {
    mkdirSync(join(CACHE_DIR, src.key), { recursive: true });
    writeFileSync(cp, text, 'utf-8');
  } catch { /* cache is best-effort */ }
  return text;
}

// ── db upsert (only when --write) ─────────────────────────────────────────────

async function upsertAll(rows: LibRow[]): Promise<void> {
  // Import lazily so the dry-run path never needs SUPABASE_DB_URL.
  const { sql } = await import('../src/lib/db/client');
  for (const row of rows) {
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
  await sql().end({ timeout: 5 });
}

// ── main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const write = args.has('--write');
  const offline = args.has('--offline');

  const rows: LibRow[] = [];
  const failures: Array<{ ref: string; error: string }> = [];

  for (const pick of SHORTLIST) {
    const src = SOURCES[pick.src];
    if (!src) { failures.push({ ref: pick.path, error: `unknown source ${pick.src}` }); continue; }
    try {
      const raw = await fetchFile(src, pick.path, offline);
      const fm = parseFrontmatter(raw);
      if (!fm.body || fm.body.length < 200) {
        failures.push({ ref: `${src.key}:${pick.path}`, error: 'body too thin (<200 chars) — skipped as low-quality' });
        continue;
      }
      rows.push(adapt(pick, src, fm));
    } catch (e) {
      failures.push({ ref: `${src.key}:${pick.path}`, error: e instanceof Error ? e.message : String(e) });
    }
  }

  // Guard: deterministic slugs must be unique and must not shadow reserved
  // prefixes used by the other seeders (niche-/default-/archetype-/exec ids).
  const ids = new Set<string>();
  for (const r of rows) {
    if (ids.has(r.id)) throw new Error(`Duplicate import slug: ${r.id}`);
    if (!r.id.startsWith('import-')) throw new Error(`Import slug must be namespaced: ${r.id}`);
    ids.add(r.id);
  }

  // ── report ──
  const bySource = new Map<string, number>();
  for (const r of rows) bySource.set(r.source, (bySource.get(r.source) ?? 0) + 1);

  console.log('\nagent collection import — projected rows (all richness: rich)\n');
  console.log('  source              rows');
  console.log('  ------------------  ----');
  for (const [s, n] of [...bySource.entries()].sort()) {
    console.log(`  ${s.padEnd(18)}  ${String(n).padStart(4)}`);
  }
  console.log('  ------------------  ----');
  console.log(`  ${'TOTAL'.padEnd(18)}  ${String(rows.length).padStart(4)}`);

  console.log(`\n  skipped (by design): ${SKIP.length}`);
  for (const s of SKIP) console.log(`    - [${s.reason}] ${s.ref} — ${s.note}`);

  if (failures.length) {
    console.log(`\n  fetch/quality failures: ${failures.length}`);
    for (const f of failures) console.log(`    - ${f.ref}: ${f.error}`);
  }

  if (write) {
    console.log('\n  --write set → upserting into public.agent_library …');
    await upsertAll(rows);
    console.log('  done (idempotent upsert).');
  } else {
    console.log('\n  DRY RUN (no DB writes). Re-run with --write to upsert into public.agent_library.');
  }
  console.log('');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
