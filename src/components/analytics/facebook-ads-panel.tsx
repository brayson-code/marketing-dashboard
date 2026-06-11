'use client';

import { useEffect, useState } from 'react';
import { Facebook, Loader2 } from 'lucide-react';

// TODO: once a Nango integration with key 'facebook-ads' is wired and
// /api/integrations/facebook-ads/stats exists (returns spend / impressions /
// clicks / CTR / CPM / frequency / ROAS / video_view_25 / hold rate from
// /{ad_account_id}/insights), this panel will surface real numbers without
// changes to the component shape.

interface FBAdsStats {
  account_name?: string;
  start?: string;
  end?: string;
  spend?: number;
  impressions?: number;
  conversions?: number;
  avg_hold_rate_pct?: number;
  avg_ctr_pct?: number;
  cpm?: number;
  frequency?: number;
  roas?: number;
}

interface FBAdsResponse {
  connected: boolean;
  stats?: FBAdsStats;
  error?: string;
}

export function FacebookAdsPanel() {
  const [stats, setStats] = useState<FBAdsStats | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      try {
        // Endpoint may 404 today (route not built yet) — treat any failure as "not connected".
        const r = await fetch('/api/integrations/facebook-ads/stats', { cache: 'no-store' })
          .then((res) => (res.ok ? (res.json() as Promise<FBAdsResponse>) : null))
          .catch(() => null);
        if (cancel) return;
        setConnected(!!r?.connected);
        if (r?.error) setError(r.error);
        setStats(r?.stats ?? null);
      } finally {
        if (!cancel) setLoading(false);
      }
    };
    load();
    const t = setInterval(load, 5 * 60_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Facebook size={14} className="text-[#1877f2]" />
        <h3 className="section-title">Facebook Ads</h3>
        <span className="ml-auto text-micro text-muted-foreground">Last 30d</span>
      </div>
      <div className="panel-body space-y-3">
        {loading ? (
          <div className="py-6 flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading account…
          </div>
        ) : connected === false || !stats ? (
          <div className="py-6 text-center text-small space-y-1">
            <div>Facebook Ads not connected.</div>
            <div className="text-micro text-muted-foreground">
              Requires a Marketing API connection. Connect in <a href="/connections" className="underline">/connections</a> (coming soon).
            </div>
          </div>
        ) : error ? (
          <div className="py-6 text-center text-small text-destructive">{error}</div>
        ) : (
          <>
            {stats.account_name && (
              <div className="text-xs font-medium truncate">{stats.account_name}</div>
            )}
            {(stats.start || stats.end) && (
              <div className="text-micro text-muted-foreground">{stats.start} → {stats.end}</div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <Stat label="Avg Hold Rate" value={pct(stats.avg_hold_rate_pct)} caption="% of impressions that watched ≥25%" accent="var(--primary)" />
              <Stat label="Avg CTR" value={pct(stats.avg_ctr_pct)} caption="clicks ÷ impressions" />
              <Stat label="CPM" value={money(stats.cpm)} caption="cost per 1k impressions" />
              <Stat label="Frequency" value={num(stats.frequency, 2)} caption="avg times shown per person" />
              <Stat label="ROAS" value={num(stats.roas, 2) + 'x'} caption="revenue ÷ spend" accent="var(--success)" />
              <Stat label="Spend" value={money(stats.spend)} caption="last 30 days" />
              <Stat label="Conversions" value={fmt(stats.conversions ?? 0)} caption="purchases attributed" />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  caption,
  accent,
}: {
  label: string;
  value: string;
  caption?: string;
  accent?: string;
}) {
  return (
    <div className="rounded-lg p-2.5 bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] border border-border/40">
      <div className="text-micro text-muted-foreground">{label}</div>
      <div
        className="text-base font-semibold mt-0.5 tabular-nums"
        style={accent ? { color: accent } : undefined}
      >
        {value}
      </div>
      {caption && <div className="text-[10px] text-muted-foreground mt-0.5">{caption}</div>}
    </div>
  );
}

function fmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (Math.abs(n) >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}
function pct(n?: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return `${n.toFixed(2)}%`;
}
function money(n?: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return `$${fmt(n)}`;
}
function num(n: number | undefined, digits: number): string {
  if (typeof n !== 'number' || !isFinite(n)) return '—';
  return n.toFixed(digits);
}
