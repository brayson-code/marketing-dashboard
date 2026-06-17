import { sql } from './db/client';
import { getAgentDefForEditor, upsertAgentDef } from './agent-defs';
import { supabaseAdmin } from './supabase/admin';

// The Skill Library: a global, curated catalog of reusable agent skills. Users
// browse it and "install" a skill into one of their agents — which appends the
// skill's text to that agent's `skills` field (copy-on-write into agent_defs).
// The catalog is synced from a GitHub repo (manifest.json) and seeded with a
// starter set (migration 0044).

export interface Skill {
  id: number;
  slug: string;
  name: string;
  category: string;
  description: string;
  body: string;
  source_url: string | null;
}

/** The whole catalog, grouped-friendly (category, then name). */
export async function listSkills(): Promise<Skill[]> {
  const rows = (await sql()`
    SELECT id, slug, name, category, description, body, source_url
    FROM public.skill_library ORDER BY category, name
  `) as unknown as Skill[];
  return rows;
}

async function getSkill(slug: string): Promise<Skill | null> {
  const rows = (await sql()`
    SELECT id, slug, name, category, description, body, source_url
    FROM public.skill_library WHERE slug = ${slug} LIMIT 1
  `) as unknown as Skill[];
  return rows[0] ?? null;
}

// A skill is appended under a unique marker so it's identifiable (and idempotent —
// re-installing the same skill replaces its block rather than duplicating it).
function applySkill(existing: string, skill: Skill): string {
  const start = `<!-- skill:${skill.slug} -->`;
  const end = `<!-- /skill:${skill.slug} -->`;
  const block = `${start}\n## Skill — ${skill.name}\n${skill.body.trim()}\n${end}`;
  const base = existing ?? '';
  // Replace any prior copy of this skill's block, else append.
  const re = new RegExp(`${start}[\\s\\S]*?${end}`, 'g');
  if (re.test(base)) return base.replace(re, block).trim();
  return (base.trim() ? `${base.trim()}\n\n` : '') + block;
}

export interface InstallResult { agentId: string; skill: string }

/** Install a catalog skill into one of the workspace's agents. */
export async function installSkillToAgent(slug: string, agentId: string): Promise<InstallResult> {
  const skill = await getSkill(slug);
  if (!skill) throw new Error('Skill not found');
  const def = await getAgentDefForEditor(agentId);
  if (!def) throw new Error('Agent not found');
  await upsertAgentDef({
    id: def.id,
    name: def.name,
    role: def.role,
    model: def.model,
    max_tokens: def.max_tokens,
    rate_per_hour: def.rate_per_hour,
    description: def.description,
    soul: def.soul,
    agent_md: def.agent_md,
    skills: applySkill(def.skills, skill),
    spawnable: def.spawnable,
    enabled: def.enabled,
    source: def.source === 'builtin' ? 'builtin' : 'custom',
  });
  return { agentId: def.id, skill: skill.name };
}

/** Remove a previously-installed skill block from an agent. */
export async function removeSkillFromAgent(slug: string, agentId: string): Promise<void> {
  const def = await getAgentDefForEditor(agentId);
  if (!def) throw new Error('Agent not found');
  const re = new RegExp(`<!-- skill:${slug} -->[\\s\\S]*?<!-- /skill:${slug} -->`, 'g');
  const cleaned = (def.skills ?? '').replace(re, '').replace(/\n{3,}/g, '\n\n').trim();
  await upsertAgentDef({
    id: def.id, name: def.name, role: def.role, model: def.model, max_tokens: def.max_tokens,
    rate_per_hour: def.rate_per_hour, description: def.description, soul: def.soul,
    agent_md: def.agent_md, skills: cleaned, spawnable: def.spawnable, enabled: def.enabled,
    source: def.source === 'builtin' ? 'builtin' : 'custom',
  });
}

interface ManifestEntry { slug: string; name: string; category?: string; description?: string; file: string }

/** Sync the catalog from a GitHub repo's manifest.json (HQ-only; writes via the
 *  service role so it can update the global catalog). Repo defaults to env
 *  SKILLS_GITHUB_REPO ("owner/repo"), branch SKILLS_GITHUB_BRANCH (default main). */
export async function syncSkillsFromGitHub(): Promise<{ synced: number; repo: string }> {
  const repo = process.env.SKILLS_GITHUB_REPO?.trim() || 'keyplayershq/agent-skills';
  const branch = process.env.SKILLS_GITHUB_BRANCH?.trim() || 'main';
  const raw = (p: string) => `https://raw.githubusercontent.com/${repo}/${branch}/${p}`;

  const manRes = await fetch(raw('manifest.json'), { cache: 'no-store' });
  if (!manRes.ok) throw new Error(`Could not read ${repo}/manifest.json (HTTP ${manRes.status}). Create the repo + manifest, or check SKILLS_GITHUB_REPO.`);
  const manifest = (await manRes.json()) as ManifestEntry[];
  if (!Array.isArray(manifest)) throw new Error('manifest.json must be a JSON array of skills.');

  const rows: Array<Record<string, unknown>> = [];
  for (const e of manifest.slice(0, 200)) {
    if (!e?.slug || !e?.file) continue;
    const bRes = await fetch(raw(e.file), { cache: 'no-store' });
    if (!bRes.ok) continue;
    rows.push({
      slug: String(e.slug), name: String(e.name || e.slug), category: String(e.category || 'general'),
      description: String(e.description || ''), body: (await bRes.text()).trim(),
      source_url: raw(e.file), updated_at: new Date().toISOString(),
    });
  }
  if (rows.length) {
    const { error } = await supabaseAdmin().from('skill_library').upsert(rows, { onConflict: 'slug' });
    if (error) throw new Error(`Catalog write failed: ${error.message}`);
  }
  return { synced: rows.length, repo };
}
