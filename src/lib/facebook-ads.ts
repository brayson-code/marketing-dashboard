// Facebook Ads integration via Nango (provider 'facebook-ads' → Meta
// Marketing API, graph.facebook.com). Resolves the tenant's first active ad
// account, pulls last-30-day account-level insights, and a small top-campaigns
// breakdown — the read-only surface the /analytics Facebook Ads panel needs.
//
// Meta returns most numerics as STRINGS ("123.45") — everything is parsed to
// numbers here so the panel and any agent consumer can do math safely. Nango
// handles the OAuth token + refresh; failures bubble up as tagged Errors with
// Meta's own error message when the response body carries one.

import { getNango, providerConfigKeyFor } from './nango';
import { sql } from './db/client';
import { tenantId } from './tenant';

const PROVIDER = 'facebook-ads';
const GRAPH_VERSION = 'v23.0';

interface FBConn { connection_id: string; provider_config_key: string }

/** Look up this tenant's Facebook Ads connection. Null if not connected. */
async function getConn(): Promise<FBConn | null> {
  const rows = (await sql()`
    SELECT connection_id, provider_config_key
    FROM connections
    WHERE tenant_id = ${tenantId()} AND provider = ${PROVIDER} AND status = 'connected'
    LIMIT 1
  `) as unknown as Array<{ connection_id: string; provider_config_key: string }>;
  const r = rows[0];
  if (!r?.connection_id) return null;
  return { connection_id: r.connection_id, provider_config_key: r.provider_config_key || providerConfigKeyFor(PROVIDER) };
}

/** True if this tenant has a connected Facebook Ads — cheap check, no API call. */
export async function isConnected(): Promise<boolean> {
  return (await getConn()) !== null;
}

interface ProxyOpts {
  method?: 'GET' | 'POST';
  endpoint: string; // e.g. '/v23.0/me/adaccounts'
  params?: Record<string, string | number | undefined>;
  data?: unknown;
}

/** Call a Marketing API endpoint through the Nango proxy. Throws a tagged
 *  Error carrying Meta's error message when the body has one. */
async function fbProxy<T = unknown>(opts: ProxyOpts): Promise<T> {
  const nango = getNango();
  if (!nango) throw new Error('facebook-ads: NANGO_SECRET_KEY not configured');
  const conn = await getConn();
  if (!conn) throw new Error('facebook-ads: not connected for this tenant');

  const params: Record<string, string | number> = {};
  for (const [k, v] of Object.entries(opts.params ?? {})) if (v !== undefined && v !== null && v !== '') params[k] = v;

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const res: any = await nango.proxy({
      method: opts.method ?? 'GET',
      endpoint: opts.endpoint,
      providerConfigKey: conn.provider_config_key,
      connectionId: conn.connection_id,
      params: Object.keys(params).length ? params : undefined,
      data: opts.data,
    });
    return res?.data as T;
  } catch (e) {
    // Meta nests the useful message at response.data.error.message.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const err = (e as any)?.response?.data?.error;
    throw new Error(`facebook-ads: ${err?.message || (e as Error)?.message || 'request failed'}`);
  }
}

/** Meta returns numerics as strings — parse, undefined when absent/garbage. */
function num(v: unknown): number | undefined {
  if (typeof v === 'number' && isFinite(v)) return v;
  if (typeof v === 'string' && v !== '' && isFinite(Number(v))) return Number(v);
  return undefined;
}

// ── Ad account ──────────────────────────────────────────────────────────────

export interface FBAdAccount {
  id: string;       // 'act_<id>'
  name: string;
  currency: string | null;
}

/** The tenant's first ACTIVE ad account (account_status 1), falling back to
 *  the first account of any status. Null when the user has none. */
export async function getAdAccount(): Promise<FBAdAccount | null> {
  interface Resp { data?: Array<{ id?: string; name?: string; account_status?: number; currency?: string }> }
  const r = await fbProxy<Resp>({
    endpoint: `/${GRAPH_VERSION}/me/adaccounts`,
    params: { fields: 'id,name,account_status,currency', limit: 25 },
  });
  const accounts = r?.data ?? [];
  const acct = accounts.find((a) => a.account_status === 1) ?? accounts[0];
  if (!acct?.id) return null;
  return { id: acct.id, name: acct.name ?? acct.id, currency: acct.currency ?? null };
}

// ── Last-30-day insights (shape matches facebook-ads-panel.tsx exactly) ─────

export interface FBAdsStats {
  account_name?: string;
  start?: string;
  end?: string;
  spend?: number;
  impressions?: number;
  conversions?: number;
  avg_hold_rate_pct?: number;  // video_p25_watched ÷ impressions
  avg_ctr_pct?: number;
  cpm?: number;
  frequency?: number;
  roas?: number;
}

