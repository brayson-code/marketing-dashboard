'use client';

import {
  Search, Sun, Moon, Radio, LogOut, ShieldOff, Bell, Eye, EyeOff, Check, CheckCheck,
  Lightbulb, Zap, Rocket, Plus, Calendar, Activity, ChevronDown,
} from 'lucide-react';
import { useTheme } from 'next-themes';
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useDashboard } from '@/store';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { timeAgo } from '@/lib/utils';
import { createClient } from '@/lib/supabase/client';
import type { Notification } from '@/types';

export function HeaderBar() {
  return (
    <header className="fixed top-0 left-0 right-0 h-[var(--header-height)] surface-opaque border-b border-border flex items-center justify-between gap-3 px-3 sm:px-4 z-50">
      <Brand />
      <div className="hidden md:block flex-1 max-w-xl">
        <SearchTrigger />
      </div>
      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <AutonomyBadge />
        <DatePill />
        <NotificationBell />
        <ThemeToggle />
        <NewButton />
        <ProfileMenu />
      </div>
    </header>
  );
}

// ─── Left brand ──────────────────────────────────────────────────────────────
function Brand() {
  return (
    <Link href="/" className="flex items-center gap-2.5 shrink-0 select-none">
      <div className="w-7 h-7 rounded-md bg-primary/20 flex items-center justify-center" style={{
        boxShadow: '0 0 18px color-mix(in srgb, var(--primary) 35%, transparent)',
      }}>
        <span className="text-primary font-bold text-xs">K</span>
      </div>
      <div className="hidden sm:block min-w-0">
        <div className="text-sm font-semibold leading-none tracking-tight">KeyPlayers</div>
        <div className="text-[9px] text-muted-foreground mt-0.5 uppercase tracking-wider">Command Center</div>
      </div>
    </Link>
  );
}

// ─── Centered search ─────────────────────────────────────────────────────────
function SearchTrigger() {
  return (
    <button
      className="w-full flex items-center gap-2 h-8 px-3 rounded-lg bg-[color-mix(in_srgb,var(--surface-2)_60%,transparent)] hover:bg-[color-mix(in_srgb,var(--surface-2)_85%,transparent)] border border-border/40 text-xs text-muted-foreground"
      style={{ transition: 'background-color var(--t-press) var(--ease-out)' }}
      onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true }))}
    >
      <Search size={13} />
      <span className="flex-1 text-left">Search agents, tasks, or insights…</span>
      <kbd className="text-[10px] bg-muted/60 px-1.5 py-0.5 rounded">⌘K</kbd>
    </button>
  );
}

// ─── Date pill ───────────────────────────────────────────────────────────────
function DatePill() {
  const today = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  return (
    <button
      className="hidden lg:flex h-7 items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium bg-[color-mix(in_srgb,var(--surface-2)_55%,transparent)] hover:bg-[color-mix(in_srgb,var(--surface-2)_85%,transparent)] border border-border/40 text-muted-foreground"
      style={{ transition: 'background-color var(--t-press) var(--ease-out)' }}
      title="Date range (placeholder)"
    >
      <Calendar size={12} />
      <span>{today}</span>
      <ChevronDown size={11} />
    </button>
  );
}

// ─── + New green CTA ─────────────────────────────────────────────────────────
function NewButton() {
  return (
    <Link
      href="/drafts"
      className="h-7 flex items-center gap-1 px-2.5 rounded-md text-[11px] font-semibold bg-primary text-primary-foreground hover:opacity-90"
      style={{
        transition: 'transform var(--t-press) var(--ease-out), opacity var(--t-press) var(--ease-out)',
        boxShadow: '0 0 18px color-mix(in srgb, var(--primary) 30%, transparent)',
      }}
      title="New draft"
    >
      <Plus size={13} />
      <span className="hidden sm:inline">New</span>
    </Link>
  );
}

