'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  Heart, Plane, Gift, Home, Activity, ShoppingBag,
  Plus, Check, RotateCcw, Trash2, CalendarClock, User, Repeat, AlertCircle,
  Bell, History,
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
  lead_days: number;
  recurrence: 'none' | 'weekly' | 'monthly' | 'yearly';
  status: 'open' | 'done';
  priority: 'low' | 'normal' | 'high';
}

interface Occurrence { id: number; item_id: number; occurred_at: string; note: string | null }

/** When work must START — due date minus lead time. The whole point of this page: a
 *  birthday on the 12th with a week of lead time is an action for the 5th. */
function actBy(item: Item): Date | null {
  if (!item.due_at) return null;
  const due = new Date(item.due_at);
  if (Number.isNaN(due.getTime())) return null;
  return new Date(due.getTime() - item.lead_days * 86_400_000);
}

/** Open + the act-by date has arrived (or passed). This is "start this now". */
function needsAttention(item: Item): boolean {
  if (item.status !== 'open') return false;
  const by = actBy(item);
  return by !== null && by.getTime() <= Date.now();
}

const DEFAULT_LEAD: Record<Category, number> = {
  travel: 21, dates: 7, family: 2, health: 7, errands: 0,
};

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
  lead_days: '' as string,
  recurrence: 'none' as Item['recurrence'],
  priority: 'normal' as Item['priority'],
};

export default function PersonalLifePage() {
  const [tab, setTab] = useState<Category>('travel');
  const [items, setItems] = useState<Item[]>([]);
  const [history, setHistory] = useState<Record<number, Occurrence[]>>({});
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
      setHistory(data.history && typeof data.history === 'object' ? data.history : {});
    } catch {
      setError("Couldn't load this list. Refresh to try again.");
      setItems([]);
      setHistory({});
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
        lead_days: form.lead_days === '' ? undefined : Number(form.lead_days),
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
  // Three groups, in the order an assistant actually needs them: what to start NOW
  // (act-by has arrived), what's coming, what's finished.
  const attention = items.filter(needsAttention);
  const upcoming = items.filter((i) => i.status === 'open' && !needsAttention(i));
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
        say={<>&ldquo;Olivia&rsquo;s birthday is the 12th &mdash; sort a gift.&rdquo;</>}
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
          {/* Lead time — the field that makes this useful. Defaulted per category so the
              common case needs no thought, but always visible so it can be tuned. */}
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Bell size={12} className="shrink-0" />
            Start working on it
            <input
              type="number"
              min={0}
              max={365}
              value={form.lead_days}
              onChange={(e) => setForm({ ...form, lead_days: e.target.value })}
              placeholder={String(DEFAULT_LEAD[tab])}
              className="input !w-16 text-center"
              aria-label="Lead time in days"
            />
            days before it&apos;s due
            {form.lead_days === '' && (
              <span className="text-muted-foreground/70">
                (default for {active.label.toLowerCase()}: {DEFAULT_LEAD[tab]})
              </span>
            )}
          </label>
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
      ) : items.length === 0 ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">
          Nothing here yet. Add the first one so it stops living in someone&apos;s head.
        </div>
      ) : (
        <div className="space-y-2">
          {attention.length > 0 && (
            <>
              <p className="text-xs font-semibold text-[var(--warning)] flex items-center gap-1.5 pt-1">
                <Bell size={12} /> Start these now
              </p>
              {attention.map((item) => (
                <Row key={item.id} item={item} history={history[item.id]} onAct={act} />
              ))}
            </>
          )}
          {upcoming.length > 0 && (
            <>
              {attention.length > 0 && <p className="text-small pt-2">Coming up</p>}
              {upcoming.map((item) => (
                <Row key={item.id} item={item} history={history[item.id]} onAct={act} />
              ))}
            </>
          )}
          {done.length > 0 && (
            <>
              <p className="text-small pt-2">Done</p>
              {done.map((item) => (
                <Row key={item.id} item={item} history={history[item.id]} onAct={act} />
              ))}
            </>
          )}
        </div>
      )}
    </div>
  );
}

function Row({ item, history, onAct }: {
  item: Item;
  history?: Occurrence[];
  onAct: (p: Record<string, unknown>) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [closing, setClosing] = useState(false);
  const [note, setNote] = useState('');
  const due = dueLabel(item.due_at);
  const isDone = item.status === 'done';
  const by = actBy(item);
  const urgent = needsAttention(item);
  const past = history ?? [];

  const run = async (payload: Record<string, unknown>) => {
    setBusy(true);
    try { await onAct(payload); } finally { setBusy(false); setClosing(false); setNote(''); }
  };

  return (
    <div className={`panel p-3 space-y-2 ${isDone ? 'opacity-60' : ''} ${urgent ? 'border-[var(--warning)]/40' : ''}`}>
      <div className="flex items-start gap-3">
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
            {/* The act-by date is the actionable one, so it's shown next to the due date
                rather than hidden — "due Aug 12, start by Aug 5". */}
            {by && !isDone && item.lead_days > 0 && (
              <span className={`inline-flex items-center gap-1 ${urgent ? 'text-[var(--warning)] font-medium' : ''}`}>
                <Bell size={11} />
                {urgent ? 'start now' : `start ${by.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`}
              </span>
            )}
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
              onClick={() => setClosing((v) => !v)}
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

      {/* Completing asks what happened. That one line is what future-you reads next year
          instead of guessing what was given last time. */}
      {closing && (
        <div className="flex items-center gap-2 pt-1">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={item.category === 'dates'
              ? 'What did we give / do? (saved to history)'
              : 'What happened? (optional, saved to history)'}
            className="input"
            aria-label="What happened"
            autoFocus
          />
          <button className="btn btn-primary btn-sm shrink-0" disabled={busy}
            onClick={() => run({ action: 'complete', id: item.id, note })}>
            {item.recurrence === 'none' ? 'Done' : 'Done · roll forward'}
          </button>
          <button className="btn btn-ghost btn-sm shrink-0" onClick={() => { setClosing(false); setNote(''); }}>
            Cancel
          </button>
        </div>
      )}

      {past.length > 0 && (
        <div className="pt-1 border-t border-border/40 space-y-0.5">
          <p className="text-[11px] font-medium text-muted-foreground inline-flex items-center gap-1">
            <History size={10} /> Previously
          </p>
          {past.slice(0, 3).map((h) => (
            <p key={h.id} className="text-[11px] text-muted-foreground">
              {new Date(h.occurred_at).getFullYear()} — {h.note || 'done'}
            </p>
          ))}
        </div>
      )}
    </div>
  );
}
