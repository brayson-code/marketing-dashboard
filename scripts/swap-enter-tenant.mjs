// Swap the tenant-resolution call shape so enterWith() runs in the handler's own
// frame (see src/lib/with-tenant.ts). Converts:
//   import { resolveTenant } from '@/lib/with-tenant';  ->  import { enterTenant, resolveTenant } ...
//   await resolveTenant();                              ->  enterTenant(await resolveTenant());
// Idempotent: files already using enterTenant(await resolveTenant()) are skipped.
//
// Run: node scripts/swap-enter-tenant.mjs

import fs from 'node:fs';
import path from 'node:path';

const API_DIR = path.join(process.cwd(), 'src', 'app', 'api');
const OLD_IMPORT = `import { resolveTenant } from '@/lib/with-tenant';`;
const NEW_IMPORT = `import { enterTenant, resolveTenant } from '@/lib/with-tenant';`;
const OLD_CALL = `await resolveTenant();`;
const NEW_CALL = `enterTenant(await resolveTenant());`;

function walk(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(full));
    else if (e.name === 'route.ts') out.push(full);
  }
  return out;
}

const changed = [];
for (const file of walk(API_DIR)) {
  let src = fs.readFileSync(file, 'utf8');
  if (!src.includes(OLD_CALL)) continue;            // nothing to do / denylisted
  if (src.includes(NEW_CALL)) continue;             // already swapped
  const before = src;
  if (src.includes(OLD_IMPORT)) src = src.replaceAll(OLD_IMPORT, NEW_IMPORT);
  src = src.replaceAll(OLD_CALL, NEW_CALL);
  if (src !== before) { fs.writeFileSync(file, src, 'utf8'); changed.push(path.relative(API_DIR, file)); }
}

console.log(`SWAPPED ${changed.length} file(s):`);
changed.forEach((c) => console.log('  ~ ' + c));
