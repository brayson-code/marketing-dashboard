// Build-time loader for the public docs. Reads the markdown files in /docs and
// turns them into page content + a search index. All reads happen during
// `next build` (the /docs routes are force-static), so there is no runtime
// filesystem access on Vercel — the content is baked into the prerendered HTML.
import fs from 'node:fs';
import path from 'node:path';
import GithubSlugger from 'github-slugger';
import { DOCS_NAV, DOC_TITLES, groupOf } from './docs-nav';

export type DocHeading = { depth: 2 | 3; text: string; id: string };
export type DocPage = { slug: string; title: string; group: string | null; markdown: string; headings: DocHeading[] };
export type SearchEntry = { slug: string; title: string; group: string; headings: string[]; excerpt: string };

const DOCS_DIR = path.join(process.cwd(), 'docs');

function readRaw(slug: string): string | null {
  // The home page (/docs) renders README.md.
  const file = slug === 'index' ? 'README.md' : `${slug}.md`;
  try {
    return fs.readFileSync(path.join(DOCS_DIR, file), 'utf8');
  } catch {
    return null;
  }
}

// Strip the common inline markdown so headings/excerpts read as plain text.
function stripInline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/_([^_]+)_/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .trim();
}

// Pull ## / ### headings (skipping fenced code) and slug them with the SAME
// algorithm rehype-slug uses, so the on-this-page TOC anchors line up exactly
// with the ids rehype-slug stamps on the rendered headings.
function parseHeadings(md: string): DocHeading[] {
  const slugger = new GithubSlugger();
  const out: DocHeading[] = [];
  let inFence = false;
  for (const line of md.split('\n')) {
    if (/^\s*```/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;
    const m = /^(#{2,3})\s+(.+?)\s*#*\s*$/.exec(line);
    if (!m) continue;
    out.push({ depth: m[1].length as 2 | 3, text: stripInline(m[2]), id: slugger.slug(stripInline(m[2])) });
  }
  return out;
}

function titleOf(md: string, slug: string): string {
  const m = /^#\s+(.+)$/m.exec(md);
  return m ? stripInline(m[1]) : (DOC_TITLES[slug] ?? slug);
}

// First real prose paragraph after the H1 — used as the search-result snippet.
function firstParagraph(md: string): string {
  const body = md.replace(/^#\s+.+$/m, '').trim();
  for (const block of body.split(/\n\s*\n/)) {
    const t = block.trim();
    if (!t || t.startsWith('#') || t.startsWith('>') || t.startsWith('|') || t.startsWith('-') || t.startsWith('```')) continue;
    return stripInline(t).slice(0, 220);
  }
  return '';
}

export function getDoc(slug: string): DocPage | null {
  const md = readRaw(slug);
  if (md == null) return null;
  return { slug, title: titleOf(md, slug), group: slug === 'index' ? null : groupOf(slug), markdown: md, headings: parseHeadings(md) };
}

// Which screenshot PNGs actually exist in public/docs-images (read at build).
// The markdown renderer uses this to show a real image when present and the
// captioned placeholder when not — so a doc upgrades from placeholder → real
// screenshot the moment the file lands, with no markdown change.
export function existingDocImages(): Set<string> {
  try {
    return new Set(
      fs
        .readdirSync(path.join(process.cwd(), 'public', 'docs-images'))
        .filter((f) => /\.(png|jpe?g|webp|gif|svg)$/i.test(f)),
    );
  } catch {
    return new Set();
  }
}

export function getSearchIndex(): SearchEntry[] {
  const entries: SearchEntry[] = [];
  for (const g of DOCS_NAV) {
    for (const it of g.items) {
      const md = readRaw(it.slug);
      if (md == null) continue;
      entries.push({
        slug: it.slug,
        title: it.title,
        group: g.group,
        headings: parseHeadings(md).map((h) => h.text),
        excerpt: firstParagraph(md),
      });
    }
  }
  return entries;
}
