'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Lightbulb, ArrowRight, Check } from 'lucide-react';
import {
  buildRecommendations, type Recommendation, type RecAgent, type RecConnection,
} from '@/lib/agent-recommendations';

// "What's stopping your team working" — shown on Connections, where you can act on it.
//
// Renders NOTHING when there's nothing wrong. A panel that always has something to say
// becomes wallpaper, and then the one time it matters nobody reads it.

export function AgentRecommendations() {
  const [recs, setRecs] = useState<Recommendation[] | null>(null);

  useEffect(() => {
    let off = false;
    (async () => {
      const json = async (u: string) => {
        try { const r = await fetch(u, { cache: 'no-store' }); return r.ok ? await r.json() : null; }
        catch { return null; }
      };
      const [a, c] = await Promise.all([json('/api/agents'), json('/api/connections')]);
      if (off) return;

      const agentRows = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : [];
      const agents: RecAgent[] = agentRows.map((x: Record<string, unknown>) => ({
        id: String(x.id ?? ''),
        name: String(x.name ?? x.id ?? ''),
        role: typeof x.role === 'string' ? x.role : undefined,
        department: typeof x.department === 'string' ? x.department : null,
      })).filter((x: RecAgent) => x.id);

      const provRows = Array.isArray(c?.providers) ? c.providers : [];
      const connections: RecConnection[] = provRows.map((p: Record<string, unknown>) => ({
        key: String(p.key ?? p.provider ?? ''),
        label: String(p.label ?? p.key ?? p.provider ?? ''),
        connected: p.connected === true || p.status === 'connected',
      })).filter((x: RecConnection) => x.key);

      setRecs(buildRecommendations(agents, connections));
    })();
    return () => { off = true; };
  }, []);

  if (recs === null) return null;

  if (recs.length === 0) {
    return (
      <div className="panel p-3 flex items-center gap-2 text-xs">
        <Check size={14} className="text-[var(--success)] shrink-0" />
        <span className="text-muted-foreground">
          Nothing is blocking your AI team — everything they need is connected.
        </span>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h3 className="section-title">What&apos;s blocking your team</h3>
      {recs.map((r) => {
        const blocked = r.kind === 'blocked';
        const tone = blocked ? 'var(--warning)' : 'var(--muted-foreground)';
        const Icon = blocked ? AlertTriangle : Lightbulb;
        return (
          <div
            key={r.id}
            className="panel p-3 flex items-start gap-2.5"
            style={blocked ? {
              background: 'color-mix(in srgb, var(--warning) 6%, transparent)',
              borderColor: 'color-mix(in srgb, var(--warning) 30%, transparent)',
            } : undefined}
          >
            <Icon size={14} style={{ color: tone }} className="shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0 space-y-0.5">
              <p className="text-sm font-medium">{r.title}</p>
              <p className="text-xs text-muted-foreground">{r.detail}</p>
            </div>
            <Link href={r.href} className="btn btn-ghost btn-sm shrink-0">
              {r.cta} <ArrowRight size={12} />
            </Link>
          </div>
        );
      })}
      {/* Say where this comes from. It's inferred from each agent's role, not a declared
          dependency, and presenting a guess as fact is how a panel loses trust. */}
      <p className="text-[11px] text-muted-foreground">
        Based on what each agent does and what you have connected.
      </p>
    </div>
  );
}
