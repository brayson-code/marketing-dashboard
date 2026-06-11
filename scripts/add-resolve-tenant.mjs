// One-shot codemod: ensure every API route handler resolves the request's tenant.
//
// Inserts `await resolveTenant();` as the first statement of each exported
// GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS handler under src/app/api, and prepends
// the import. Idempotent at the file level: any file that already mentions
// `resolveTenant` is left untouched. A denylist skips system/no-user routes
// (cron runners + external webhooks) that intentionally run as the system tenant.
//
// Run: node scripts/add-resolve-tenant.mjs

import fs from 'node:fs';
import path from 'node:path';

const API_DIR = path.join(process.cwd(), 'src', 'app', 'api');

// System/no-user routes: hit by Vercel cron (CRON_SECRET) or external webhooks,
// no Supabase session — they resolve tenancy internally / run as the default tenant.
const DENY = new Set([
  'cron/dispatch/route.ts',
  'cron/proactive/route.ts',
  'cron/improve/route.ts',
  'cron/compact/route.ts',
  'cron/triage/route.ts',
  'cron/advance/route.ts',
  'webhook/loopmessage/route.ts',
  'webhook/telegram/route.ts',
].map((p) => p.replace(/\//g, path.sep)));

const IMPORT_LINE = `import { resolveTenant } from '@/lib/with-tenant';\n`;
const HANDLER_RE = /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s*\(/g;

function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name === 'route.ts') out.push(full);
  }
  return out;
}

const files = walk(API_DIR);
const changed = [];
const skipped = [];
const flagged = [];

for (const file of files) {
  const rel = path.relative(API_DIR, file);
  if (DENY.has(rel)) { skipped.push(`${rel} (denylist)`); continue; }

  let src = fs.readFileSync(file, 'utf8');
  if (src.includes('resolveTenant')) { skipped.push(`${rel} (already wrapped)`); continue; }

  // Collect insertion points (offset just after each handler's opening brace).
  const inserts = [];
  let m;
  HANDLER_RE.lastIndex = 0;
  let bad = false;
  while ((m = HANDLER_RE.exec(src)) !== null) {
    // Scan from just after the '(' to find the matching ')'.
    let i = m.index + m[0].length;
    let depth = 1;
    while (i < src.length && depth > 0) {
      const c = src[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    // i is now just past the param-list ')'. Find the body '{'.
    const between = src.slice(i);
    const braceRel = between.indexOf('{');
    if (braceRel === -1) { bad = true; break; }
    // Guard: a return-type annotation (a ':' before the brace) means our simple
    // brace-find could be wrong — flag for manual handling instead of guessing.
    if (between.slice(0, braceRel).includes(':')) { bad = true; break; }
    inserts.push(i + braceRel + 1);
  }
  if (bad || inserts.length === 0) {
    flagged.push(`${rel} (no clean handler match — handle manually)`);
    continue;
  }

  // Apply inserts from the end so earlier offsets stay valid.
  for (let k = inserts.length - 1; k >= 0; k--) {
    const at = inserts[k];
    src = src.slice(0, at) + '\n  await resolveTenant();' + src.slice(at);
  }
  // Prepend the import.
  src = IMPORT_LINE + src;

  fs.writeFileSync(file, src, 'utf8');
  changed.push(`${rel} (${inserts.length} handler${inserts.length > 1 ? 's' : ''})`);
}

console.log(`\nCHANGED (${changed.length}):`);
changed.forEach((c) => console.log('  + ' + c));
console.log(`\nSKIPPED (${skipped.length}):`);
skipped.forEach((s) => console.log('  - ' + s));
if (flagged.length) {
  console.log(`\nFLAGGED FOR MANUAL REVIEW (${flagged.length}):`);
  flagged.forEach((f) => console.log('  ! ' + f));
}
