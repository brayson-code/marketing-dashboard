// Shared formatting for reel/video scripts → a clean, readable teleprompter
// script. Generated scripts arrive in a few shapes:
//   (a) a clean "SPOKEN SCRIPT" block (HOOK / BODY / CTA) — our newer format,
//   (b) a Hyperframes storyboard: a "## Hook" section + a Scenes table (Time |
//       Visual | On-screen text | Audio | Clip) + a "## CTA" section,
//   (c) a plain labeled script ("Hook: …", "CTA: …").
//
// THE TELEPROMPTER MUST SHOW ONLY THE WORDS YOU SAY — nothing else. The one
// reliable signal for "what is spoken" across every generated format is the
// AUDIO field (a bullet `Audio:`, an `| ... | Audio | ... |` table column, or a
// key-value `| Audio | "…" |` row). We extract ONLY those. On-screen captions,
// visuals, timings, clip ids, director's notes, brand/placeholder tables, and
// any other production scaffolding are dropped — they are not read aloud.
// A trailing delivery remark on an audio line (e.g. "…" — fast, flat, dry) is
// kept separately as an optional `cue` so the reader knows the tone/cadence.

export const SECTION_LABELS = [
  'HOOK', 'HOOK LINE', 'COLD OPEN', 'OPEN', 'OPENING', 'INTRO',
  'SETUP', 'PROBLEM', 'PAIN', 'AGITATE', 'SOLUTION', 'BODY', 'MIDDLE',
  'VALUE', 'POINT', 'BEAT', 'STORY', 'PROOF', 'EXAMPLE', 'TURN', 'TWIST',
  'PAYOFF', 'CTA', 'CALL TO ACTION', 'OUTRO', 'CLOSE', 'CLOSING', 'END', 'SCENE',
];
const LABEL_SET = new Set(SECTION_LABELS);

export interface ScriptBlock { label: string | null; body: string; cue?: string }

