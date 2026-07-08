'use client';

// Widget board — the customizable Overview grid ("Lobsterboard").
//
// Renders a resolved layout (an ordered [{ id, span? }] list) into a 3-column
// responsive CSS grid. Each widget's React component is code-split behind a lazy
// component-map (COMPONENTS below) keyed by the registry's stable `component` string,
// so the page only ships JS for the widgets actually placed. Binding registry keys to
// real components is deliberately the CLIENT board's job (the pure registry in
// src/lib/dashboard-widgets.ts holds no React references).
//
// VIEW MODE = zero chrome: each widget renders bare in its grid cell, so a tenant whose
// resolved layout reproduces today's page (the DEFAULT template) sees no visual change.
//
// EDIT MODE (the "Customize" toggle) reveals per-widget chrome (drag handle · span
// cycler · remove ✕), a categorized "Add a widget" palette (<WidgetMenu>), and a
// Save/Cancel bar. Reorder is dnd-kit sortable. Save persists via
// PUT /api/dashboard/layout using the CRM's optimistic-then-reconcile pattern: the new
// layout is committed to the UI immediately, and only rolled back (with a toast) if the
// server rejects it. Owners additionally get "Set as workspace default" which writes
// scope 'tenant' (the API enforces owner-only for that scope) instead of scope 'user'.
//
// CONTRACT (Builder A owns these):
//   @/lib/dashboard-widgets (PURE)   — DASHBOARD_WIDGETS, widgetById, WidgetDef/WidgetSpan
//   @/lib/dashboard-layout  (types)  — DashboardLayout, LayoutWidget (TYPE-ONLY import; the
//                                      module pulls in sql and must not enter the client bundle)
//   PUT /api/dashboard/layout { widgets: [{ id, span? }], scope: 'user' | 'tenant' }

import { Suspense, lazy, useMemo, useState } from 'react';
import type { CSSProperties, ComponentType, LazyExoticComponent } from 'react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  MeasuringStrategy,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { GripVertical, X, LayoutGrid, Plus, Check, Loader2 } from 'lucide-react';
import type { Department } from '@/components/agent-orb';
import { LensTabs } from '@/components/dashboard/lens-tabs';
import { WidgetMenu } from '@/components/dashboard/widget-menu';
import { toast } from '@/components/ui/toast';
import { widgetById } from '@/lib/dashboard-widgets';
import type { WidgetDef, WidgetSpan } from '@/lib/dashboard-widgets';
import type { DashboardLayout, LayoutWidget } from '@/lib/dashboard-layout';

// Every widget receives the active department lens; components that don't use it simply
// ignore the prop. Span is a layout concern (the grid cell width), not passed down.
type WidgetRenderProps = { department: Department };

