'use client';

// Command Center views — Settings panel that controls which sections THIS
// workspace sees in the left nav rail.
//
// CONTRACT (shared with /api/command-center/views + the nav rail):
//   The "enabled-views" map is a JSON object keyed by the nav item href
//   (e.g. { "/boardroom": false, "/roi": true }). A MISSING key = ENABLED, so
//   new views and existing clients default all-on. A view is shown only if
//   map[href] !== false. This map is SUBTRACTIVE ONLY — it can hide a view but
//   the existing HQ-only + per-flag + plan gating still apply on top (a client
//   can never reveal /issues or /security via this map). The HQ workspace
//   ignores the map entirely.
//
//   GET  /api/command-center/views        → { enabled: Record<href, boolean> }
//   PATCH /api/command-center/views { enabled: { [href]: next } }  // merge one toggle
//   PATCH /api/command-center/views { preset }                     // Full|Lite|Content|Sales
//
// The catalog below is the single source for the Settings panel's rows +
// defaults. It mirrors the canonical view catalog (Overview "/" and Settings
// are NOT toggleable — they are always on so a client can never lock itself
// out). HQ-only /issues + /security are not toggleable and not listed here.
//
// Owner / member / VA may all use this panel.

import { useEffect, useState, useCallback } from 'react';
import { LayoutGrid, RotateCcw, Info } from 'lucide-react';
import { toast } from '@/components/ui/toast';
// Shared, PURE catalog — same source the server lib + validation use, so the panel can
// never render a row the server rejects (no drift). Safe in the client bundle (no `sql`).
import { VIEW_SECTIONS, isViewOn, notifyCommandCenterViewsChanged } from '@/lib/command-center-catalog';

type Preset = 'full' | 'lite' | 'content' | 'sales';

const PRESETS: { key: Preset; label: string; hint: string }[] = [
  { key: 'full', label: 'Full', hint: 'Everything on' },
  { key: 'lite', label: 'Lite', hint: 'Core essentials only' },
  { key: 'content', label: 'Content', hint: 'Creative + content focus' },
  { key: 'sales', label: 'Sales', hint: 'Revenue + outreach focus' },
];

export function CommandCenterViews() {
  const [enabled, setEnabled] = useState<Record<string, boolean> | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null); // href or preset key in flight
  // The HQ workspace ignores this map entirely (NavRail shows everything regardless —
  // see nav-rail.tsx's `viewEnabled`), so toggling here persists but never visibly
  // changes HQ's own nav. Without this banner that reads as "nothing happens."
  const [isHq, setIsHq] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me').then((r) => (r.ok ? r.json() : null)).then((j) => {
      setIsHq(!!j?.is_hq);
    }).catch(() => {});
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/command-center/views', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load views');
      setEnabled(data.enabled && typeof data.enabled === 'object' ? data.enabled : {});
    } catch (err) {
      toast.error((err as Error).message);
      setEnabled({});
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function toggle(href: string) {
    if (!enabled) return;
    const next = !isViewOn(enabled, href);
    const prev = enabled;
    // Optimistic update.
    setEnabled({ ...enabled, [href]: next });
    setBusy(href);
    try {
      const res = await fetch('/api/command-center/views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: { [href]: next } }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update view');
      // Reconcile with the server's authoritative map.
      if (data.enabled && typeof data.enabled === 'object') setEnabled(data.enabled);
      // Tell the (already-mounted, root-level) NavRail to re-fetch so the toggle is
      // visible immediately instead of only after a hard reload.
      notifyCommandCenterViewsChanged();
    } catch (err) {
      toast.error((err as Error).message);
      setEnabled(prev); // rollback
    } finally {
      setBusy(null);
    }
  }

  async function applyPreset(preset: Preset) {
    setBusy(preset);
    try {
      const res = await fetch('/api/command-center/views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preset }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply preset');
      if (data.enabled && typeof data.enabled === 'object') setEnabled(data.enabled);
      else await load();
      notifyCommandCenterViewsChanged();
      toast.success(`Applied "${preset}" layout`);
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="panel p-5 space-y-4">
      <h2 className="text-sm font-medium flex items-center gap-2">
        <LayoutGrid size={14} className="text-primary" /> Command Center
      </h2>
      <p className="text-xs text-muted-foreground">
        Choose which sections <strong>this workspace</strong> sees in the left
        navigation. Turning a section off hides it from the nav for everyone in
        this workspace — it doesn&apos;t delete anything, and you can switch it
        back on anytime. Overview and Settings are always on. Some views may
        still be hidden by your plan.
      </p>

      {isHq && (
        <div className="flex items-start gap-2 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-muted-foreground">
          <Info size={14} className="text-warning shrink-0 mt-0.5" />
          <span>
            You&apos;re on the HQ workspace — the operator nav always shows every
            section regardless of this map, so toggles and presets below will save
            but <strong>won&apos;t change your own nav</strong>. This panel is meant
            for configuring client workspaces.
          </span>
        </div>
      )}

      {/* Presets */}
      <div className="space-y-1.5">
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground flex items-center gap-1.5">
          <RotateCcw size={11} /> Quick presets
        </div>
        <div className="flex flex-wrap gap-2">
          {PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              disabled={loading || busy !== null}
              onClick={() => applyPreset(p.key)}
              title={p.hint}
              className={[
                'rounded-lg px-3 py-2 text-sm border transition-colors',
                'bg-muted/20 border-border text-muted-foreground',
                'hover:text-foreground hover:bg-muted/40',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              ].join(' ')}
              style={{ transition: 'background-color var(--t-press, 120ms) var(--ease-out, ease-out)' }}
            >
              {busy === p.key ? 'Applying…' : p.label}
            </button>
          ))}
        </div>
      </div>

      {loading || !enabled ? (
        <div className="text-sm text-muted-foreground">Loading…</div>
      ) : (
        <div className="space-y-4">
          {VIEW_SECTIONS.map((section) => (
            <div key={section.section} className="rounded-lg border border-border/40 p-4 space-y-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {section.section}
              </div>
              <div className="space-y-1">
                {section.items.map((item) => {
                  const on = isViewOn(enabled, item.href);
                  const rowBusy = busy === item.href;
                  return (
                    <label
                      key={item.href}
                      className="flex items-center justify-between gap-3 py-1.5 cursor-pointer select-none"
                    >
                      <span className="text-sm flex items-center gap-2 min-w-0">
                        <span className="truncate">{item.label}</span>
                        <code className="text-[10px] text-muted-foreground/70 truncate">
                          {item.href}
                        </code>
                      </span>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={on}
                        aria-label={`${on ? 'Hide' : 'Show'} ${item.label}`}
                        disabled={rowBusy}
                        onClick={() => toggle(item.href)}
                        className={[
                          'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent',
                          'transition-colors disabled:opacity-50 disabled:cursor-not-allowed',
                          on ? 'bg-primary' : 'bg-muted',
                        ].join(' ')}
                        style={{ transition: 'background-color var(--t-press, 120ms) var(--ease-out, ease-out)' }}
                      >
                        <span
                          className="pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow"
                          style={{
                            transform: on ? 'translateX(16px)' : 'translateX(0)',
                            transition: 'transform var(--t-press, 120ms) var(--ease-out, ease-out)',
                          }}
                        />
                      </button>
                    </label>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
