'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Gauge, Bot, Mail, Contact, MoreHorizontal,
  PenLine, MessageCircle, FlaskConical, Search,
  BarChart3, LineChart, BrainCircuit, Rocket, Clock, List, Settings,
  FolderOpen,
} from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';

interface NavCounts {
  content: number;
  outreach: number;
  signals_today: number;
  new_leads: number;
  total_pending: number;
}

type CountKey = keyof NavCounts;

interface NavItem {
  href: string;
  label: string;
  icon: typeof Gauge;
  countKey?: CountKey;
  priority?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Core',
    items: [
      { href: '/', label: 'Overview', icon: Gauge, priority: true },
      { href: '/agents/squads', label: 'Squads', icon: Bot, priority: true },
      { href: '/outreach', label: 'Outreach', icon: Mail, countKey: 'outreach', priority: true },
      { href: '/crm', label: 'CRM', icon: Contact, countKey: 'new_leads', priority: true },
    ],
  },
  {
    label: 'Operate',
    items: [
      { href: '/agents/comms', label: 'Comms', icon: MessageCircle },
      { href: '/agents/workspace', label: 'Workspace', icon: FolderOpen },
      { href: '/content', label: 'Content', icon: PenLine, countKey: 'content' },
      { href: '/engagement', label: 'Engagement', icon: MessageCircle },
      { href: '/experiments', label: 'Experiments', icon: FlaskConical },
    ],
  },
  {
    label: 'Observe',
    items: [
      { href: '/research', label: 'Research', icon: Search, countKey: 'signals_today' },
      { href: '/kpis', label: 'KPIs', icon: BarChart3 },
      { href: '/analytics', label: 'Analytics', icon: LineChart },
      { href: '/memory', label: 'Memory', icon: BrainCircuit },
      { href: '/deploy', label: 'Deploy', icon: Rocket },
      { href: '/cron', label: 'Cron', icon: Clock },
      { href: '/activity', label: 'Activity', icon: List },
      { href: '/settings', label: 'Settings', icon: Settings },
    ],
  },
];

export function MobileNav() {
  const pathname = usePathname();
  const [sheetOpen, setSheetOpen] = useState(false);
  const sheetRef = useRef<HTMLDivElement>(null);
  const realOnly = useDashboard(s => s.realOnly);

  const { data: counts } = useSmartPoll<NavCounts>(
    () => fetch(`/api/counts${realOnly ? '?real=true' : ''}`).then(r => r.json()),
    { interval: 30_000, key: realOnly },
  );

  const priorityItems = useMemo(
    () => NAV_GROUPS.flatMap(g => g.items).filter(i => i.priority),
    [],
  );
  const nonPriorityItems = useMemo(
    () => NAV_GROUPS.flatMap(g => g.items).filter(i => !i.priority),
    [],
  );
  const sheetGroups = useMemo(
    () => NAV_GROUPS
      .map(group => ({ ...group, items: group.items.filter(i => !i.priority) }))
      .filter(group => group.items.length > 0),
    [],
  );
  const moreActive = nonPriorityItems.some(i => isActive(pathname, i.href));
  const moreBadge = counts ? (counts.content + counts.total_pending) : 0;

  useEffect(() => {
    if (!sheetOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (sheetRef.current && !sheetRef.current.contains(e.target as Node)) {
        setSheetOpen(false);
      }
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, [sheetOpen]);

  return (
    <>
      <nav className="mobile-nav md:hidden fixed bottom-0 left-0 right-0 surface-opaque z-50 border-t border-border/70 safe-area-bottom">
        <div className="flex items-center justify-around h-14 px-1 pb-[env(safe-area-inset-bottom)]">
          {priorityItems.map((item) => {
            const active = isActive(pathname, item.href);
            const count = item.countKey && counts ? counts[item.countKey] : 0;
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg min-w-[48px] min-h-[48px] transition-smooth relative ${
                  active ? 'text-primary' : 'text-muted-foreground'
                }`}
              >
                <Icon size={17} />
                <span className="text-[10px] leading-none">{item.label}</span>
                {count > 0 && (
                  <span className="absolute top-0.5 right-1 min-w-[14px] h-3.5 px-0.5 text-[8px] font-bold rounded-full count-badge flex items-center justify-center">
                    {count > 99 ? '99+' : count}
                  </span>
                )}
              </Link>
            );
          })}

          <button
            onClick={() => setSheetOpen(true)}
            className={`flex flex-col items-center justify-center gap-0.5 px-2 py-1 rounded-lg min-w-[48px] min-h-[48px] transition-smooth relative ${
              moreActive || sheetOpen ? 'text-primary' : 'text-muted-foreground'
            }`}
          >
            <MoreHorizontal size={17} />
            <span className="text-[10px] leading-none">More</span>
            {moreBadge > 0 && (
              <span className="absolute top-0.5 right-1 min-w-[14px] h-3.5 px-0.5 text-[8px] font-bold rounded-full count-badge flex items-center justify-center">
                {moreBadge > 99 ? '99+' : moreBadge}
              </span>
            )}
          </button>
        </div>
      </nav>

      {sheetOpen && (
        <div className="md:hidden fixed inset-0 z-[60]">
          <div className="absolute inset-0 bg-black/40" />
          <div
            ref={sheetRef}
            className="absolute bottom-0 left-0 right-0 modal-surface rounded-t-2xl max-h-[72vh] overflow-y-auto safe-area-bottom border-t border-border/70 animate-slide-in"
          >
            <div className="flex justify-center pt-3 pb-1">
              <div className="w-10 h-1 rounded-full bg-muted-foreground/25" />
            </div>

            <div className="px-4 pb-6">
              {sheetGroups.map((group, idx) => (
                <div key={group.label} className={idx > 0 ? 'mt-4 pt-3 border-t border-border/60' : ''}>
                  <div className="px-1 pb-2 text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold">
                    {group.label}
                  </div>
                  <div className="grid grid-cols-2 gap-1.5">
                    {group.items.map((item) => {
                        const active = isActive(pathname, item.href);
                        const count = item.countKey && counts ? counts[item.countKey] : 0;
                        const Icon = item.icon;
                        return (
                          <Link
                            key={item.href}
                            href={item.href}
                            onClick={() => setSheetOpen(false)}
                            className={`flex items-center gap-2.5 px-3 min-h-[48px] rounded-xl transition-smooth relative ${
                              active
                                ? 'bg-primary/14 text-primary'
                                : 'text-foreground hover:bg-surface-2/80'
                            }`}
                          >
                            <Icon size={16} />
                            <span className="text-xs font-medium truncate flex-1">{item.label}</span>
                            {count > 0 && (
                              <span className={`min-w-[16px] h-4 px-1 text-[8px] font-bold rounded-full flex items-center justify-center ${
                                item.countKey === 'signals_today' ? 'count-badge-info' : 'count-badge'
                              }`}>
                                {count > 99 ? '99+' : count}
                              </span>
                            )}
                          </Link>
                        );
                      })}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function isActive(pathname: string, href: string) {
  return href === '/' ? pathname === '/' : pathname.startsWith(href);
}
