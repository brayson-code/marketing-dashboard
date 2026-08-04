'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Heart, Plane, Gift, Home, Activity, ShoppingBag,
  Plus, Check, RotateCcw, Trash2, CalendarClock, User, Repeat, AlertCircle,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';

// Personal Life (North Star §12) — the founder's personal side, kept apart from company
// work. Written for an Executive Assistant: one tab per part of the founder's life, an
// always-visible "add" row, and dates that read in plain language ("in 3 days", "2 days
// overdue") rather than ISO strings, because that's the question actually being asked.

type Category = 'travel' | 'dates' | 'family' | 'health' | 'errands';

interface Item {
  id: number;
  category: Category;
  title: string;
  details: string | null;
  person: string | null;
  due_at: string | null;
  recurrence: 'none' | 'weekly' | 'monthly' | 'yearly';
  status: 'open' | 'done';
  priority: 'low' | 'normal' | 'high';
}

const TABS: ReadonlyArray<{
  key: Category; label: string; icon: typeof Plane; blurb: string;
}> = [
  { key: 'travel', label: 'Travel', icon: Plane, blurb: 'Flights, hotels, itineraries and reservations.' },
  { key: 'dates', label: 'Dates that matter', icon: Gift, blurb: 'Birthdays, anniversaries and gifts. Recurring dates roll forward automatically.' },
  { key: 'family', label: 'Family & home', icon: Home, blurb: 'Family logistics, appointments and household responsibilities.' },
  { key: 'health', label: 'Health & routine', icon: Activity, blurb: 'Health reminders, standing appointments and routines.' },
  { key: 'errands', label: 'Errands', icon: ShoppingBag, blurb: 'Purchases, personal research and one-off events.' },
];

/** Plain-language due date. An EA scanning this wants "in 3 days", not a timestamp. */
function dueLabel(due: string | null): { text: string; tone: 'overdue' | 'soon' | 'later' | 'none' } {
  if (!due) return { text: 'No date', tone: 'none' };
  const then = new Date(due);
  if (Number.isNaN(then.getTime())) return { text: 'No date', tone: 'none' };
  const days = Math.round((then.getTime() - Date.now()) / 86_400_000);
  // Show the year only when it isn't the current one. A recurring birthday rolls a year
  // forward on completion, and "Aug 6" with no year reads as "in two days" at a glance.
  const sameYear = then.getFullYear() === new Date().getFullYear();
  const date = then.toLocaleDateString(undefined, {
    month: 'short', day: 'numeric', ...(sameYear ? {} : { year: 'numeric' }),
  });
  if (days < 0) return { text: `${date} · ${Math.abs(days)}d overdue`, tone: 'overdue' };
  if (days === 0) return { text: `${date} · today`, tone: 'soon' };
  if (days === 1) return { text: `${date} · tomorrow`, tone: 'soon' };
  if (days <= 7) return { text: `${date} · in ${days} days`, tone: 'soon' };
  return { text: date, tone: 'later' };
}

const EMPTY_FORM = {
  title: '', person: '', due_at: '', details: '',
  recurrence: 'none' as Item['recurrence'],
  priority: 'normal' as Item['priority'],
};

