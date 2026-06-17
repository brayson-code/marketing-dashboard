import { sql, tenantId } from './db/client';
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
  is_custom: boolean;
}

/** Curated globals + this workspace's own custom skills (RLS scopes the rows).
 *  Custom (workspace-owned) skills sort first so they're easy to find. */
export async function listSkills(): Promise<Skill[]> {
  const rows = (await sql()`
    SELECT id, slug, name, category, description, body, source_url,
           (tenant_id IS NOT NULL) AS is_custom
    FROM public.skill_library ORDER BY (tenant_id IS NOT NULL) DESC, category, name
  `) as unknown as Skill[];
  return rows;
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'skill';
}

function prettify(name: string): string {
  return name.replace(/\.md$/i, '').replace(/[-_]+/g, ' ').trim().replace(/\b\w/g, (c) => c.toUpperCase()).slice(0, 120) || name;
}

function firstLine(body: string): string {
  for (const ln of body.split('\n')) {
    const t = ln.replace(/^#{1,6}\s*/, '').replace(/[*_`>]/g, '').trim();
    if (t) return t;
  }
  return '';
}

// No-manifest fallback: list every .md skill in a repo (try skills/, then root).
async function listMarkdownSkills(repo: string, branch: string, token?: string): Promise<ManifestEntry[]> {
  const listDir = async (dir: string): Promise<Array<{ name: string; path: string; type: string }> | null> => {
    const url = `https://api.github.com/repos/${repo}/contents/${dir}?ref=${encodeURIComponent(branch)}`;
    const headers: Record<string, string> = { Accept: 'application/vnd.github+json' };
    if (token) headers.Authorization = `Bearer ${token}`;
    const r = await fetch(url, { headers, cache: 'no-store' });
    if (!r.ok) return null;
    const j = await r.json();
    return Array.isArray(j) ? j : null;
  };
  const items = (await listDir('skills')) ?? (await listDir(''));
  if (!items) return [];
  return items
    .filter((it) => it.type === 'file' && /\.md$/i.test(it.name) && it.name.toLowerCase() !== 'readme.md')
    .map((it) => ({ slug: it.name.replace(/\.md$/i, ''), name: prettify(it.name), category: 'custom', description: '', file: it.path }));
}

export interface AddSkillInput { name: string; category?: string; description?: string; body?: string; bodyUrl?: string }

/** Add a workspace's OWN skill (paste a body or import from a raw URL). Tenant-scoped. */
export async function addCustomSkill(input: AddSkillInput): Promise<Skill> {
  const name = (input.name ?? '').trim();
  if (!name) throw new Error('A skill name is required');
  let body = (input.body ?? '').trim();
  let sourceUrl: string | null = null;
  if (!body && input.bodyUrl) {
    const url = input.bodyUrl.trim();
    if (!/^https?:\/\//.test(url)) throw new Error('Import URL must start with http(s)://');
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`Could not fetch that URL (HTTP ${res.status})`);
    body = (await res.text()).trim();
    sourceUrl = url;
  }
  if (!body) throw new Error('Paste the skill text or give an import URL');
  // Random suffix keeps the global unique(slug) intact across tenants.
  const rand = String(Math.abs(Number(`${name.length}${body.length}`) % 1e6)).padStart(6, '0');
  const slug = `${slugify(name)}-${rand}`;
  const rows = (await sql()`
    INSERT INTO public.skill_library (tenant_id, slug, name, category, description, body, source_url)
    VALUES (${tenantId()}, ${slug}, ${name.slice(0, 120)}, ${(input.category || 'custom').slice(0, 40)},
            ${(input.description || '').slice(0, 400)}, ${body.slice(0, 20000)}, ${sourceUrl})
    RETURNING id, slug, name, category, description, body, source_url, true AS is_custom
  `) as unknown as Skill[];
  return rows[0];
}

/** Delete a workspace's own custom skill (RLS prevents touching globals/others). */
export async function deleteCustomSkill(slug: string): Promise<void> {
  await sql()`DELETE FROM public.skill_library WHERE slug = ${slug} AND tenant_id = ${tenantId()}`;
}

/** Bulk-import a WORKSPACE'S OWN GitHub repo of skills into THEIR library
 *  (tenant-scoped). Public repos need no token; private repos take a GitHub PAT
 *  (used transiently, never stored). Re-importing updates by a deterministic
 *  per-tenant slug, so it's a re-sync, not duplication. */
export async function importRepoSkills(opts: { repo: string; branch?: string; token?: string }): Promise<{ imported: number; repo: string }> {
  const repo = (opts.repo ?? '').trim().replace(/^https?:\/\/github\.com\//, '').replace(/\.git$/, '').replace(/\/+$/, '');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Error('Repo must look like "owner/name".');
  const branch = (opts.branch || 'main').trim();
  const token = opts.token?.trim();

  const fetchFile = async (path: string): Promise<string | null> => {
    const url = token
      ? `https://api.github.com/repos/${repo}/contents/${path}?ref=${encodeURIComponent(branch)}`
      : `https://raw.githubusercontent.com/${repo}/${branch}/${path}`;
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github.raw' } : {};
    const r = await fetch(url, { headers, cache: 'no-store' });
    return r.ok ? await r.text() : null;
  };

  // Prefer a manifest.json; if there's none, fall back to every .md file under
  // skills/ (or the repo root) — a bare folder of markdown skills just works.
  let manifest: ManifestEntry[];
  const manRaw = await fetchFile('manifest.json');
  if (manRaw != null) {
    try { manifest = JSON.parse(manRaw); } catch { throw new Error('manifest.json is not valid JSON.'); }
    if (!Array.isArray(manifest)) throw new Error('manifest.json must be a JSON array of skills.');
  } else {
    manifest = await listMarkdownSkills(repo, branch, token);
    if (manifest.length === 0) {
      throw new Error(`No manifest.json found, and no .md files under skills/ or the repo root in ${repo} (${branch}). Add a manifest.json, or put your skills as .md files in a skills/ folder.`);
    }
  }

  const tag = tenantId().replace(/-/g, '').slice(0, 8); // keeps slugs unique per workspace
  let imported = 0;
  for (const e of manifest.slice(0, 200)) {
    if (!e?.slug || !e?.file) continue;
    const body = await fetchFile(e.file);
    if (body == null) continue;
    const slug = `${slugify(String(e.slug))}-${tag}`;
    const description = (String(e.description || '').trim() || firstLine(body)).slice(0, 400);
    await sql()`
      INSERT INTO public.skill_library (tenant_id, slug, name, category, description, body, source_url)
      VALUES (${tenantId()}, ${slug}, ${String(e.name || e.slug).slice(0, 120)}, ${String(e.category || 'custom').slice(0, 40)},
              ${description}, ${body.trim().slice(0, 20000)}, ${`https://github.com/${repo}/blob/${branch}/${e.file}`})
      ON CONFLICT (slug) DO UPDATE SET
        name = EXCLUDED.name, category = EXCLUDED.category, description = EXCLUDED.description,
        body = EXCLUDED.body, source_url = EXCLUDED.source_url, updated_at = now()
      WHERE public.skill_library.tenant_id = ${tenantId()}
    `;
    imported += 1;
  }
  if (imported === 0) throw new Error('No skills imported — is the manifest empty or are the file paths wrong?');
  return { imported, repo };
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