// ─── Autonomy badge (color-coded "what are agents allowed to do?") ───────────
function AutonomyBadge() {
  const { data } = useSmartPoll<{ level: 'observe' | 'propose' | 'act_notify' | 'full_auto' }>(
    () => fetch('/api/autonomy').then((r) => (r.ok ? r.json() : null)),
    { interval: 120_000 },
  );
  const level = data?.level ?? 'propose';
  const META = {
    observe:    { label: 'Observe',     icon: Eye,       cls: 'bg-muted/60 text-muted-foreground border-border/40' },
    propose:    { label: 'Propose',     icon: Lightbulb, cls: 'bg-info/15 text-info border-info/30' },
    act_notify: { label: 'Act+Notify',  icon: Zap,       cls: 'bg-warning/15 text-warning border-warning/30' },
    full_auto:  { label: 'Full Auto',   icon: Rocket,    cls: 'bg-success/15 text-success border-success/30' },
  } as const;
  const m = META[level];
  const Icon = m.icon;
  return (
    <Link
      href="/autonomy"
      title={`Autonomy mode: ${m.label} — click to change`}
      className={`h-7 flex items-center gap-1.5 px-2.5 rounded-md text-[11px] font-medium border ${m.cls}`}
      style={{ transition: 'background-color var(--t-press) var(--ease-out)' }}
    >
      <Icon size={13} />
      <span className="hidden sm:inline">{m.label}</span>
    </Link>
  );
}

