'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Network, ArrowUpRight, Loader2 } from 'lucide-react';
import KnowledgeGraph, { type KgGraphEntity, type KgGraphRelation } from '@/components/kg-graph';

interface KindCount { kind: string; n: number }
interface KgPayload {
  entities: KgGraphEntity[];
  relations: KgGraphRelation[];
  counts: KindCount[];
  relationCount: number;
}

// Compact knowledge-map widget for Overview. Polls /api/kg every 30s and
// renders the same canvas graph used on /kg in compact mode, plus a tiny
// stats strip. Click anywhere in the panel to deep-link to the full graph.
//
// Hidden when the KG is empty or when the tenant's plan doesn't include KG
// (lite tenants). The API returns 403 for non-Pro tenants which we use as the
// signal to suppress the widget entirely — no broken empty state.
export function KnowledgeMiniMap() {
  const [data, setData] = useState<KgPayload | null>(null);
  const [loading, setLoading] = useState(true);
  // null = not yet checked, true = allowed, false = plan-gated
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let cancel = false;
    const load = () => {
      fetch('/api/kg?limit=80', { cache: 'no-store' })
        .then((r) => {
          // 403 = lite plan — suppress the widget entirely (no teaser here;
          // the /kg page via nav rail shows the proper UpgradeGate CTA).
          if (r.status === 403) {
            if (!cancel) setAllowed(false);
            return null;
          }
          if (!cancel) setAllowed(true);
          return r.json();
        })
        .then((j) => {
          if (cancel || j === null) return;
          setData({
            entities: Array.isArray(j.entities) ? j.entities : [],
            relations: Array.isArray(j.relations) ? j.relations : [],
            counts: Array.isArray(j.counts) ? j.counts : [],
            relationCount: Number(j.relationCount ?? 0),
          });
        })
        .catch(() => { if (!cancel) setData({ entities: [], relations: [], counts: [], relationCount: 0 }); })
        .finally(() => { if (!cancel) setLoading(false); });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => { cancel = true; clearInterval(t); };
  }, []);

  // Lite-plan tenants: hide completely (the /kg route is the conversion surface).
  if (allowed === false) return null;

  // Skip the panel entirely when the KG is empty — the slot is precious on
  // Overview and an empty graph adds zero signal.
  if (!loading && (!data || data.entities.length === 0)) return null;

  const total = data?.entities.length ?? 0;
  const rels = data?.relationCount ?? 0;
  const top3 = (data?.counts ?? []).slice(0, 3);

  return (
    <div className="panel">
      <div className="panel-header flex items-center gap-2">
        <Network size={14} className="text-[var(--primary)]" />
        <h3 className="text-sm font-semibold">Knowledge map</h3>
        <span className="text-micro text-muted-foreground">what the agents know · auto-refresh 30s</span>
        <Link
          href="/kg"
          className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          style={{ transition: 'color var(--t-popover) var(--ease-out)' }}
        >
          Explore graph <ArrowUpRight size={11} />
        </Link>
      </div>
      <div className="panel-body space-y-2.5">
        {/* Tiny stat strip */}
        <div className="flex items-center gap-3 flex-wrap text-[11px]">
          <span><span className="font-mono tabular-nums font-semibold">{total}</span> <span className="text-muted-foreground">entities</span></span>
          <span className="text-muted-foreground">·</span>
          <span><span className="font-mono tabular-nums font-semibold">{rels}</span> <span className="text-muted-foreground">relations</span></span>
          {top3.length > 0 && (
            <>
              <span className="text-muted-foreground">·</span>
              {top3.map((c) => (
                <span key={c.kind} className="badge badge-neutral text-[10px]">
                  {c.kind} <span className="opacity-70">{c.n}</span>
                </span>
              ))}
            </>
          )}
        </div>

        {/* Compact canvas graph (220px tall). Click a node → jump to /kg with
            the entity selected via hash. */}
        {loading && !data ? (
          <div className="h-[220px] flex items-center justify-center gap-2 text-small">
            <Loader2 size={14} className="animate-spin" /> Loading graph…
          </div>
        ) : (
          <KnowledgeGraph
            entities={data?.entities ?? []}
            relations={data?.relations ?? []}
            compact
            onSelect={(id) => { window.location.href = `/kg#entity-${id}`; }}
          />
        )}
      </div>
    </div>
  );
}
