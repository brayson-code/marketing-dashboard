import { getDecryptedSecret } from './integrations-store';

// HeyGen / Hyperframes access — per-tenant BYO key, same pattern as agentmail.ts
// / apify.ts / deepgram.ts. The tenant connects their own HeyGen API key on the
// Connections page (provider id 'hyperframes', stored encrypted in
// client_integrations); we read it here, falling back to the global env var for
// the HQ tenant + local dev. Each tenant therefore renders against their OWN
// HeyGen account and credits.

const HEYGEN_API_BASE = process.env.HEYGEN_API_URL?.trim() || 'https://api.heygen.com';

/** The current tenant's HeyGen API key, or null if neither tenant nor env has one. */
export async function getHeyGenKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('hyperframes');
    const tenantKey = secret?.api_key?.trim();
    if (tenantKey) return tenantKey;
  } catch {
    /* fall through to env */
  }
  return process.env.HEYGEN_API_KEY?.trim() || null;
}

export interface HeyGenValidation { ok: boolean; error?: string }

/**
 * Cheap auth check: hit a lightweight authenticated endpoint and read the status.
 * 200 → key is live; 401/403 → bad key. We deliberately don't fail on a 402
 * (no credits) — the key itself is valid, the account just needs a top-up, and
 * we'd rather let the tenant connect now and surface the credit issue at render.
 */
export async function validateHeyGenKey(key: string): Promise<HeyGenValidation> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Empty API key' };
  try {
    const res = await fetch(`${HEYGEN_API_BASE}/v2/avatars`, {
      headers: { 'x-api-key': trimmed },
    });
    if (res.ok || res.status === 402) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key (HeyGen rejected it)' };
    return { ok: false, error: `HeyGen returned HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: `Couldn’t reach HeyGen: ${(e as Error).message}` };
  }
}