// ─── Notification bell with origin-aware popover ─────────────────────────────
function NotificationBell() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const realOnly = useDashboard(s => s.realOnly);

  const { data: notifications, refetch } = useSmartPoll<Notification[]>(
    () => fetch(`/api/notifications?limit=20${realOnly ? '&real=true' : ''}`)
      .then(r => (r.ok ? r.json() : []))
      .then(d => (Array.isArray(d) ? d : [])),
    { interval: 30_000, key: realOnly },
  );

  const unreadCount = (Array.isArray(notifications) ? notifications : []).filter(n => !n.read).length;

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  async function markRead(id: number) {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id }) });
    refetch();
  }
  async function markAllRead() {
    await fetch('/api/notifications', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mark_all_read: true }) });
    refetch();
  }
  const SEV: Record<string, string> = { info: 'text-primary', warning: 'text-warning', error: 'text-destructive' };

  return (
    <div className="relative" ref={ref}>
      <button
        className="popover-trigger w-7 h-7 flex items-center justify-center rounded-md relative"
        style={{
          background: open ? 'color-mix(in srgb, var(--primary) 14%, transparent)' : 'transparent',
          color: open ? 'var(--primary)' : 'var(--muted-foreground)',
          transition: 'background-color var(--t-press) var(--ease-out), color var(--t-press) var(--ease-out)',
        }}
        onClick={() => setOpen(!open)}
        title="Notifications"
      >
        <Bell size={16} />
        {unreadCount > 0 && (
          <span className="absolute -top-0.5 -right-0.5 w-4 h-4 text-[9px] font-bold rounded-full count-badge flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div
          className="popover popover-from-trigger absolute right-0 top-full mt-2 w-80 sm:w-96 card border shadow-lg max-h-96 overflow-hidden flex flex-col z-50"
          style={{ transformOrigin: 'top right' }}
        >
          <div className="flex items-center justify-between px-4 py-2.5 border-b border-border/30">
            <span className="text-sm font-medium">Notifications</span>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="flex items-center gap-1 text-[10px] text-primary hover:underline">
                <CheckCheck size={12} /> Mark all read
              </button>
            )}
          </div>
          <div className="overflow-y-auto flex-1">
            {(!notifications || notifications.length === 0) ? (
              <div className="p-6 text-center text-sm text-muted-foreground">
                <Bell size={24} className="mx-auto mb-2 opacity-30" />
                No notifications yet
              </div>
            ) : (
              notifications.map(n => (
                <div key={n.id} className={`px-4 py-3 border-b border-border/20 ${!n.read ? 'bg-primary/5' : ''}`}>
                  <div className="flex items-start gap-2">
                    <div className={`mt-0.5 ${SEV[n.severity] || 'text-muted-foreground'}`}><Bell size={12} /></div>
                    <div className="flex-1 min-w-0">
                      {n.title && <div className="text-xs font-medium truncate">{n.title}</div>}
                      <p className="text-[11px] text-muted-foreground leading-relaxed">{n.message}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className="text-[10px] text-muted-foreground">{timeAgo(n.created_at)}</span>
                        {!n.read && (
                          <button onClick={() => markRead(n.id)} className="text-[10px] text-primary hover:underline flex items-center gap-0.5">
                            <Check size={10} /> Read
                          </button>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Theme toggle ────────────────────────────────────────────────────────────
function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const current = theme === 'dark' ? 'dark' : 'light';
  return (
    <button
      className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted"
      style={{ transition: 'background-color var(--t-press) var(--ease-out), color var(--t-press) var(--ease-out)' }}
      onClick={() => setTheme(current === 'dark' ? 'light' : 'dark')}
      title={`Switch to ${current === 'dark' ? 'light' : 'dark'} mode`}
    >
      {current === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  );
}

// ─── Profile dropdown (folds Seed / Feed / Sync / Logout out of the toolbar) ─
function ProfileMenu() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const { feedOpen, toggleFeed, realOnly, toggleRealOnly } = useDashboard();
  const [email, setEmail] = useState<string>('');

  useEffect(() => {
    fetch('/api/auth/me').then((r) => r.ok ? r.json() : null).then((j) => setEmail(j?.user?.email ?? '')).catch(() => {});
  }, []);
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  // Sign out via the server endpoint so cookies are cleared server-side. `global`
  // revokes EVERY session for this user (all devices) — use it if a credential may be
  // compromised. Falls back to a direct client sign-out if the endpoint is unreachable.
  async function logout(scope: 'local' | 'global' = 'local') {
    try {
      await fetch('/api/auth/signout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ scope }),
      });
    } catch {
      try { await createClient().auth.signOut(); } catch { /* ignore */ }
    }
    router.push('/login'); router.refresh();
  }
  const initial = (email?.[0] ?? 'U').toUpperCase();

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-semibold"
        style={{
          background: 'radial-gradient(circle at 30% 30%, color-mix(in srgb, var(--primary) 60%, white), var(--primary) 70%)',
          color: 'var(--primary-foreground)',
          boxShadow: open ? '0 0 14px color-mix(in srgb, var(--primary) 50%, transparent)' : 'none',
          transition: 'box-shadow var(--t-press) var(--ease-out)',
        }}
        title="Account"
      >{initial}</button>
      {open && (
        <div
          className="popover popover-from-trigger absolute right-0 top-full mt-2 w-64 max-w-[calc(100vw-1.5rem)] card border shadow-lg z-50 overflow-hidden"
          style={{ transformOrigin: 'top right' }}
        >
          <div className="px-3 py-2.5 border-b border-border/30">
            <div className="text-[11px] text-muted-foreground">Signed in as</div>
            <div className="text-xs font-medium truncate">{email || '—'}</div>
          </div>
          <div className="p-1 text-xs">
            <MenuButton onClick={toggleRealOnly} icon={realOnly ? <Eye size={13} /> : <EyeOff size={13} />}
              label={realOnly ? 'Showing real data only' : 'Showing all data (seeded)'} />
            <MenuButton onClick={toggleFeed} icon={<Radio size={13} />}
              label={feedOpen ? 'Hide live feed' : 'Show live feed'} />
            <SyncRow />
            <hr className="my-1 border-border/30" />
            <MenuButton onClick={() => logout('local')} icon={<LogOut size={13} />} label="Sign out" destructive />
            <MenuButton onClick={() => logout('global')} icon={<ShieldOff size={13} />} label="Sign out everywhere" destructive />
          </div>
        </div>
      )}
    </div>
  );
}

function MenuButton({ onClick, icon, label, destructive }:
  { onClick: () => void; icon: React.ReactNode; label: string; destructive?: boolean }) {
  return (
    <button
      onClick={onClick}
      className="w-full flex items-center gap-2 px-2.5 py-2 rounded text-left"
      style={{
        color: destructive ? 'var(--destructive)' : 'var(--foreground)',
        transition: 'background-color var(--t-press) var(--ease-out)',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'color-mix(in srgb, var(--surface-2) 70%, transparent)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      {icon}<span>{label}</span>
    </button>
  );
}

function SyncRow() {
  const [t, setT] = useState<string>('');
  useEffect(() => {
    const u = () => setT(new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    u(); const id = setInterval(u, 30_000);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="flex items-center gap-2 px-2.5 py-2 text-muted-foreground">
      <div className="w-1.5 h-1.5 rounded-full bg-success pulse-dot" />
      <Activity size={13} />
      <span>Last sync <span className="font-mono">{t}</span></span>
    </div>
  );
}
