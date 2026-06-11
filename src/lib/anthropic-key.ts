import { getDecryptedSecret } from './integrations-store';
import { tenantId, DEFAULT_TENANT_ID } from './tenant';

// Per-tenant Anthropic (Claude) key — strict BYO model. Each client workspace
// connects their OWN key on the Connections page (provider id 'anthropic'); agents
// run on THAT key, so the client bears their own Claude cost and their data stays
// under their account. Same pattern as getHeyGenKey / agentmail / apify / deepgram.
//
// The platform env key (ANTHROPIC_API_KEY) is the fallback ONLY for the HQ/owner
// tenant and for local dev — NOT for client workspaces. Otherwise a client with no
// key connected would silently run agents on the platform's key + dime. A client
// without a connected key resolves to null here, and the callers surface
// "connect your Anthropic key" instead of running. Use getAnthropicKey() everywhere
// agents touch Claude (never read process.env.ANTHROPIC_API_KEY directly).

export async function getAnthropicKey(): Promise<string | null> {
  try {
    const secret = await getDecryptedSecret('anthropic');
    const k = secret?.api_key?.trim();
    if (k) return k;
  } catch {
    /* fall through to the platform-key rules below */
  }
  // Platform key fallback is gated to HQ + local dev. Client workspaces must BYO.
  const isHqOrDev = tenantId() === DEFAULT_TENANT_ID || process.env.NODE_ENV !== 'production';
  if (isHqOrDev) return process.env.ANTHROPIC_API_KEY?.trim() || null;
  return null;
}

/** True when the active workspace has Claude compute available (its own key, or
 *  the platform key for HQ/dev). Used to gate agent launches + drive the
 *  "connect your Anthropic key" setup step. */
export async function hasAnthropicKey(): Promise<boolean> {
  return (await getAnthropicKey()) !== null;
}

/** Thrown-message helper so every "no key" path reads the same in the UI. */
export const NO_ANTHROPIC_KEY_MESSAGE =
  'Connect your Anthropic API key to activate your agents (Connections → Anthropic).';

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
