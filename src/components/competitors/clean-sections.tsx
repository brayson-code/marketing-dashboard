'use client';

// Renders reel-analyst markdown (teardown OR the rolling pulse) as a clean
// breakdown: green section headers, tidy bullets, and NO raw markdown noise
// (** bold markers, code ticks, --- rules, hashtags). Shared by the "Why it won"
// popup and the Trend Radar so they read identically.

const HIDE_SECTION = /^(metrics used|pulse update|tags)\b/i;

export function cleanInline(s: string): string {
  return s
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/^\s*>\s?/, '')
    .replace(/(^|\s)#(\w)/g, '$1$2') // strip stray hashtags, keep the word
    .trim();
}

interface Section { title: string; lines: string[] }

function parseSections(md: string): Section[] {
  const sections: Section[] = [];
  let cur: Section | null = null;
  for (const raw of (md || '').split('\n')) {
    const line = raw.replace(/\r$/, '');
    const heading = line.match(/^#{1,4}\s+(.*)$/);
    if (heading) { cur = { title: cleanInline(heading[1]), lines: [] }; sections.push(cur); continue; }
    if (/^\s*-{3,}\s*$/.test(line)) continue; // horizontal rule
    if (cur) cur.lines.push(line);
    else { cur = { title: '', lines: [line] }; sections.push(cur); }
  }
  return sections
    .filter((s) => !HIDE_SECTION.test(s.title))
    .map((s) => ({ title: s.title, lines: s.lines.filter((l) => l.trim()) }))
    .filter((s) => s.title || s.lines.length);
}

export function CleanSections({ text }: { text: string }) {
  const sections = parseSections(text);
  if (sections.length === 0) {
    return <p className="text-small text-muted-foreground">Nothing to show yet.</p>;
  }
  return (
    <div className="space-y-3">
      {sections.map((s, i) => (
        <div key={i} className="space-y-1">
          {s.title && (
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--primary)]">{s.title}</div>
          )}
          <div className="space-y-1">
            {s.lines.map((line, j) => {
              const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
              if (bullet) {
                return (
                  <div key={j} className="flex gap-2 text-xs leading-relaxed text-foreground/90">
                    <span className="text-[var(--primary)] mt-0.5">•</span>
                    <span>{cleanInline(bullet[1])}</span>
                  </div>
                );
              }
              return <p key={j} className="text-xs leading-relaxed text-foreground/90">{cleanInline(line)}</p>;
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
