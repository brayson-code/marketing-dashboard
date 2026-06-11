import { sql } from '@/lib/db/client';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Validate a path-supplied tenant id for the per-tenant webhook routes. It must be
// a syntactically valid UUID (so the `= uuid` cast can't throw on garbage input)
// AND resolve to a real row in public.tenants. Runs as the postgres role
// (RLS-bypassing) so it works without a tenant context — we're establishing one.
export async function tenantExists(id: string): Promise<boolean> {
  if (typeof id !== 'string' || !UUID_RE.test(id)) return false;
  const rows = (await sql()`SELECT 1 FROM public.tenants WHERE id = ${id} LIMIT 1`) as unknown as unknown[];
  return rows.length > 0;
}