// Registry `component` key → lazy loader that binds it to the EXISTING overview component
// (adapting the named export into React.lazy's { default } shape). No card is rewritten.
const COMPONENTS: Record<string, () => Promise<{ default: ComponentType<WidgetRenderProps> }>> = {
  KpiStrip: () =>
    import('@/components/dashboard/kpi-strip').then((m) => ({ default: m.KpiStrip as ComponentType<WidgetRenderProps> })),
  QuickWinCountdown: () =>
    import('@/components/dashboard/quick-win-countdown').then((m) => ({
      default: m.QuickWinCountdown as ComponentType<WidgetRenderProps>,
    })),
  NorthStarSlot: () =>
    import('@/components/dashboard/north-star').then((m) => ({
      default: m.NorthStarSlot as ComponentType<WidgetRenderProps>,
    })),
  HeroAgents: () =>
    import('@/components/dashboard/hero-agents').then((m) => ({
      default: m.HeroAgents as ComponentType<WidgetRenderProps>,
    })),
  OperatorQueue: () =>
    import('@/components/dashboard/operator-queue').then((m) => ({
      default: m.OperatorQueue as ComponentType<WidgetRenderProps>,
    })),
  TodaysPriorities: () =>
    import('@/components/dashboard/workbench-widgets').then((m) => ({
      default: m.TodaysPriorities as ComponentType<WidgetRenderProps>,
    })),
  WeeklySnapshot: () =>
    import('@/components/dashboard/workbench-widgets').then((m) => ({
      default: m.WeeklySnapshot as ComponentType<WidgetRenderProps>,
    })),
  CompetitorOverviewCard: () =>
    import('@/components/dashboard/competitor-overview-card').then((m) => ({
      default: m.CompetitorOverviewCard as ComponentType<WidgetRenderProps>,
    })),
  ContentLabOverviewCard: () =>
    import('@/components/dashboard/content-lab-overview-card').then((m) => ({
      default: m.ContentLabOverviewCard as ComponentType<WidgetRenderProps>,
    })),
  EngagementOverviewCard: () =>
    import('@/components/dashboard/engagement-overview-card').then((m) => ({
      default: m.EngagementOverviewCard as ComponentType<WidgetRenderProps>,
    })),
  AutomationFlow: () =>
    import('@/components/dashboard/automation-flow').then((m) => ({
      default: m.AutomationFlow as ComponentType<WidgetRenderProps>,
    })),
  UsageWidget: () =>
    import('@/components/usage-widget').then((m) => ({ default: m.UsageWidget as ComponentType<WidgetRenderProps> })),
  KnowledgeMiniMap: () =>
    import('@/components/dashboard/knowledge-mini-map').then((m) => ({
      default: m.KnowledgeMiniMap as ComponentType<WidgetRenderProps>,
    })),
  DepartmentRoster: () =>
    import('@/components/dashboard/department-roster').then((m) => ({
      default: m.DepartmentRoster as ComponentType<WidgetRenderProps>,
    })),
};

// Span → grid-column span, clamped to the board's 3 columns. Below `lg` the grid is a
// single column, so every widget is full-width (matches today's stacked mobile layout);
// the span only bites at `lg+`.
const SPAN_CLASS: Record<WidgetSpan, string> = {
  1: 'lg:col-span-1',
  2: 'lg:col-span-2',
  3: 'lg:col-span-3',
};
const SPANS: readonly WidgetSpan[] = [1, 2, 3];

// Stable, module-level cache of the lazy component per registry `component` key. Keeping
// the same lazy reference across renders (and across edit-mode toggles) prevents the
// widget from remounting — which would re-fire its /api fetches and flash a spinner.
const lazyCache = new Map<string, LazyExoticComponent<ComponentType<WidgetRenderProps>>>();
function lazyWidget(componentKey: string): LazyExoticComponent<ComponentType<WidgetRenderProps>> | null {
  const cached = lazyCache.get(componentKey);
  if (cached) return cached;
  const loader = COMPONENTS[componentKey];
  if (!loader) return null;
  const C = lazy(loader);
  lazyCache.set(componentKey, C);
  return C;
}

function WidgetSkeleton() {
  return (
    <div className="panel p-4 flex items-center justify-center min-h-[120px]">
      <Loader2 size={14} className="animate-spin text-muted-foreground" />
    </div>
  );
}

interface SortableWidgetProps {
  item: LayoutWidget;
  def: WidgetDef;
  department: Department;
  editMode: boolean;
  onRemove: (id: string) => void;
  onCycleSpan: (id: string) => void;
}

