'use client';

import { useEffect, useState } from 'react';
import OnboardingGate from '@/components/onboarding/onboarding-gate';
import { LensTabs } from '@/components/dashboard/lens-tabs';
import { KpiStrip } from '@/components/dashboard/kpi-strip';
import { NorthStarSlot } from '@/components/dashboard/north-star';
import { QuickWinCountdown } from '@/components/dashboard/quick-win-countdown';
import { KnowledgeMiniMap } from '@/components/dashboard/knowledge-mini-map';
import { HeroAgentCard } from '@/components/dashboard/hero-agent-card';
import Link from 'next/link';
import { OperatorQueue } from '@/components/dashboard/operator-queue';
import { AutomationFlow } from '@/components/dashboard/automation-flow';
import { TodaysPriorities, WeeklySnapshot } from '@/components/dashboard/workbench-widgets';
import { CompetitorOverviewCard } from '@/components/dashboard/competitor-overview-card';
import { ContentLabOverviewCard } from '@/components/dashboard/content-lab-overview-card';
import { EngagementOverviewCard } from '@/components/dashboard/engagement-overview-card';
import { UsageWidget } from '@/components/usage-widget';
import type { Department } from '@/components/agent-orb';
import { Loader2 } from 'lucide-react';

// The redesigned Overview. Five focal regions, top to bottom:
//   1. Lens tabs (which department lens you're viewing)
//   2. System Status hero strip (5 KPI cells)
//   3. Hero agent cards (the 5 C-suite or the active dept's team)
//   4. Workbench (Operator Queue · Today's Priorities · Weekly Snapshot)
//   5. Automation Flow (the active PARL campaign's waves)
//
// Everything below the lens tabs reacts to the active department.

interface HeroAgent { id: string; name: string; role_title: string; department: Department | null; description: string; status: string; runs_7d: number }

export default function OverviewPage() {
  const [department, setDepartment] = useState<Department>('leadership');
  const [agents, setAgents] = useState<HeroAgent[] | null>(null);

  useEffect(() => {
    setAgents(null);
    let cancel = false;
    const load = (initial: boolean) => {
      if (initial) setAgents(null);
      fetch(`/api/hero-agents?department=${department}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => { if (!cancel) setAgents(j.agents ?? []); })
        .catch(() => { if (!cancel) setAgents((prev) => prev ?? []); });
    };
    load(true);
    // Poll so heartbeat freshness (the "now · …" line + glow) actually ticks.
    const id = setInterval(() => load(false), 10_000);
    return () => { cancel = true; clearInterval(id); };
  }, [department]);

  return (
    <div className="space-y-5 animate-in">
      <OnboardingGate />

      <LensTabs active={department} onChange={setDepartment} />

      <KpiStrip department={department} />

      {/* 72-hour activation card — visible until the user ships their first
          published draft or all 5 milestones are done, then auto-hides. */}
      <QuickWinCountdown />

      {/* Goal focus — one North Star + 3 Top Priorities. Each card links to
          /goals#<id> so click takes you straight to the plan. Lives above the
          agents so the team's work reads against the outcomes it's driving. */}
      <NorthStarSlot />

      {/* Lens-filtered hero row — horizontal grid, one card per agent in the
          active department. data-stagger cascades them in 50ms apart. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3" data-stagger>
        {agents === null ? (
          Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="panel p-4 h-[140px] flex items-center justify-center">
              <Loader2 size={14} className="animate-spin text-muted-foreground" />
            </div>
          ))
        ) : agents.length === 0 ? (
          <div className="col-span-full panel p-6 text-center text-small">
            No agents in this lens yet.
          </div>
        ) : (
          agents.map((a) => (
            <Link key={a.id} href={`/agents/${a.id}`} className="block focus-ring rounded-xl">
              <HeroAgentCard agent={a as Parameters<typeof HeroAgentCard>[0]['agent']} />
            </Link>
          ))
        )}
      </div>

      {/* Workbench row — three widgets share the width. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <OperatorQueue department={department} />
        <TodaysPriorities department={department} />
        <WeeklySnapshot />
      </div>

      {/* Content command center row — Competitor Intel (what competitors do) +
          Content Lab (what to make) + Engagement (who's reaching back). Fills the
          workbench-width 3-col grid. */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <CompetitorOverviewCard />
        <ContentLabOverviewCard />
        <EngagementOverviewCard />
      </div>

      <AutomationFlow />

      {/* Claude API spend — full-width horizontal section, kept from V1. */}
      <UsageWidget />

      {/* Knowledge map — compact graph of entities + relations the agents
          have accumulated. Hides itself when the KG is empty. Lives at the
          bottom so the operationally-critical strips stay above the fold. */}
      <KnowledgeMiniMap />
    </div>
  );
}
