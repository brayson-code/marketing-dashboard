'use client';

import { useEffect, useState } from 'react';
import { Network } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Explainer } from '@/components/ui/explainer';
import { OrgChart, type ChartAgent } from '@/components/kg/org-chart';

// Agent Hierarchy — who reports to whom, founder down to individual agents.
//
// Separate from /agents/squads on purpose: that page is the ROSTER (what each agent is
// and how to configure it), this one is the SHAPE (how the team fits together). The
// reference Mitch supplied keeps them apart for the same reason.

export default function OrgChartPage() {
  const [agents, setAgents] = useState<ChartAgent[]>([]);
  const [founderName, setFounderName] = useState('Founder');
  const [assistantName, setAssistantName] = useState<string | undefined>();
  const [assistantRole, setAssistantRole] = useState<string | undefined>();
  const [loading, setLoading] = useState(true);

  // Fetched inline in the effect (rather than via a useCallback the effect calls) so
  // the roster load is a plain subscription to external state, matching how /kg pulls
  // its org data.
  useEffect(() => {
    let off = false;
    const json = async (url: string) => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    };
    (async () => {
      const [a, f] = await Promise.all([json('/api/agents'), json('/api/founder')]);
      if (off) return;
      const rows = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : [];
      setAgents(rows.map((x: Record<string, unknown>) => ({
        id: String(x.id ?? ''),
        name: String(x.name ?? x.id ?? ''),
        department: typeof x.department === 'string' ? x.department : null,
        is_executive: x.is_executive === true,
        role: typeof x.role === 'string' ? x.role : undefined,
      })).filter((x: ChartAgent) => x.id));

      // The founder and their assistant both come from the Founder Profile, which is
      // also what provisioning writes when Client Success stands a workspace up.
      const ans = f?.answers ?? {};
      if (typeof ans.name === 'string' && ans.name.trim()) setFounderName(ans.name.trim());
      if (typeof ans.assistant_name === 'string' && ans.assistant_name.trim()) setAssistantName(ans.assistant_name.trim());
      if (typeof ans.assistant_role === 'string' && ans.assistant_role.trim()) setAssistantRole(ans.assistant_role.trim());
      setLoading(false);
    })();
    return () => { off = true; };
  }, []);

  return (
    <div className="space-y-4 animate-in">
      <PageHeader
        icon={<Network size={20} />}
        title="Agent Hierarchy"
        subtitle="How the team fits together — founder, assistant, and the AI underneath them."
      />

      <Explainer
        id="org-chart-intro"
        title="How to read this"
        what="The chain of command. The founder sits at the top, their Executive Assistant below them, and the AI team reports underneath — not instead of the assistant."
        when="Use it to see which department owns what, and who the department heads are."
        example="Filter to Revenue to see just that column, without losing sight of the rest of the org."
        say={<>&ldquo;Who works on marketing for me?&rdquo;</>}
      />

      {loading ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">Loading…</div>
      ) : agents.length === 0 ? (
        <div className="panel p-4 text-xs text-muted-foreground text-center">
          No agents yet. They appear here as soon as the workspace has its AI team.
        </div>
      ) : (
        <OrgChart
          founderName={founderName}
          assistantName={assistantName}
          assistantRole={assistantRole}
          agents={agents}
        />
      )}
    </div>
  );
}
