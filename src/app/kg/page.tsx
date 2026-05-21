'use client';

import { useCallback, useEffect, useState } from 'react';
import { Network, Search, ArrowRight, ArrowLeft } from 'lucide-react';
import KnowledgeGraph from '@/components/kg-graph';

interface Entity { id: number; kind: string; name: string; attributes: Record<string, unknown>; created_at: number; updated_at: number }
interface KgRelation { id: number; from_id: number; to_id: number; label: string; attributes: Record<string, unknown> }
interface Neighbor { entity: Entity; relation: KgRelation; direction: 'in' | 'out' }
interface KindCount { kind: string; n: number }
interface GraphRelation { from_id: number; to_id: number; label: string }

export default function KgPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<GraphRelation[]>([]);
  const [counts, setCounts] = useState<KindCount[]>([]);
  const [relCount, setRelCount] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string | null>(null);

  const load = useCallback(async () => {
    const qs = new URLSearchParams();
    if (search) qs.set('q', search);
    if (kindFilter) qs.set('kind', kindFilter);
    const res = await fetch(`/api/kg?${qs.toString()}`, { cache: 'no-store' });
    const json = await res.json();
    setEntities(Array.isArray(json.entities) ? json.entities : []);
    setRelations(Array.isArray(json.relations) ? json.relations : []);
    setCounts(Array.isArray(json.counts) ? json.counts : []);
    setRelCount(json.relationCount ?? 0);
  }, [search, kindFilter]);

  useEffect(() => { load(); const id = setInterval(load, 5000); return () => clearInterval(id); }, [load]);

  const loadNeighbors = useCallback(async (id: number) => {
    setSelectedId(id);
    const res = await fetch(`/api/kg?id=${id}`, { cache: 'no-store' });
    const json = await res.json();
    setNeighbors(json.neighbors ?? []);
  }, []);

  const selected = entities.find((e) => e.id === selectedId);

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-xl font-semibold">Knowledge Graph</h1>
          <p className="text-xs text-muted-foreground">
            Entities + relations KeyPlayer + sub-agents accumulate over time.
            <span className="ml-2 badge badge-neutral">{entities.length} entities · {relCount} relations</span>
          </p>
        </div>
      </div>

      <div className="panel">
        <div className="panel-header">
          <h3 className="section-title">Graph</h3>
        </div>
        <div className="panel-body">
          <KnowledgeGraph entities={entities} relations={relations} onSelect={loadNeighbors} />
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="lg:col-span-1 space-y-3">
          <div className="panel p-3 space-y-2">
            <div className="relative">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search by name…"
                className="pl-7"
                style={{ width: '100%' }}
              />
            </div>
            <div className="flex flex-wrap gap-1">
              <button onClick={() => setKindFilter(null)} className={`tab ${!kindFilter ? 'active' : ''}`}>all</button>
              {counts.map((c) => (
                <button key={c.kind} onClick={() => setKindFilter(c.kind)} className={`tab ${kindFilter === c.kind ? 'active' : ''}`}>
                  {c.kind} <span className="opacity-70">({c.n})</span>
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-2">
            {entities.length === 0 && (
              <div className="panel p-4 text-xs text-muted-foreground text-center">
                No entities yet. KeyPlayer adds them via the <code>kg_remember</code> tool as it learns things.
              </div>
            )}
            {entities.map((e) => (
              <button
                key={e.id}
                onClick={() => loadNeighbors(e.id)}
                className={`panel p-3 w-full text-left card-hover ${selectedId === e.id ? 'border-primary' : ''}`}
                style={selectedId === e.id ? { borderColor: 'var(--primary)' } : {}}
              >
                <div className="flex items-center gap-2 text-xs">
                  <span className="badge badge-neutral">{e.kind}</span>
                  <span className="font-medium">{e.name}</span>
                </div>
                {Object.keys(e.attributes).length > 0 && (
                  <div className="text-[10px] text-muted-foreground mt-1 line-clamp-2">
                    {Object.entries(e.attributes).slice(0, 3).map(([k, v]) => `${k}: ${String(v)}`).join(' · ')}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>

        <div className="lg:col-span-2 space-y-3">
          {!selected ? (
            <div className="panel p-6 text-center text-xs text-muted-foreground">
              <Network size={24} className="mx-auto mb-2 text-muted-foreground/60" />
              Select an entity to see its connections.
            </div>
          ) : (
            <>
              <div className="panel p-4 space-y-2">
                <div className="flex items-center gap-2 text-xs">
                  <span className="badge badge-info">{selected.kind}</span>
                  <span className="font-semibold text-base">{selected.name}</span>
                </div>
                {Object.keys(selected.attributes).length > 0 && (
                  <div className="text-xs space-y-0.5 pt-2">
                    {Object.entries(selected.attributes).map(([k, v]) => (
                      <div key={k} className="flex gap-2">
                        <span className="text-muted-foreground font-medium">{k}:</span>
                        <span className="break-words">{typeof v === 'string' ? v : JSON.stringify(v)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="panel">
                <div className="panel-header"><h3 className="section-title">Connections ({neighbors.length})</h3></div>
                <div className="panel-body p-0">
                  {neighbors.length === 0 ? (
                    <div className="p-4 text-xs text-muted-foreground text-center">No connections yet.</div>
                  ) : (
                    <ul>
                      {neighbors.map((n) => (
                        <li key={`${n.relation.id}-${n.direction}`} className="px-4 py-2 border-b border-border/40 flex items-center gap-2 text-xs">
                          {n.direction === 'out' ? <ArrowRight size={12} className="text-primary" /> : <ArrowLeft size={12} className="text-info" />}
                          <span className="text-muted-foreground font-mono">{n.relation.label}</span>
                          <span className="text-muted-foreground">·</span>
                          <span className="badge badge-neutral">{n.entity.kind}</span>
                          <button className="font-medium hover:underline" onClick={() => loadNeighbors(n.entity.id)}>{n.entity.name}</button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
