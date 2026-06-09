import { getDecryptedSecret } from './integrations-store';

// Per-tenant Anthropic (Claude) key — BYO model. Each tenant connects their own
// key on the Connections page (provider id 'anthropic'); agents run on THAT key,
// so the client bears their own Claude cost and their data stays under their
// account. Falls back to the platform env key for the HQ/owner tenant + local dev.
// Same pattern as getHeyGenKey / agentmail / apify / deepgram.

export async function getAnthropicKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('anthropic');
    const k = secret?.api_key?.trim();
    if (k) return k;
  } catch {
    /* fall through to env */
  }
  return process.env.ANTHROPIC_API_KEY?.trim() || null;
}

export interface KeyValidation { ok: boolean; error?: string }

// Cheap auth check: list models (no token spend). 200 → valid; 401 → bad key.
export async function validateAnthropicKey(key: string): Promise<KeyValidation> {
  const trimmed = key.trim();
  if (!trimmed) return { ok: false, error: 'Empty API key' };
  try {
    const res = await fetch('https://api.anthropic.com/v1/models?limit=1', {
      headers: { 'x-api-key': trimmed, 'anthropic-version': '2023-06-01' },
    });
    if (res.ok) return { ok: true };
    if (res.status === 401 || res.status === 403) return { ok: false, error: 'Invalid API key (Anthropic rejected it)' };
    return { ok: false, error: `Anthropic returned HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, error: `Couldn’t reach Anthropic: ${(e as Error).message}` };
  }
}