function SortableWidget({ item, def, department, editMode, onRemove, onCycleSpan }: SortableWidgetProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: !editMode,
  });

  const span = (item.span ?? def.defaultSpan) as WidgetSpan;
  const Widget = lazyWidget(def.component);

  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 30 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} className={`${SPAN_CLASS[span]} ${isDragging ? 'opacity-80' : ''}`}>
      {editMode && (
        <div className="flex items-center gap-1.5 mb-1.5 px-0.5">
          <button
            type="button"
            className="p-1 -ml-1 rounded text-muted-foreground hover:text-foreground cursor-grab active:cursor-grabbing touch-none focus-ring"
            aria-label={`Drag ${def.title}`}
            {...attributes}
            {...listeners}
          >
            <GripVertical size={14} />
          </button>
          <span className="text-xs font-medium text-muted-foreground truncate flex-1 min-w-0">{def.title}</span>
          <button
            type="button"
            onClick={() => onCycleSpan(item.id)}
            className="px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground hover:bg-muted focus-ring"
            title="Resize widget (width)"
            aria-label={`Resize ${def.title} (currently ${span} of 3 columns)`}
            style={{ transition: 'color var(--t-press) var(--ease-out), background-color var(--t-press) var(--ease-out)' }}
          >
            {span}/3
          </button>
          <button
            type="button"
            onClick={() => onRemove(item.id)}
            className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-muted focus-ring"
            aria-label={`Remove ${def.title}`}
            style={{ transition: 'color var(--t-press) var(--ease-out), background-color var(--t-press) var(--ease-out)' }}
          >
            <X size={14} />
          </button>
        </div>
      )}

      {/* In edit mode the widget content is inert (pointer-events-none) so grabbing,
          resizing and removing are the only interactions, and a dashed frame signals the
          tile is editable. */}
      <div
        className={editMode ? 'rounded-xl pointer-events-none select-none' : undefined}
        style={
          editMode
            ? { outline: '1px dashed color-mix(in srgb, var(--border) 90%, transparent)', outlineOffset: 3 }
            : undefined
        }
      >
        {Widget ? (
          <Suspense fallback={<WidgetSkeleton />}>
            <Widget department={department} />
          </Suspense>
        ) : (
          <WidgetSkeleton />
        )}
      </div>
    </div>
  );
}

interface WidgetBoardProps {
  /** Resolved layout: user override → tenant default → industry template → today's default. */
  initialLayout: DashboardLayout;
  /** Owner? enables the "Set as workspace default" (scope 'tenant') save option. */
  canSetWorkspaceDefault: boolean;
}

