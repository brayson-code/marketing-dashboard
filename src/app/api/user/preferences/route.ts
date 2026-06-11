import { NextResponse } from 'next/server';
import { enterTenant, resolveTenant } from '@/lib/with-tenant';
import { sql, tenantId, jsonb } from '@/lib/db/client';
import { currentUserId } from '@/lib/tenant';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Per-USER UI preferences, stored on workspace_members.preferences (jsonb) for the
// current (tenant, user). Distinct per teammate. First consumer: the setup
// walkthrough — { walkthrough_disabled, celebrated }. Only a small allow-list of
// keys is accepted so the client can't stuff arbitrary data into the row.

const ALLOWED_KEYS = ['walkthrough_disabled', 'celebrated'] as const;
type PrefKey = (typeof ALLOWED_KEYS)[number];
type Prefs = Partial<Record<PrefKey, boolean>>;

function readPrefs(raw: unknown): Prefs {
  const src = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out: Prefs = {};
  for (const k of ALLOWED_KEYS) {
    if (typeof src[k] === 'boolean') out[k] = src[k] as boolean;
  }
  return out;
}

export async function GET() {
  enterTenant(await resolveTenant());
  const uid = currentUserId();
  if (!uid) return NextResponse.json({ preferences: {} });
  try {
    const rows = (await sql()`
      SELECT preferences FROM public.workspace_members
      WHERE workspace_id = ${tenantId()} AND user_id = ${uid}
    `) as unknown as Array<{ preferences: Record<string, unknown> | null }>;
    return NextResponse.json({ preferences: readPrefs(rows[0]?.preferences) });
  } catch (error) {
    console.error('[user/preferences GET]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  enterTenant(await resolveTenant());
  const uid = currentUserId();
  if (!uid) return NextResponse.json({ error: 'No authenticated user' }, { status: 401 });

  let body: unknown;
  try { body = await request.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }); }

  const patch = readPrefs(body);
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: `No valid keys. Allowed: ${ALLOWED_KEYS.join(', ')}` }, { status: 400 });
  }

  try {
    // Merge the patch into the existing jsonb (top-level key concat). UPDATE only —
    // a member row is created at invite/seed time; if there is none (e.g. the HQ
    // default tenant), this is a no-op and we just echo the patch back.
    const rows = (await sql()`
      UPDATE public.workspace_members
        SET preferences = COALESCE(preferences, '{}'::jsonb) || ${jsonb(patch)}
      WHERE workspace_id = ${tenantId()} AND user_id = ${uid}
      RETURNING preferences
    `) as unknown as Array<{ preferences: Record<string, unknown> | null }>;
    // No member row (e.g. the HQ default tenant) → nothing was persisted; say so
    // honestly instead of echoing the patch back as if it saved.
    if (rows.length === 0) {
      return NextResponse.json({ ok: true, persisted: false, preferences: patch });
    }
    return NextResponse.json({ ok: true, persisted: true, preferences: readPrefs(rows[0].preferences) });
  } catch (error) {
    console.error('[user/preferences PATCH]', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
