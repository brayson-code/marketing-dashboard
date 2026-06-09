// Flatten Claude's markdown into clean plaintext for channels that can't render
// it (iMessage/SMS via LoopMessage). Conservative on purpose: it removes
// markup, never content. Applied at the sendIMessage chokepoint so every caller
// (orchestrator, webhook, proactive, improve, fixer, alerts) is covered.
export function mdToPlainText(md: string): string {
  if (!md) return '';
  let s = md;

  // Fenced code blocks ```lang\n…\n``` → keep the inner text.
  s = s.replace(/```[a-zA-Z0-9]*\n?([\s\S]*?)```/g, '$1');
  // Inline code `x` → x
  s = s.replace(/`([^`]+)`/g, '$1');
  // Images ![alt](url) → alt
  s = s.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1');
  // Links [text](url) → text
  s = s.replace(/\[([^\]]+)\]\([^)]*\)/g, '$1');
  // Bold / italic (** __ * _) → inner text
  s = s.replace(/\*\*([^*]+)\*\*/g, '$1').replace(/__([^_]+)__/g, '$1');
  s = s.replace(/\*([^*]+)\*/g, '$1').replace(/(^|[^A-Za-z0-9])_([^_]+)_(?=$|[^A-Za-z0-9])/g, '$1$2');
  // Strikethrough ~~x~~ → x
  s = s.replace(/~~([^~]+)~~/g, '$1');
  // Headings (#, ##, …) → drop the markers
  s = s.replace(/^\s{0,3}#{1,6}\s+/gm, '');
  // Blockquotes "> " → drop the marker
  s = s.replace(/^\s{0,3}>\s?/gm, '');
  // Horizontal rules (---, ***, ___) → remove
  s = s.replace(/^\s{0,3}([-*_])\1{2,}\s*$/gm, '');
  // Bullets (-, *, +) → •  (ordered lists "1." stay; they read fine)
  s = s.replace(/^(\s*)[-*+]\s+/gm, '$1• ');
  // Collapse 3+ blank lines
  s = s.replace(/\n{3,}/g, '\n\n');

  return s.trim();
}
