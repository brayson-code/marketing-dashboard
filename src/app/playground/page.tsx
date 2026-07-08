'use client';

// Command Center Builder ("playground") — an OPTIONAL onboarding surface where a VA /
// operator composes THIS workspace's left-nav and sees a LIVE preview of the result
// BEFORE applying it. Two panes:
//   LEFT  — grouped on/off switches (from the PURE VIEW_SECTIONS catalog) + preset
//           buttons. Edits are LOCAL (a working copy of the enabled map) and do NOT
//           persist until "Apply to workspace". "Reset" reverts to the last-applied map.
//   RIGHT — a read-only mock of the client's nav rail rendered FROM the working map,
//           updating instantly as switches/presets change (no save needed to preview).
//
// CONTRACT (shared with /api/command-center/views + the real NavRail):
//   The enabled-views map is keyed by nav href (e.g. { "/roi": false }). A MISSING key =
//   ENABLED (all-on default). A view shows only if map[href] !== false. The map is
//   SUBTRACTIVE ONLY — Overview "/" and Settings are always on, and the real nav still
//   stacks HQ-only / per-flag / plan gating on top, so this builder can only HIDE the
//   workspace's own views, never reveal something it otherwise can't see.
//
//   GET   /api/command-center/views        → { views, enabled, presets }
//   PATCH /api/command-center/views { enabled }  // we send the FULL working map on Apply
//
// This page is itself flag-gated: the nav item only shows when PLAYGROUND_ENABLED is on.
// We re-check playground_enabled here from /api/auth/me as defense-in-depth (the nav
// already hides the entry; a hand-typed /playground URL still lands on the disabled
// notice). Any workspace member — including a VA — may build the Command Center.

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Blocks, RotateCcw, Check, Gauge, Settings as SettingsIcon, Lock,
} from 'lucide-react';
import { toast } from '@/components/ui/toast';
// Shared, PURE catalog — the same single source the server lib + validation + the
// Settings panel use, so this builder can never render a row the server rejects, and the
// LOCAL preset preview can never drift from what the server would persist.
import {
  VIEW_SECTIONS,
  PRESETS as CATALOG_PRESETS,
  isViewOn,
  notifyCommandCenterViewsChanged,
  type EnabledViews,
} from '@/lib/command-center-catalog';

type Preset = 'full' | 'lite' | 'content' | 'sales';

const PRESETS: { key: Preset; label: string; hint: string }[] = [
  { key: 'full', label: 'Full', hint: 'Everything on' },
  { key: 'lite', label: 'Lite', hint: 'Core essentials only' },
  { key: 'content', label: 'Content', hint: 'Creative + content focus' },
  { key: 'sales', label: 'Sales', hint: 'Revenue + outreach focus' },
];

// Shallow compare of two enabled maps over the toggleable hrefs only (missing key == on,
// so we normalize via isViewOn). Used to know whether the working copy diverges from the
// last-applied/server map (drives the dirty state on Apply / Reset).
function mapsEqual(a: EnabledViews, b: EnabledViews): boolean {
  for (const section of VIEW_SECTIONS) {
    for (const item of section.items) {
      if (isViewOn(a, item.href) !== isViewOn(b, item.href)) return false;
    }
  }
  return true;
}