function stripMarkdown(line: string): string {
  return line
    .replace(/\*\*([^*]+)\*\*/g, '$1')
    .replace(/\*([^*]+)\*/g, '$1')
    .replace(/__([^_]+)__/g, '$1')
    .replace(/(^|[\s(])_([^_]+)_(?=[\s).,!?]|$)/g, '$1$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/^\s*#{1,6}\s+/, '')
    .replace(/^\s*>\s?/, '')
    .replace(/^\s*[-*+]\s+/, '')
    .replace(/^\s*\d+[.)]\s+/, '')
    .replace(/[*_`]+/g, '') // drop any orphaned emphasis/code markers left behind
    .replace(/\s{2,}/g, ' ')
    .trim();
}

const dequote = (s: string) => s.replace(/^["'“”]+|["'“”]+$/g, '').trim();

// Strip the machine-readable hint tags ([broll: …], [stat: …]) the agent embeds.
const stripHints = (s: string) => s.replace(/\[[^\]]*\]/g, '').replace(/\s{2,}/g, ' ').trim();

const RULE_LINE = /^\s*([-=*_|:\s])+$/;
const TIMING_ONLY = /^\s*\(?\d{1,2}:\d{2}(\.\d)?\s*[–-]\s*\d{1,2}:\d{2}(\.\d)?\)?\s*$/;
// Bullet/field keys that are production scaffolding, never read aloud.
const SCAFFOLD_KEY = /^(on[- ]?screen text|on[- ]?screen|visual|visuals|clip|time|timing|b-?roll|shot|note|notes|platform|length|aspect|caption|infographic|stat)$/i;
// Field keys whose VALUE is the spoken line.
const SPOKEN_KEY = /^(audio|voiceover|vo|narration|spoken|spoken line|line|say|script)$/i;

function splitCells(row: string): string[] {
  return row.trim().replace(/^\|/, '').replace(/\|$/, '').split('|').map((c) => c.trim());
}

function normalizeLabel(s: string): string {
  return s.trim().toUpperCase().replace(/\s*\(.*\)\s*$/, '').replace(/[:.]+$/, '').replace(/\s+/g, ' ').trim();
}

// ── Path A: clean "SPOKEN SCRIPT" block (or a plain labeled script) ────────────
function parseSpokenBlock(raw: string): ScriptBlock[] {
  const all = raw.split('\n');
  const marker = all.findIndex((l) => /^\s*#{0,6}\s*spoken script\s*:?\s*$/i.test(l.trim()));
  const start = marker >= 0 ? marker + 1 : 0;
  const blocks: ScriptBlock[] = [];
  let cur: ScriptBlock | null = null;
  for (let i = start; i < all.length; i++) {
    const line = all[i];
    // Stop if the storyboard begins after the spoken block.
    if (/^\s*\|/.test(line) || /^\s*#{1,6}\s*(scenes?|storyboard|platform)\b/i.test(line)) break;
    if (RULE_LINE.test(line) || TIMING_ONLY.test(line)) continue;
    const clean = stripHints(stripMarkdown(line));
    if (!clean) continue;
    const lab = normalizeLabel(clean);
    if (LABEL_SET.has(lab) || /^(HOOK|CTA|BODY|OUTRO)\b/.test(lab)) {
      if (cur) blocks.push(cur);
      cur = { label: lab, body: '' };
    } else if (cur) {
      cur.body += (cur.body ? '\n' : '') + clean;
    } else {
      cur = { label: null, body: clean };
    }
  }
  if (cur) blocks.push(cur);
  return blocks.map((b) => ({ label: b.label, body: b.body.trim() })).filter((b) => b.label || b.body);
}

// A spoken line, plus any trailing delivery/tone remark found after it.
interface Spoken { say: string; cue: string | null }

// Turn one raw Audio value (a bullet value, or a table cell) into the words to
// say + an optional delivery cue. The spoken words are the quoted segment if the
// line is quoted (so a trailing "— fast, dry" note splits off as the cue); else
// the whole cleaned value is spoken. Markdown, [broll:…]/[stat:…] hints, and
// wrapping quotes are stripped.
function toSpoken(rawValue: string): Spoken | null {
  const s = stripHints(stripMarkdown(rawValue)).trim();
  if (!s) return null;
  const q = /[“"]([^”"]{2,}?)[”"]/.exec(s);
  if (q) {
    const say = q[1].trim();
    const after = s.slice(q.index + q[0].length).replace(/^[\s—–\-:.,;()]+/, '').trim();
    return { say, cue: after.length >= 4 ? after : null };
  }
  return { say: dequote(s), cue: null };
}

const AUDIO_COL = /\b(audio|spoken|voiceover|vo|narration|script|say)\b/i;
const COLUMN_HEADER = /\b(time|visual|on[- ]?screen|caption|clip|element|direction|slot|placeholder|infographic|b-?roll|shot|note)\b/i;

// ── Path B: storyboard → ONLY the spoken words, grouped HOOK / BODY / CTA.
// We take the AUDIO value from every shape it appears in (bullet field, scenes-
// table column, key-value table row) and DROP everything else. Each scene's
// audio becomes its own readable line. ───────────────────────────────────────
function parseStoryboard(raw: string): ScriptBlock[] {
  const lines = raw.split('\n');
  const beats = {
    hook: [] as Spoken[], body: [] as Spoken[], cta: [] as Spoken[],
  };
  let beat: 'hook' | 'body' | 'cta' = 'body';
  let sawHook = false;
  const add = (rawValue: string) => { const sp = toSpoken(rawValue); if (sp && sp.say) beats[beat].push(sp); };

  // Per-table state: the first non-separator pipe row is the header (skipped);
  // from it we learn which column (if any, 3+ col tables) holds the audio.
  let inTable = false;
  let headerSeen = false;
  let audioCol = -1;

  for (const line of lines) {
    const t = line.trim();

    if (!/^\|/.test(t)) {
      // Leaving any table.
      inTable = false; headerSeen = false; audioCol = -1;

      if (!t || RULE_LINE.test(t) || TIMING_ONLY.test(t)) continue;

      // Heading → switch beat.
      const h = /^#{1,6}\s+(.+?)\s*#*$/.exec(t);
      if (h) {
        const lab = normalizeLabel(h[1]);
        if (/^(HOOK|COLD OPEN|OPEN|OPENING|INTRO|TEASE)\b/.test(lab)) { beat = 'hook'; sawHook = true; }
        else if (/^(CTA|CALL TO ACTION|OUTRO|CLOSE|CLOSING|END)\b/.test(lab)) { beat = 'cta'; }
        else beat = 'body';
        continue;
      }

      // Bullet / field line "Key: value" — only an Audio-type key is spoken.
      const f = /^-?\s*\**\s*([A-Za-z][A-Za-z' \-/]{1,24}?)\s*\**\s*:\s*\**\s*(.*)$/.exec(t);
      if (f) {
        const key = f[1].trim();
        const lab = normalizeLabel(key);
        if (/^(HOOK|COLD OPEN|OPEN|INTRO)\b/.test(lab)) { beat = 'hook'; sawHook = true; }
        else if (/^(CTA|CALL TO ACTION|OUTRO|CLOSE|END)\b/.test(lab)) { beat = 'cta'; }
        if (SPOKEN_KEY.test(key)) add(f[2]);
        continue;
      }
      // Any other prose (preamble, director's notes, visual direction) → dropped.
      continue;
    }

    // ── Table row ──
    inTable = true;
    const cells = splitCells(line);
    if (cells.some((c) => /^:?-{2,}:?$/.test(c))) continue;        // separator

    if (!headerSeen) {
      // First row of the table is its header. For wide (3+ col) tables, find the
      // audio column. (2-col tables are key→value; handled per data row below.)
      headerSeen = true;
      audioCol = cells.length >= 3 ? cells.findIndex((c) => AUDIO_COL.test(c)) : -1;
      // If the very first row isn't actually a header (no column-name words) and
      // it's a key-value pair, fall through and treat it as data too.
      const looksHeader = cells.some((c) => AUDIO_COL.test(c) || COLUMN_HEADER.test(c));
      if (looksHeader || cells.length >= 3) continue;
    }

    if (cells.length === 2) {
      // Key-value row: "| Audio | "…" |". Speak it only if the key is an Audio key.
      const key = stripMarkdown(cells[0]).replace(/[:*]/g, '').trim();
      if (SPOKEN_KEY.test(key)) add(cells[1]);
      continue;
    }
    if (audioCol >= 0 && cells[audioCol] != null) add(cells[audioCol]);
  }

  // No explicit hook? Promote the first scene to the hook so there's an opener.
  if (!sawHook && !beats.hook.length && beats.body.length) beats.hook.push(beats.body.shift() as Spoken);

  return assemble(beats);
}

// De-dupe spoken lines (case-insensitive) and roll each beat into one block,
// one scene per line, carrying any delivery cues.
function assemble(beats: { hook: Spoken[]; body: Spoken[]; cta: Spoken[] }): ScriptBlock[] {
  const seen = new Set<string>();
  const clean = (arr: Spoken[]) => {
    const out: Spoken[] = [];
    for (const sp of arr) {
      const k = sp.say.toLowerCase().replace(/\s+/g, ' ').trim();
      if (k && !seen.has(k)) { seen.add(k); out.push(sp); }
    }
    return out;
  };
  const block = (label: string, arr: Spoken[]): ScriptBlock | null => {
    const items = clean(arr);
    if (!items.length) return null;
    const cues = items.map((i) => i.cue).filter((c): c is string => !!c);
    return {
      label,
      body: items.map((i) => i.say).join('\n'),
      cue: cues.length ? Array.from(new Set(cues)).join(' · ') : undefined,
    };
  };
  return [block('HOOK', beats.hook), block('BODY', beats.body), block('CTA', beats.cta)]
    .filter((b): b is ScriptBlock => !!b);
}

/** Parse a raw script into ordered, readable beats for the teleprompter.
 *  Audio-only storyboard extraction is the default; the lenient beat-parser is
 *  the fallback for a plain "SPOKEN SCRIPT" / labeled script with no Audio rows. */
export function parseScript(raw: string): ScriptBlock[] {
  const text = (raw || '').replace(/\r\n/g, '\n');
  if (/^\s*#{0,6}\s*spoken script\s*:?\s*$/im.test(text)) return parseSpokenBlock(text);
  const sb = parseStoryboard(text);
  if (sb.length) return sb;
  return parseSpokenBlock(text);
}

/** A flat, markdown-free, preamble-free version of the script — spoken words
 *  only, with delivery cues noted in parentheses under each beat label. */
export function toPlainScript(raw: string): string {
  return parseScript(raw)
    .map((b) => {
      const head = b.label ? (b.cue ? `${b.label}  (${b.cue})` : b.label) : '';
      return head ? `${head}\n${b.body}` : b.body;
    })
    .join('\n\n')
    .trim();
}
