'use client';

// Hero agent row — the lens-filtered grid of C-suite / department agent cards.
//
// This is the widget form of what used to be inline JSX in src/app/page.tsx. The
// dashboard registry (src/lib/dashboard-widgets.ts) references it by the component key
// 'HeroAgents'; the board renderer's lazy component-map binds that key here. It owns its
// own data exactly like every other overview card (fetch + 10s heartbeat poll), so it
// drops straight into the widget board with no extra wiring.

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Loader2 } from 'lucide-react';
import { HeroAgentCard } from '@/components/dashboard/hero-agent-card';
import type { Department } from '@/components/agent-orb';

interface HeroAgent {
  id: string;
  name: string;
  role_title: string;
  department: Department | null;
  description: string;
  status: string;
  runs_7d: number;
}

export function HeroAgents({ department }: { department: Department }) {
  const [agents, setAgents] = useState<HeroAgent[] | null>(null);

  useEffect(() => {
    setAgents(null);
    let cancel = false;
    const load = (initial: boolean) => {
      if (initial) setAgents(null);
      fetch(`/api/hero-agents?department=${department}`, { cache: 'no-store' })
        .then((r) => r.json())
        .then((j) => {
          if (!cancel) setAgents(j.agents ?? []);
        })
        .catch(() => {
          if (!cancel) setAgents((prev) => prev ?? []);
        });
    };
    load(true);
    // Poll so heartbeat freshness (the "now · …" line + glow) actually ticks.
    const id = setInterval(() => load(false), 10_000);
    return () => {
      cancel = true;
      clearInterval(id);
    };
  }, [department]);

  return (
    <div
      className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3"
      data-stagger
    >
      {agents === null ? (
        Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="panel p-4 h-[140px] flex items-center justify-center">
            <Loader2 size={14} className="animate-spin text-muted-foreground" />
          </div>
        ))
      ) : agents.length === 0 ? (
        <div className="col-span-full panel p-6 text-center text-small">No agents in this lens yet.</div>
      ) : (
        agents.map((a) => (
          <Link key={a.id} href={`/agents/${a.id}`} className="block focus-ring rounded-xl">
            <HeroAgentCard agent={a as Parameters<typeof HeroAgentCard>[0]['agent']} />
          </Link>
        ))
      )}
    </div>
  );
}