export default function PlaygroundPage() {
  // Flag gate (defense-in-depth). null = still resolving /api/auth/me.
  const [flagEnabled, setFlagEnabled] = useState<boolean | null>(null);
  // The last map the server confirmed (the "applied" baseline). Reset reverts to this.
  const [serverMap, setServerMap] = useState<EnabledViews | null>(null);
  // The in-progress WORKING copy that drives both the switches and the live preview.
  // Local until the user clicks Apply.
  const [working, setWorking] = useState<EnabledViews>({});
  const [loading, setLoading] = useState(true);
  const [applying, setApplying] = useState(false);

  // Resolve the flag first so a hand-typed /playground hit on a workspace without the
  // flag lands on the disabled notice rather than the builder.
  useEffect(() => {
    fetch('/api/auth/me', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => setFlagEnabled(!!j?.playground_enabled))
      .catch(() => setFlagEnabled(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/command-center/views', { cache: 'no-store' });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to load views');
      const map: EnabledViews =
        data.enabled && typeof data.enabled === 'object' ? data.enabled : {};
      setServerMap(map);
      setWorking(map);
    } catch (err) {
      toast.error((err as Error).message);
      setServerMap({});
      setWorking({});
    } finally {
      setLoading(false);
    }
  }, []);

  // Only load the views once we know the builder is enabled.
  useEffect(() => {
    if (flagEnabled) void load();
  }, [flagEnabled, load]);

  const dirty = useMemo(
    () => (serverMap ? !mapsEqual(working, serverMap) : false),
    [working, serverMap],
  );

  // LOCAL toggle — flips a single href in the working copy. Does NOT hit the network.
  function toggle(href: string) {
    setWorking((prev) => ({ ...prev, [href]: !isViewOn(prev, href) }));
  }

  // LOCAL preset — build a complete working map: start all-on, then apply the preset's
  // OFFs straight from the PURE catalog (so the preview can't drift from what the server
  // persists). Mirrors the server's preset semantics (a preset is a complete map). Does
  // NOT persist until Apply.
  function applyPresetLocal(key: Preset) {
    const next: EnabledViews = {};
    for (const section of VIEW_SECTIONS) {
      for (const item of section.items) next[item.href] = true;
    }
    // CATALOG_PRESETS[key] is a sparse map of just the OFFs (missing key = on).
    for (const [href, on] of Object.entries(CATALOG_PRESETS[key] ?? {})) {
      next[href] = Boolean(on);
    }
    setWorking(next);
  }

  function resetLocal() {
    if (serverMap) setWorking(serverMap);
  }

  // APPLY — persist the full working map in one PATCH (we send every toggleable href so
  // the saved map is complete and unambiguous, not a partial patch).
  async function apply() {
    setApplying(true);
    try {
      const full: EnabledViews = {};
      for (const section of VIEW_SECTIONS) {
        for (const item of section.items) full[item.href] = isViewOn(working, item.href);
      }
      const res = await fetch('/api/command-center/views', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: full }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to apply');
      const saved: EnabledViews =
        data.enabled && typeof data.enabled === 'object' ? data.enabled : full;
      setServerMap(saved);
      setWorking(saved);
      // Tell the (already-mounted, root-level) NavRail to re-fetch so the applied
      // layout is visible immediately instead of only after a hard reload.
      notifyCommandCenterViewsChanged();
      toast.success('Command Center updated for this workspace');
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setApplying(false);
    }
  }

  // ── flag gate (defense-in-depth) ────────────────────────────────────────────
  if (flagEnabled === null) {
    return (
      <div className="p-6 text-sm text-muted-foreground">Loading…</div>
    );
  }
  if (!flagEnabled) {
    return (
      <div className="p-6 max-w-xl">
        <div className="panel p-6 flex items-start gap-3">
          <Lock size={18} className="text-muted-foreground mt-0.5 shrink-0" />
          <div>
            <h1 className="text-sm font-medium">Command Center Builder</h1>
            <p className="text-xs text-muted-foreground mt-1">
              This optional builder isn&apos;t enabled for your workspace.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold flex items-center gap-2">
          <Blocks size={18} className="text-primary" /> Command Center Builder
        </h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Build what your client sees — toggle sections, watch the preview, then apply.
          Overview and Settings are always on; some views may still be hidden by the plan.
        </p>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_minmax(260px,340px)] items-start">
        {/* ── LEFT: controls ───────────────────────────────────────────────── */}
        <div className="panel p-5 space-y-4">
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
                  disabled={loading}
                  onClick={() => applyPresetLocal(p.key)}
                  title={p.hint}
                  className={[
                    'rounded-lg px-3 py-2 text-sm border',
                    'bg-muted/20 border-border text-muted-foreground',
                    'hover:text-foreground hover:bg-muted/40',
                    'disabled:opacity-40 disabled:cursor-not-allowed',
                  ].join(' ')}
                  style={{ transition: 'background-color var(--t-press, 120ms) var(--ease-out, ease-out), color var(--t-press, 120ms) var(--ease-out, ease-out)' }}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground/80">
              Presets and toggles are a working draft — nothing changes for the client
              until you click <strong>Apply to workspace</strong>.
            </p>
          </div>

          {loading || !serverMap ? (
            <div className="text-sm text-muted-foreground">Loading…</div>
          ) : (
            <div className="space-y-4">
              {VIEW_SECTIONS.map((section) => (
                <div
                  key={section.section}
                  className="rounded-lg border border-border/40 p-4 space-y-2"
                >
                  <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {section.section}
                  </div>
                  <div className="space-y-1">
                    {section.items.map((item) => {
                      const on = isViewOn(working, item.href);
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
                            onClick={() => toggle(item.href)}
                            className={[
                              'relative inline-flex h-5 w-9 shrink-0 rounded-full border-2 border-transparent',
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

          {/* Apply / Reset */}
          <div className="flex items-center gap-2 pt-2 border-t border-border/40">
            <button
              type="button"
              disabled={loading || applying || !dirty}
              onClick={apply}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-medium border',
                'bg-primary text-primary-foreground border-transparent',
                'hover:opacity-90 active:scale-[0.98]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
              ].join(' ')}
              style={{ transition: 'opacity var(--t-press, 120ms) var(--ease-out, ease-out), transform var(--t-press, 120ms) var(--ease-out, ease-out)' }}
            >
              <Check size={14} /> {applying ? 'Applying…' : 'Apply to workspace'}
            </button>
            <button
              type="button"
              disabled={loading || applying || !dirty}
              onClick={resetLocal}
              className={[
                'inline-flex items-center gap-2 rounded-lg px-4 py-2 text-sm border',
                'bg-muted/20 border-border text-muted-foreground',
                'hover:text-foreground hover:bg-muted/40 active:scale-[0.98]',
                'disabled:opacity-40 disabled:cursor-not-allowed disabled:active:scale-100',
              ].join(' ')}
              style={{ transition: 'background-color var(--t-press, 120ms) var(--ease-out, ease-out), transform var(--t-press, 120ms) var(--ease-out, ease-out)' }}
            >
              <RotateCcw size={14} /> Reset
            </button>
            <span className="text-[11px] text-muted-foreground ml-1">
              {dirty ? 'Unsaved changes' : 'In sync with workspace'}
            </span>
          </div>
        </div>

        {/* ── RIGHT: live preview ──────────────────────────────────────────── */}
        <div className="panel p-4 lg:sticky lg:top-4 space-y-3">
          <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
            Live preview — client nav
          </div>
          <NavPreview working={working} />
          <p className="text-[10px] text-muted-foreground/70">
            Dimmed / struck rows are hidden from the client. The real nav may still hide
            more based on the plan and access level.
          </p>
        </div>
      </div>
    </div>
  );
}

// ── Live preview ─────────────────────────────────────────────────────────────
// A faithful but SIMPLE styled mock of the client's left rail rendered straight from the
// working map (not the real NavRail component). Overview + Settings are rendered as
// permanently-on bookends; every catalog item is shown, with OFF items dimmed + struck +
// an "off" pill so the operator sees exactly which views the client loses. Driven by the
// same working-map state, so it updates instantly with no save.
function NavPreview({ working }: { working: EnabledViews }) {
  return (
    <div className="rounded-xl border border-border bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] p-2 text-sm">
      {/* Always-on Overview */}
      <PreviewRow label="Overview" on alwaysOn icon={<Gauge size={14} />} />

      {VIEW_SECTIONS.map((section) => {
        const visibleCount = section.items.filter((i) => isViewOn(working, i.href)).length;
        return (
          <div key={section.section} className="mt-3 pt-2 border-t border-border/40">
            <div className="flex items-center justify-between px-2 pb-1 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
              <span>{section.section}</span>
              <span className="font-normal tabular-nums">
                {visibleCount}/{section.items.length}
              </span>
            </div>
            <div className="space-y-0.5">
              {section.items.map((item) => (
                <PreviewRow
                  key={item.href}
                  label={item.label}
                  on={isViewOn(working, item.href)}
                />
              ))}
            </div>
          </div>
        );
      })}

      {/* Always-on Settings */}
      <div className="mt-3 pt-2 border-t border-border/60">
        <PreviewRow label="Settings" on alwaysOn icon={<SettingsIcon size={14} />} />
      </div>
    </div>
  );
}

function PreviewRow({
  label, on, alwaysOn, icon,
}: {
  label: string;
  on: boolean;
  alwaysOn?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1 rounded-lg"
      style={{
        color: on ? 'var(--muted-foreground)' : 'var(--muted-foreground)',
        opacity: on ? 1 : 0.4,
        transition: 'opacity var(--t-press, 120ms) var(--ease-out, ease-out)',
      }}
    >
      {icon ? (
        <span className="shrink-0 opacity-70">{icon}</span>
      ) : (
        <span
          className="w-1.5 h-1.5 rounded-full shrink-0"
          style={{ background: on ? 'var(--primary)' : 'var(--muted-foreground)' }}
        />
      )}
      <span
        className="flex-1 truncate"
        style={{ textDecoration: on ? 'none' : 'line-through' }}
      >
        {label}
      </span>
      {alwaysOn && (
        <span className="text-[9px] uppercase tracking-wide text-muted-foreground/70">
          always
        </span>
      )}
      {!on && !alwaysOn && (
        <span className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded-full bg-muted/40 text-muted-foreground">
          off
        </span>
      )}
    </div>
  );
}
