// Lightweight retrieval over the public docs for the in-app Help assistant
// (/api/help). The docs are small (~two dozen short markdown files), so instead
// of embeddings we keyword-rank them against the user's question and stuff the
// few most relevant pages (full text) into the model's context. Always grounds
// on getting-started so the assistant has the basics even for vague questions.
import { DOCS_NAV } from './docs-nav';
import { getDoc } from './docs-content';

export interface DocChunk { slug: string; title: string; markdown: string }

function allDocs(): DocChunk[] {
  const slugs = new Set<string>(['index', 'getting-started']);
  for (const g of DOCS_NAV) for (const it of g.items) slugs.add(it.slug);
  const out: DocChunk[] = [];
  for (const slug of slugs) {
    const d = getDoc(slug);
    if (d) out.push({ slug, title: d.title, markdown: d.markdown });
  }
  return out;
}

function score(question: string, d: DocChunk): number {
  const terms = question.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 2);
  if (!terms.length) return 0;
  const title = d.title.toLowerCase();
  const body = d.markdown.toLowerCase();
  let s = 0;
  for (const t of terms) {
    if (title.includes(t)) s += 6;
    const occ = body.split(t).length - 1;
    s += Math.min(occ, 8);
  }
  return s;
}

function docPath(slug: string): string {
  return slug === 'index' ? '/docs' : `/docs/${slug}`;
}

/** Build a grounded-docs context string for the model from the question. */
export function buildHelpContext(question: string, opts?: { maxDocs?: number; maxChars?: number }): string {
  const maxDocs = opts?.maxDocs ?? 6;
  const maxChars = opts?.maxChars ?? 42000;
  const docs = allDocs();

  const ranked = docs
    .map((d) => ({ d, s: score(question, d) }))
    .sort((a, b) => b.s - a.s);

  const picked: DocChunk[] = [];
  const add = (d?: DocChunk) => { if (d && !picked.includes(d)) picked.push(d); };
  for (const r of ranked) { if (r.s > 0 && picked.length < maxDocs) add(r.d); }
  // Always ground on the basics, even for vague/no-match questions.
  add(docs.find((d) => d.slug === 'getting-started'));
  if (picked.length <= 1) add(docs.find((d) => d.slug === 'index'));

  let out = '';
  for (const d of picked) {
    const block = `\n\n===== DOC: ${d.title}  (page: ${docPath(d.slug)}) =====\n${d.markdown}`;
    if (out.length + block.length > maxChars) break;
    out += block;
  }
  return out.trim();
}
