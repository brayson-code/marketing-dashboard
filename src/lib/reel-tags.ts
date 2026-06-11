// Reel tag vocabulary — the single source of truth shared by the reel-analyst
// (server: parses its "## Tags" section into slugs to store in analysis.tags) and
// the reel cards (client: renders the slugs as colored chips). Pure module: NO
// 'use client', NO React, NO server-only deps, so both sides can import it.
//
// A reel's analysis jsonb is { teardown, hadSpokenText, tags?: string[] } where
// tags are slugs from REEL_TAGS below. These ten are the ONLY allowed tags.

export const REEL_TAGS: Record<string, { label: string; color: string }> = {
  'strong-hook':       { label: 'Strong hook',       color: '#f59e0b' },
  'strong-cta':        { label: 'Strong CTA',        color: '#10b981' },
  'trend-riding':      { label: 'Trend-riding',      color: '#ec4899' },
  'high-retention':    { label: 'High retention',    color: '#3b82f6' },
  'emotional':         { label: 'Emotional',         color: '#ef4444' },
  'educational':       { label: 'Educational',       color: '#14b8a6' },
  'storytelling':      { label: 'Storytelling',      color: '#8b5cf6' },
  'controversial':     { label: 'Controversial',     color: '#f97316' },
  'pattern-interrupt': { label: 'Pattern interrupt', color: '#06b6d4' },
  'social-proof':      { label: 'Social proof',      color: '#6366f1' },
};

export const REEL_TAG_SLUGS: string[] = Object.keys(REEL_TAGS);

// Slugify one line/item from the analyst's Tags section: lowercase, trim, strip
// surrounding quotes + leading bullets/numbering, collapse whitespace to single
// hyphens, and drop any punctuation that isn't a word char or hyphen. The result
// is compared against REEL_TAGS keys, so e.g. "- Strong Hook" → "strong-hook".
function slugify(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/^[\s>*\-•+\d.)\]]+/, '') // leading bullets / numbering / blockquote
    .replace(/["'`“”‘’]/g, '')         // quotes
    .trim()
    .replace(/[^a-z0-9]+/g, '-')        // any run of non-alphanumerics → one hyphen
    .replace(/^-+|-+$/g, '');           // trim stray hyphens
}

/**
 * Extract the "## Tags" section from the analyst's teardown markdown and return
 * its valid REEL_TAG slugs (lowercased, slugified, deduped, capped at 4). Reads
 * the lines under a `## Tags` (or `# Tags` / `### Tags`) heading up to the next
 * heading; also splits comma/pipe-separated items on a single line. Unknown
 * tokens are dropped. Returns [] when there's no Tags section.
 */
export function parseReelTags(teardown: string): string[] {
  if (!teardown || typeof teardown !== 'string') return [];

  const lines = teardown.split(/\r?\n/);
  // Find the "## Tags" heading (any heading level, case-insensitive).
  const startIdx = lines.findIndex((l) => /^\s*#{1,6}\s*tags\s*$/i.test(l));
  if (startIdx === -1) return [];

  const found: string[] = [];
  const seen = new Set<string>();
  const consider = (token: string) => {
    const slug = slugify(token);
    if (slug && REEL_TAGS[slug] && !seen.has(slug)) {
      seen.add(slug);
      found.push(slug);
    }
  };

  for (let i = startIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    if (/^\s*#{1,6}\s/.test(line)) break; // next heading ends the section
    if (!line.trim()) continue;
    // Split a single line into items so "Strong hook, Educational | Emotional"
    // all register; bullet/numbering prefixes are stripped by slugify.
    for (const part of line.split(/[,|;]/)) {
      consider(part);
      if (found.length >= 4) break;
    }
    if (found.length >= 4) break;
  }

  return found.slice(0, 4);
}
