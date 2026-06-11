'use client';

import { useState } from 'react';
import { PenLine, MessageCircle, Mail, Search, Activity, Info, X, Radio, Bell } from 'lucide-react';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { timeAgo } from '@/lib/utils';
import type { ActivityEntry } from '@/types';

const ACTION_ICONS: Record<string, typeof PenLine> = {
  post: PenLine,
  engage: MessageCircle,
  send: Mail,
  discover: Search,
  research: Search,
  triage: Activity,
  alert: Bell,
};

const ACTION_COLORS: Record<string, string> = {
  post: 'text-primary',
  engage: 'text-success',
  send: 'text-warning',
  discover: 'text-info',
  research: 'text-info',
  triage: 'text-muted-foreground',
  alert: 'text-destructive',
};

export function LiveFeed({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const realOnly = useDashboard(s => s.realOnly);

  const { data: entries } = useSmartPoll<ActivityEntry[]>(
    () => {
      const p = new URLSearchParams();
      if (filter) p.set('action', filter);
      p.set('limit', '50');
      if (realOnly) p.set('real', 'true');
      return fetch(`/api/activity?${p}`).then(r => r.json());
    },
    { interval: 15_000, enabled: open, key: `${filter}-${realOnly}` },
  );

  return (
    <>
      {/* Backdrop on mobile */}
      {open && (
        <div
          className="fixed inset-0 bg-black/40 z-30 lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`fixed top-[var(--header-height)] right-0 bottom-0 w-full sm:w-80 z-40
          glass-strong modal-surface border-l border-border/50 flex flex-col
          transition-transform duration-300 ease-out
          ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border/30">
          <div className="flex items-center gap-2">
            <Radio size={14} className="text-success" />
            <span className="text-sm font-medium">Live Feed</span>
            <div className="w-1.5 h-1.5 rounded-full bg-success pulse-dot" />
          </div>
          <div className="flex items-center gap-2">
            <select
              className="bg-muted/50 border border-border/30 rounded px-2 py-0.5 text-[11px]"
              value={filter}
              onChange={e => setFilter(e.target.value)}
            >
              <option value="">All</option>
              <option value="post">Post</option>
              <option value="engage">Engage</option>
              <option value="send">Send</option>
              <option value="discover">Discover</option>
              <option value="research">Research</option>
              <option value="triage">Triage</option>
              <option value="alert">Alert</option>
            </select>
            <button
              className="w-6 h-6 flex items-center justify-center rounded hover:bg-muted transition-colors text-muted-foreground"
              onClick={onClose}
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Feed */}
        <div className="flex-1 overflow-y-auto">
          {!entries || entries.length === 0 ? (
            <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
              No activity yet
            </div>
          ) : (
            <div className="divide-y divide-border/20">
              {entries.map(entry => {
                const Icon = ACTION_ICONS[entry.action || ''] || Info;
                const color = ACTION_COLORS[entry.action || ''] || 'text-muted-foreground';
                return (
                  <div key={entry.id} className="px-4 py-3 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-3">
                      <div className={`w-6 h-6 rounded-full bg-muted flex items-center justify-center shrink-0 mt-0.5 ${color}`}>
                        <Icon size={12} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          {entry.action && (
                            <span className={`text-[10px] font-semibold uppercase ${color}`}>
                              {entry.action}
                            </span>
                          )}
                          <span className="text-[10px] text-muted-foreground">
                            {timeAgo(entry.ts)}
                          </span>
                        </div>
                        <p className="text-xs text-foreground/90 mt-0.5 leading-relaxed">
                          {entry.detail}
                        </p>
                        {entry.result && (
                          <p className="text-[11px] text-success/80 mt-1">
                            {entry.result}
                          </p>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </aside>
    </>
  );
}
