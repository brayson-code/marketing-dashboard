'use client';

import Link from 'next/link';
import {
  LayoutGrid, FlaskConical, Clapperboard, Telescope, CalendarDays, FolderOpen, MessageCircle,
  PenLine, Radar, CheckCircle2, ArrowRight,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { StatCard } from '@/components/ui/stat-card';
import { ContentTabs } from '@/components/content/content-tabs';
import { useSmartPoll } from '@/hooks/use-smart-poll';
import { useDashboard } from '@/store';
import { Explainer } from '@/components/ui/explainer';

// Content hub Overview — the high-level landing for the whole content workflow.
// Top row: a few live counts pulled from the same /api/counts the nav rail uses
// (no new endpoint). Below: one card per area, each a doorway into its sub-tab.
// Purely a navigation/summary surface — every underlying page is unchanged.

interface Counts {
  content: number; outreach: number; signals_today: number; new_leads: number; total_pending: number;
}

const AREAS: Array<{ href: string; label: string; icon: typeof LayoutGrid; desc: string }> = [
  { href: '/content-lab',     label: 'Ideas',       icon: FlaskConical,   desc: 'Trend Radar + the reel idea generator. Turn what’s working into concepts, then draft scripts from the keepers.' },
  { href: '/scripts',         label: 'Scripts',     icon: Clapperboard,   desc: 'Write and edit reel scripts, then run them through the teleprompter to record.' },
  { href: '/competitors',     label: 'Competitors', icon: Telescope,      desc: 'Watchlist of rival handles + on-demand reel teardowns. See why each one won.' },
  { href: '/content',         label: 'Pipeline',    icon: CalendarDays,   desc: 'The approval queue, publishing calendar, and post-launch performance for every piece.' },
  { href: '/content/library', label: 'Library',     icon: FolderOpen,     desc: 'Every YouTube + Instagram post the agent can see, in one filterable gallery.' },
  { href: '/engagement',      label: 'Engagement',  icon: MessageCircle,  desc: 'Comments and replies across YouTube, Instagram, X, LinkedIn, Email, plus inbound signals.' },
];

export default function ContentOverviewPage() {
  const { realOnly } = useDashboard();
  const { data: counts } = useSmartPoll<Counts>(
    () => fetch(`/api/counts${realOnly ? '?real=true' : ''}`).then((r) => r.json()),
    { interval: 30_000, key: realOnly },
  );

  return (
    <div className="space-y-5 animate-in">
      <Explainer
        id="content-lab"
        title="What this is"
        what="Everything your agents write, from first idea through to the finished post — drafts, scripts, images and the pipeline they move along."
        when="When you want content produced without writing it yourself, or want to see what is queued."
        example="Ask for a week of posts, then approve the three you like."
        say="Or just say: “Write me three posts about what we launched this week.”"
      />
      <PageHeader
        icon={<LayoutGrid size={18} />}
        title="Content Lab"
        subtitle="Your whole content workflow in one place — ideate, write, study the competition, publish, and engage. Pick an area to dive in."
      />

      <ContentTabs />

      {/* Live snapshot — same counts feed as the nav rail, no new endpoint. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <StatCard label="In pipeline" value={counts?.content ?? 0} icon={PenLine} />
        <StatCard label="Signals today" value={counts?.signals_today ?? 0} icon={Radar} color="var(--info, var(--primary))" />
        <StatCard label="Pending approval" value={counts?.total_pending ?? 0} icon={CheckCircle2} color="var(--success)" />
      </div>

      {/* Area doorways. */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {AREAS.map((a) => {
          const Icon = a.icon;
          return (
            <Link key={a.href} href={a.href} className="card card-hover p-4 group flex flex-col gap-3">
              <div className="flex items-center gap-3">
                <div
                  className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0"
                  style={{ background: 'color-mix(in srgb, var(--primary) 15%, transparent)' }}
                >
                  <Icon size={18} style={{ color: 'var(--primary)' }} />
                </div>
                <h3 className="text-sm font-semibold">{a.label}</h3>
                <ArrowRight
                  size={15}
                  className="ml-auto text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">{a.desc}</p>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
