import { NextResponse } from 'next/server';
import type { Capability } from '@/lib/rbac';

// Authentication is enforced centrally by the Supabase session middleware
// (src/proxy.ts): any request that reaches an API route handler has already
// passed the auth check, and unauthenticated requests receive a 401 before the
// handler runs. These helpers therefore simply allow the request through.
//
// They intentionally do NOT import the legacy `@/lib/auth` (better-sqlite3 +
// hermes-session cookie), which 401s every Supabase-authenticated user and
// can't run on Vercel.
//
// RBAC is V1-simplified to "the authenticated owner has full access" (single
// tenant). When multi-tenant roles land, replace these with async checks that
// read the Supabase user + `tenant_members.role`.

export function requireApiUser(_request: Request): NextResponse | null {
  return null;
}

export function requireApiAdmin(_request: Request): NextResponse | null {
  return null;
}

export function requireApiEditor(_request: Request): NextResponse | null {
  return null;
}

export function requireApiCapability(_request: Request, _capability: Capability): NextResponse | null {
  return null;
}
