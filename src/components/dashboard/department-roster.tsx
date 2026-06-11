'use client';

import { useEffect, useState } from 'react';
import { Crown, Megaphone, DollarSign, Settings as Cog, Heart } from 'lucide-react';
import { HeroAgentCard } from './hero-agent-card';
import { colorForDepartment, type Department } from '@/components/agent-orb';

// One stacked section per department on the Overview. Each section has a
// department-colored chip header and that department's hero agent cards. Lets
// the operator see the entire org at a glance without tab-switching, while the
// lens tabs above still drive the queue / priorities / flow below.

const DEPTS: Array<{ id: Department; label: string; icon: typeof Crown }> = [
  { id: 'leadership',        label: 'Leadership',        icon: Crown },
  { id: 'marketing',         label: 'Marketing',         icon: Megaphone },
  { id: 'revenue',           label: 'Revenue',           icon: DollarSign },
  { id: 'operations',        label: 'Operations',        icon: Cog },
  { id: 'client_experience', label: 'Client Experience', icon: Heart },
];

interface HeroAgent {
  id: string; name: string; role_title: string; department: Department | null;
  description: string; status: string; runs_7d: number;
}

export function DepartmentRoster() {
  const [byDept, setByDept] = useState<Partial<Record<Department, HeroAgent[]>> | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = async () => {
      const pairs = await Promise.all(
        DEPTS.map((d) =>
          fetch(`/api/hero-agents?department=${d.id}`, { cache: 'no-store' })
            .then((r) => r.json())
            .then((j) => [d.id, (j.agents ?? []) as HeroAgent[]] as const)
            .catch(() => [d.id, [] as HeroAgent[]] as const),
        ),
      );
      if (cancel) return;
      const m: Partial<Record<Department, HeroAgent[]>> = {};
      for (const [k, v] of pairs) m[k] = v;
      setByDept(m);
    };
    load();
    // Gentle refresh so new agents / status changes show up without a hard reload.
    const t = setInterval(load, 60_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  if (!byDept) return null;

  return (
    <div className="space-y-6">
      {DEPTS.map((d) => {
        const Icon = d.icon;
        const c = colorForDepartment(d.id);
        const agents = byDept[d.id] ?? [];
        if (agents.length === 0) return null;
        return (
          <section key={d.id} className="space-y-3" id={`dept-${d.id}`}>
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-7 w-7 items-center justify-center rounded-lg shrink-0"
                style={{
                  background: `color-mix(in srgb, ${c} 14%, transparent)`,
                  color: c,
                  border: `1px solid color-mix(in srgb, ${c} 32%, transparent)`,
                  boxShadow: `0 0 18px color-mix(in srgb, ${c} 22%, transparent)`,
                }}
              >
                <Icon size={14} />
              </span>
              <h2 className="text-h2">{d.label}</h2>
              <span className="text-small">{agents.length} agent{agents.length !== 1 ? 's' : ''}</span>
              <span
                className="ml-2 flex-1 h-px"
                style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${c} 28%, transparent), transparent)` }}
              />
            </div>
            <div
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3"
              data-stagger
            >
              {agents.map((a) => (
                <HeroAgentCard
                  key={a.id}
                  agent={a as Parameters<typeof HeroAgentCard>[0]['agent']}
                />
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}