export default function PersonalLifePage() {
  const [tab, setTab] = useState<Category>('travel');
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const load = useCallback(async (category: Category) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/personal?category=${category}`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setItems(Array.isArray(data.items) ? data.items : []);
    } catch {
      setError("Couldn't load this list. Refresh to try again.");
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(tab); }, [tab, load]);

  const act = async (payload: Record<string, unknown>) => {
    const res = await fetch('/api/personal', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Request failed');
    }
    await load(tab);
  };

  const submit = async () => {
    if (!form.title.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await act({
        action: 'create',
        category: tab,
        title: form.title,
        person: form.person || undefined,
        details: form.details || undefined,
        due_at: form.due_at ? new Date(form.due_at).toISOString() : null,
        recurrence: form.recurrence,
        priority: form.priority,
      });
      setForm(EMPTY_FORM);
      setAdding(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const active = TABS.find((t) => t.key === tab)!;
  const open = items.filter((i) => i.status === 'open');
  const done = items.filter((i) => i.status === 'done');

  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<Heart size={20} />}
        title="Personal Life"
        subtitle="The personal side of the founder's life — so nothing important quietly slips."
        actions={
          <button className="btn btn-primary btn-sm" onClick={() => setAdding((v) => !v)}>
            <Plus size={13} /> Add
          </button>
        }
      />

      <Explainer
        id="personal-life-intro"
        title="What this section is for"
        what="The personal responsibilities you carry for the founder — travel, appointments, gifts, family logistics, errands."
        when="Anything that isn't company work but still takes up the founder's attention. Company tasks belong in Tasks."
        example="Book the flight to Phoenix. Olivia's birthday on the 12th. Renew the passport before March."
      />

      {/* Tabs — one per part of their life. */}
      <div className="flex flex-wrap gap-1.5">
        {TABS.map((t) => {
          const Icon = t.icon;
          const on = t.key === tab;
          return (
            <button
              key={t.key}
              onClick={() => { setTab(t.key); setAdding(false); }}
              className={`btn btn-sm ${on ? 'btn-primary' : 'btn-ghost'}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      <p className="text-small">{active.blurb}</p>

      {adding && (
        <div className="panel p-4 space-y-3">
          <input
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            placeholder={
              tab === 'dates' ? "Whose date is it? e.g. “Olivia's birthday”"
              : tab === 'travel' ? 'What needs booking? e.g. “Flight to Phoenix”'
              : 'What needs doing?'
            }
            className="input"
            aria-label="Title"
            autoFocus
          />
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              value={form.person}
              onChange={(e) => setForm({ ...form, person: e.target.value })}
              placeholder="Who it's for (optional)"
              className="input"
              aria-label="Person"
            />
            <input
              type="date"
              value={form.due_at}
              onChange={(e) => setForm({ ...form, due_at: e.target.value })}
              className="input"
              aria-label="Date"
            />
            <select
              value={form.recurrence}
              onChange={(e) => setForm({ ...form, recurrence: e.target.value as Item['recurrence'] })}
              className="input"
              aria-label="Repeats"
            >
              <option value="none">Doesn&apos;t repeat</option>
              <option value="weekly">Every week</option>
              <option value="monthly">Every month</option>
              <option value="yearly">Every year</option>
            </select>
          </div>
          <textarea
            value={form.details}
            onChange={(e) => setForm({ ...form, details: e.target.value })}
            placeholder="Notes — preferences, confirmation numbers, anything worth remembering"
            className="input"
            rows={2}
            aria-label="Notes"
          />
          <div className="flex items-center gap-2">
            <select
              value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as Item['priority'] })}
              className="input !w-auto"
              aria-label="Priority"
            >
              <option value="low">Low priority</option>
              <option value="normal">Normal priority</option>
              <option value="high">High priority</option>
            </select>
            <button className="btn btn-primary btn-sm" onClick={submit} disabled={saving || !form.title.trim()}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button className="btn btn-ghost btn-sm" onClick={() => { setAdding(false); setForm(EMPTY_FORM); }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="panel p-3 text-xs text-destructive flex items-center gap-1.5">
          <AlertCircle size={13} /> {error}
        </div>
      )}

      {loading ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">Loading…</div>
      ) : open.length === 0 && done.length === 0 ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">
          Nothing here yet. Add the first one so it stops living in someone&apos;s head.
        </div>
      ) : (
        <div className="space-y-2">
          {open.map((item) => (
            <Row key={item.id} item={item} onAct={act} />
          ))}
          {done.length > 0 && (
            <>
              <p className="text-small pt-2">Done</p>
              {done.map((item) => (
                <Row key={item.id} item={item} onAct={act} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ item, onAct }: { item: Item; onAct: (p: Record<string, unknown>) => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const due = dueLabel(item.due_at);
  const isDone = item.status === 'done';

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try { await onAct(payload); } finally { setBusy(false); }
  };

  return (
    <div className={`panel p-3 flex items-start gap-3 ${isDone ? 'opacity-60' : ''}`}>
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className={`text-sm font-medium ${isDone ? 'line-through' : ''}`}>{item.title}</span>
          {item.priority === 'high' && !isDone && <span className="badge badge-warning">high</span>}
          {item.recurrence !== 'none' && (
            <span className="badge badge-neutral inline-flex items-center gap-1">
              <Repeat size={10} /> {item.recurrence}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 flex-wrap text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <CalendarClock size={11} />
            <span className={
              due.tone === 'overdue' ? 'text-destructive'
              : due.tone === 'soon' ? 'text-[var(--warning)]'
              : ''
            }>{due.text}</span>
          </span>
          {item.person && (
            <span className="inline-flex items-center gap-1"><User size={11} /> {item.person}</span>
          )}
        </div>
        {item.details && <p className="text-xs text-muted-foreground">{item.details}</p>}
      </div>

      <div className="flex items-center gap-1 shrink-0">
        {isDone ? (
          <button className="btn btn-ghost btn-sm" disabled={busy}
            onClick={() => run({ action: 'reopen', id: item.id })} title="Reopen">
            <RotateCcw size={13} />
          </button>
        ) : (
          <button className="btn btn-success btn-sm" disabled={busy}
            onClick={() => run({ action: 'complete', id: item.id })}
            title={item.recurrence === 'none' ? 'Mark done' : 'Done — rolls to the next one'}>
            <Check size={13} />
          </button>
        )}
        <button className="btn btn-destructive btn-sm" disabled={busy}
          onClick={() => run({ action: 'delete', id: item.id })} title="Delete">
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}