export function WidgetBoard({ initialLayout, canSetWorkspaceDefault }: WidgetBoardProps) {
  const [department, setDepartment] = useState<Department>('leadership');
  // `widgets` is the live, edited list; `savedWidgets` is the last committed snapshot we
  // revert to on Cancel or a failed Save (the optimistic-then-reconcile anchor).
  const [widgets, setWidgets] = useState<LayoutWidget[]>(initialLayout.widgets);
  const [savedWidgets, setSavedWidgets] = useState<LayoutWidget[]>(initialLayout.widgets);
  const [editMode, setEditMode] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [setAsDefault, setSetAsDefault] = useState(false);
  const [saving, setSaving] = useState(false);

  const sensors = useSensors(
    // Small distance gate so a click on the handle isn't read as a drag.
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const placedIds = useMemo(() => widgets.map((w) => w.id), [widgets]);

  function enterEdit() {
    setSavedWidgets(widgets); // anchor the current committed layout for Cancel/revert
    setEditMode(true);
  }

  function cancel() {
    setWidgets(savedWidgets);
    setEditMode(false);
    setMenuOpen(false);
    setSetAsDefault(false);
  }

  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    setWidgets((prev) => {
      const oldIndex = prev.findIndex((w) => w.id === active.id);
      const newIndex = prev.findIndex((w) => w.id === over.id);
      if (oldIndex < 0 || newIndex < 0) return prev;
      return arrayMove(prev, oldIndex, newIndex);
    });
  }

  function addWidget(id: string) {
    const def = widgetById(id);
    if (!def) return;
    setWidgets((prev) => (prev.some((w) => w.id === id) ? prev : [...prev, { id, span: def.defaultSpan }]));
  }

  function removeWidget(id: string) {
    setWidgets((prev) => prev.filter((w) => w.id !== id));
  }

  function cycleSpan(id: string) {
    setWidgets((prev) =>
      prev.map((w) => {
        if (w.id !== id) return w;
        const current = (w.span ?? widgetById(w.id)?.defaultSpan ?? 1) as WidgetSpan;
        const next = SPANS[(SPANS.indexOf(current) + 1) % SPANS.length];
        return { ...w, span: next };
      }),
    );
  }

  async function save() {
    const scope: 'user' | 'tenant' = setAsDefault && canSetWorkspaceDefault ? 'tenant' : 'user';
    const snapshot = savedWidgets; // revert target on failure
    const next = widgets;
    setSaving(true);
    // Optimistic: commit the new layout to the UI and close the editor immediately.
    setSavedWidgets(next);
    setEditMode(false);
    setMenuOpen(false);
    try {
      const res = await fetch('/api/dashboard/layout', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ widgets: next, scope }),
      });
      if (!res.ok) throw new Error('Save failed');
      toast.success(scope === 'tenant' ? 'Saved as workspace default' : 'Dashboard saved');
      setSetAsDefault(false);
    } catch (e) {
      // Reconcile: roll the UI back to the last committed layout and reopen the editor.
      setSavedWidgets(snapshot);
      setWidgets(snapshot);
      setEditMode(true);
      toast.error((e as Error).message === 'Save failed' ? 'Could not save your dashboard' : (e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5 animate-in">
      {/* Board control row — LensTabs (department lens) + the Customize / edit toolbar.
          In view mode this adds only a single, unobtrusive "Customize" button. */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="min-w-0 flex-1">
          <LensTabs active={department} onChange={setDepartment} />
        </div>

        {!editMode ? (
          <button type="button" onClick={enterEdit} className="btn btn-ghost shrink-0" aria-label="Customize dashboard">
            <LayoutGrid size={14} />
            Customize
          </button>
        ) : (
          <div className="flex flex-wrap items-center justify-end gap-2 shrink-0">
            <button type="button" onClick={() => setMenuOpen((o) => !o)} className="btn btn-ghost" aria-expanded={menuOpen}>
              <Plus size={14} />
              Add widget
            </button>
            {canSetWorkspaceDefault && (
              <label className="flex items-center gap-1.5 text-xs text-muted-foreground cursor-pointer select-none px-1">
                <input
                  type="checkbox"
                  checked={setAsDefault}
                  onChange={(e) => setSetAsDefault(e.target.checked)}
                  style={{ accentColor: 'var(--primary)' }}
                />
                Set as workspace default
              </label>
            )}
            <button type="button" onClick={cancel} className="btn btn-ghost" disabled={saving}>
              Cancel
            </button>
            <button type="button" onClick={save} className="btn btn-primary" disabled={saving}>
              {saving ? <Loader2 size={14} className="animate-spin" /> : <Check size={14} />}
              {saving ? 'Saving' : 'Save'}
            </button>
          </div>
        )}
      </div>

      {editMode && menuOpen && <WidgetMenu placedIds={placedIds} onAdd={addWidget} />}

      <DndContext
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
      >
        <SortableContext items={placedIds} strategy={rectSortingStrategy}>
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-x-4 gap-y-5">
            {widgets.map((item) => {
              const def = widgetById(item.id);
              if (!def) return null; // unknown id (widget retired from the registry) — skip safely
              return (
                <SortableWidget
                  key={item.id}
                  item={item}
                  def={def}
                  department={department}
                  editMode={editMode}
                  onRemove={removeWidget}
                  onCycleSpan={cycleSpan}
                />
              );
            })}
          </div>
        </SortableContext>
      </DndContext>

      {widgets.length === 0 && !editMode && (
        <div className="panel p-8 text-center">
          <p className="text-small mb-3">Your dashboard is empty.</p>
          <button type="button" onClick={enterEdit} className="btn btn-ghost mx-auto">
            <LayoutGrid size={14} />
            Add widgets
          </button>
        </div>
      )}
    </div>
  );
}