export interface FBTopCampaign {
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr_pct?: number;
}

interface FBAction { action_type?: string; value?: string | number }

interface InsightRow {
  date_start?: string;
  date_stop?: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  cpc?: string;
  cpm?: string;
  ctr?: string;
  frequency?: string;
  actions?: FBAction[];
  action_values?: FBAction[];
  purchase_roas?: FBAction[];
  video_p25_watched_actions?: FBAction[];
  campaign_name?: string;
}

/** Sum the values of an action list (e.g. video_p25_watched_actions). */
function sumActions(list: FBAction[] | undefined): number | undefined {
  if (!Array.isArray(list) || list.length === 0) return undefined;
  let total = 0;
  for (const a of list) total += num(a.value) ?? 0;
  return total;
}

/** First matching action value by priority — Meta reports purchases under
 *  several overlapping action_types, so picking one avoids double counting. */
function actionByPriority(list: FBAction[] | undefined, types: string[]): number | undefined {
  if (!Array.isArray(list)) return undefined;
  for (const t of types) {
    const hit = list.find((a) => a.action_type === t);
    const v = num(hit?.value);
    if (v !== undefined) return v;
  }
  return undefined;
}

const PURCHASE_TYPES = ['omni_purchase', 'purchase', 'offsite_conversion.fb_pixel_purchase', 'onsite_web_purchase'];

/** Account-level last-30-day stats for the given ad account, mapped to the
 *  panel's field names. Returns a minimal { account_name } when the account
 *  has no insight rows (connected, zero recent spend). */
export async function get30DayStats(account: FBAdAccount): Promise<FBAdsStats> {
  interface Resp { data?: InsightRow[] }
  const r = await fbProxy<Resp>({
    endpoint: `/${GRAPH_VERSION}/${account.id}/insights`,
    params: {
      date_preset: 'last_30d',
      fields: 'spend,impressions,clicks,cpc,cpm,ctr,frequency,actions,action_values,purchase_roas,video_p25_watched_actions',
    },
  });
  const row = r?.data?.[0];
  if (!row) return { account_name: account.name }; // connected, no spend in window

  const impressions = num(row.impressions);
  const spend = num(row.spend);
  const p25 = sumActions(row.video_p25_watched_actions);
  const conversions = actionByPriority(row.actions, PURCHASE_TYPES);
  // ROAS straight from Meta when reported; else derive purchase value ÷ spend.
  const roas =
    actionByPriority(row.purchase_roas, ['omni_purchase', 'purchase']) ??
    sumActions(row.purchase_roas) ??
    (() => {
      const value = actionByPriority(row.action_values, PURCHASE_TYPES);
      return value !== undefined && spend !== undefined && spend > 0 ? value / spend : undefined;
    })();

  const stats: FBAdsStats = {
    account_name: account.name,
    start: row.date_start,
    end: row.date_stop,
    spend: spend ?? 0,
    impressions: impressions ?? 0,
    conversions: conversions ?? 0,
  };
  if (num(row.ctr) !== undefined) stats.avg_ctr_pct = num(row.ctr); // Meta's ctr is already a percentage
  if (num(row.cpm) !== undefined) stats.cpm = num(row.cpm);
  if (num(row.frequency) !== undefined) stats.frequency = num(row.frequency);
  if (p25 !== undefined && impressions !== undefined && impressions > 0) {
    stats.avg_hold_rate_pct = (p25 / impressions) * 100;
  }
  if (roas !== undefined) stats.roas = roas;
  return stats;
}

/** Top campaigns by spend in the last 30 days — a small, sorted breakdown for
 *  agent consumers (the panel ignores extra fields). */
export async function getTopCampaigns(account: FBAdAccount, max = 5): Promise<FBTopCampaign[]> {
  interface Resp { data?: InsightRow[] }
  const r = await fbProxy<Resp>({
    endpoint: `/${GRAPH_VERSION}/${account.id}/insights`,
    params: {
      date_preset: 'last_30d',
      level: 'campaign',
      fields: 'campaign_name,spend,impressions,clicks,ctr',
      limit: 25,
    },
  });
  return (r?.data ?? [])
    .map((row) => ({
      name: row.campaign_name ?? '(unnamed campaign)',
      spend: num(row.spend) ?? 0,
      impressions: num(row.impressions) ?? 0,
      clicks: num(row.clicks) ?? 0,
      ctr_pct: num(row.ctr),
    }))
    .sort((a, b) => b.spend - a.spend)
    .slice(0, max);
}
