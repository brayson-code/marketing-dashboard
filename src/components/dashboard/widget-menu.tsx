'use client';

// Widget menu — the "add a widget" palette shown inside the board's EDIT MODE.
// Lists every registry widget NOT currently on the board, grouped by category,
// click-to-add.
//
// PURE data source: it reads the shared DASHBOARD_WIDGETS catalog
// (src/lib/dashboard-widgets.ts — client-safe, no `sql`, no React imports) so the palette
// can never offer a widget the board can't render. It never touches persistence itself:
// adding is a local optimistic mutation owned by <WidgetBoard>; this component only emits
// onAdd(id).

import { Plus, LayoutGrid } from 'lucide-react';
import { DASHBOARD_WIDGETS } from '@/lib/dashboard-widgets';
import type { WidgetCategory } from '@/lib/dashboard-widgets';

// Human labels for the registry's category slugs (menu section headers).
const CATEGORY_LABEL: Record<WidgetCategory, string> = {
  ops: 'Operations',
  growth: 'Growth',
  content: 'Content',
  insights: 'Insights',
};

interface WidgetMenuProps {
  /** Widget ids currently placed on the board — excluded from the palette. */
  placedIds: string[];
  onAdd: (id: string) => void;
}

export function WidgetMenu({ placedIds, onAdd }: WidgetMenuProps) {
  const placedSet = new Set(placedIds);
  // Registry order is the menu order (Builder A curates it) — preserve it for both the
  // widget rows and the category order below.
  const addable = DASHBOARD_WIDGETS.filter((w) => !placedSet.has(w.id));

  const categories: WidgetCategory[] = [];
  for (const w of addable) if (!categories.includes(w.category)) categories.push(w.category);

  return (
    <div className="panel p-4 animate-in" role="region" aria-label="Add a widget">
      <div className="flex items-center gap-2 mb-3">
        <LayoutGrid size={15} className="text-muted-foreground" />
        <h3 className="text-sm font-medium">Add a widget</h3>
      </div>

      {addable.length === 0 ? (
        <p className="text-small">Every available widget is already on your dashboard.</p>
      ) : (
        <div className="space-y-4">
          {categories.map((cat) => (
            <div key={cat}>
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                {CATEGORY_LABEL[cat]}
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                {addable
                  .filter((w) => w.category === cat)
                  .map((w) => (
                    <button
                      key={w.id}
                      type="button"
                      onClick={() => onAdd(w.id)}
                      className="group flex items-start gap-2 rounded-lg border border-border bg-background px-3 py-2 text-left hover:bg-muted focus-ring"
                      style={{ transition: 'background-color var(--t-press) var(--ease-out)' }}
                    >
                      <Plus
                        size={14}
                        className="mt-0.5 shrink-0 text-muted-foreground group-hover:text-foreground"
                      />
                      <span className="min-w-0">
                        <span className="block text-sm font-medium truncate">{w.title}</span>
                        <span className="block text-xs text-muted-foreground line-clamp-2">
                          {w.description}
                        </span>
                      </span>
                    </button>
                  ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
