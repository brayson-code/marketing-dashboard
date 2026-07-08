'use client';

// Widget LIBRARY — the visual "add a widget" gallery shown inside the board's
// EDIT MODE. Replaces the old text list: instead of a title + one-line blurb, each
// available widget renders a LIVE, reduced-scale preview with representative MOCK
// data so you can scroll a gallery of the actual widgets before placing one.
//
// The preview render + compact icon come from src/lib/dashboard-widget-mocks.tsx
// (self-contained static snapshots — NO real /api calls from the gallery). This
// component still owns zero persistence: adding is a local optimistic mutation on
// <WidgetBoard>; the gallery only emits onAdd(id).
//
// PURE data source: the addable set comes from the shared DASHBOARD_WIDGETS catalog
// (client-safe, no `sql`), so the gallery can never offer a widget the board can't
// render, and a missing mock degrades gracefully to an icon + title placeholder.

import type { ComponentType, ReactNode } from 'react';
import { Plus, LayoutGrid } from 'lucide-react';
import { DASHBOARD_WIDGETS } from '@/lib/dashboard-widgets';
import type { WidgetCategory, WidgetDef } from '@/lib/dashboard-widgets';
import { widgetMock } from '@/lib/dashboard-widget-mocks';

// Human labels for the registry's category slugs (gallery section headers).
const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  ops: 'Operations',
  growth: 'Growth',
  content: 'Content',
  insights: 'Insights',
};

interface WidgetMenuProps {
  /** Widget ids currently placed on the board — excluded from the gallery. */
  placedIds: string[];
  onAdd: (id: string) => void;
}

// The preview renders at desktop width, then we scale it down to fit the card. A
// 100/SCALE inner width + scale() keeps the widget's real proportions inside a
// fixed-height, clipped, non-interactive frame (a "rendered snapshot container").
const PREVIEW_SCALE = 0.46;

function PreviewFrame({ Preview, fallback }: { Preview?: ComponentType; fallback: ReactNode }) {
  return (
    <div
      className="relative h-[172px] overflow-hidden border-b border-border/60"
      style={{ background: 'color-mix(in srgb, var(--surface-2) 30%, var(--background))' }}
    >
      {Preview ? (
        <div
          aria-hidden
          className="pointer-events-none select-none absolute left-0 top-0 origin-top-left p-3"
          style={{ width: `${100 / PREVIEW_SCALE}%`, transform: `scale(${PREVIEW_SCALE})` }}
        >
          <Preview />
        </div>
      ) : (
        fallback
      )}
      {/* Bottom fade so the clipped preview reads as an intentional snapshot. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 bottom-0 h-12"
        style={{ background: 'linear-gradient(to top, var(--background), transparent)' }}
      />
    </div>
  );
}

function GalleryCard({ w, onAdd }: { w: WidgetDef; onAdd: (id: string) => void }) {
  const mock = widgetMock(w.id);
  const Icon = mock?.icon ?? LayoutGrid;
  return (
    <div className="group flex flex-col rounded-xl border border-border bg-background overflow-hidden">
      <PreviewFrame
        Preview={mock?.Preview}
        fallback={
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <div className="flex flex-col items-center gap-2">
              <Icon size={28} className="opacity-60" />
              <span className="text-xs font-medium">{w.title}</span>
            </div>
          </div>
        }
      />
      <div className="flex items-start gap-2 p-3">
        <Icon size={15} className="mt-0.5 shrink-0 text-[var(--primary)]" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium truncate">{w.title}</span>
          <span className="block text-xs text-muted-foreground line-clamp-2">{w.description}</span>
        </span>
        <button
          type="button"
          onClick={() => onAdd(w.id)}
          className="btn btn-primary btn-sm shrink-0"
          aria-label={`Add ${w.title}`}
          style={{ transition: 'transform var(--t-press) var(--ease-out)' }}
        >
          <Plus size={13} /> Add
        </button>
      </div>
    </div>
  );
}

export function WidgetMenu({ placedIds, onAdd }: WidgetMenuProps) {
  const placedSet = new Set(placedIds);
  // Registry order is the gallery order (Builder A curates it) — preserve it for
  // both the cards and the category order below.
  const addable = DASHBOARD_WIDGETS.filter((w) => !placedSet.has(w.id));

  const categories: WidgetCategory[] = [];
  for (const w of addable) if (!categories.includes(w.category)) categories.push(w.category);

  return (
    <div className="panel p-4 animate-in" role="region" aria-label="Widget library">
      <div className="flex items-center gap-2 mb-3">
        <LayoutGrid size={15} className="text-muted-foreground" />
        <h3 className="text-sm font-medium">Widget library</h3>
        <span className="ml-auto text-[11px] text-muted-foreground hidden sm:inline">
          Live previews with sample data · click Add to place
        </span>
      </div>

      {addable.length === 0 ? (
        <p className="text-small">Every available widget is already on your dashboard.</p>
      ) : (
        <div className="max-h-[72vh] overflow-y-auto pr-1 -mr-1 space-y-5">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2 sticky top-0 z-10 bg-[var(--panel,var(--background))] py-1">
                {CATEGORY_LABEL[cat]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
                {addable
                  .filter((w) => w.category === cat)
                  .map((w) => (
                    <GalleryCard key={w.id} w={w} onAdd={onAdd} />
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
