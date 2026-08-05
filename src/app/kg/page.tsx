'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Network, Search, ArrowRight, ArrowLeft, ChevronLeft, ChevronRight } from 'lucide-react';
import { OrgGraphView } from '@/components/kg/org-graph';
import { timeAgo } from '@/lib/utils';

interface Entity { id: number; kind: string; name: string; attributes: Record<string, unknown>; created_at: string; updated_at: string }
interface KgRelation { id: number; from_id: number; to_id: number; label: string; attributes: Record<string, unknown> }
interface Neighbor { entity: Entity; relation: KgRelation; direction: 'in' | 'out' }
interface KindCount { kind: string; n: number }
interface GraphRelation { from_id: number; to_id: number; label: string }
interface OrgAgent { id: string; name: string; department: string | null; is_executive: boolean; role?: string; description?: string }
interface OrgTool { id: string; name: string; status?: string }
interface OrgHuman { id: string; name: string; role?: string }

import { UpgradeGate } from '@/components/upgrade-gate';
import { Explainer } from '@/components/ui/explainer';

export default function KgPage() {
  return <UpgradeGate feature="kg" title="Knowledge Graph"><KgContent /></UpgradeGate>;
}

type SortOption = 'connections' | 'updated' | 'name';
const PAGE_SIZE = 25;

function KgContent() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [relations, setRelations] = useState<GraphRelation[]>([]);
  const [counts, setCounts] = useState<KindCount[]>([]);
  const [relCount, setRelCount] = useState(0);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [neighbors, setNeighbors] = useState<Neighbor[]>([]);
  const [search, setSearch] = useState('');
  const [kindFilter, setKindFilter] = useState<string | null>(null);
  const [sort, setSort] = useState<SortOption>('connections');
  const [page, setPage] = useState(0);
  // The graph is drawn from the ORG — departments, agents, tools, people — because
  // that's what makes it a picture of how the business runs. The entity list below is
  // a different lens on the same brain and keeps its own data.
  const [agents, setAgents] = useState<OrgAgent[]>([]);
  const [tools, setTools] = useState<OrgTool[]>([]);
  const [humans, setHumans] = useState<OrgHuman[]>([]);
  // The centre node is the founder — it's their brain. Falls back to the workspace name
  // when the Founder Profile hasn't been filled in yet.
  const [centerLabel, setCenterLabel] = useState<string>('Second Brain');
  const [goals, setGoals] = useState<Array<{ id: string; name: string; status?: string }>>([]);
  const [files, setFiles] = useState<Array<{ id: string; name: string; status?: string }>>([]);
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; status?: string }>>([]);
  // What you last clicked in the graph, mirrored underneath so the page shows what
  // you're actually looking at rather than leaving you to guess.
  const [picked, setPicked] = useState<{ kind: string; label: string; type?: string; entityId?: string } | null>(null);

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

  // Org data for the graph. Fetched once — unlike the entity list this doesn't change
  // every few seconds, and re-polling it would rebuild the layout for no reason.
  // Every call degrades to an empty tier rather than failing the whole graph.
  useEffect(() => {
    let off = false;
    const json = async (url: string) => {
      try {
        const r = await fetch(url, { cache: 'no-store' });
        return r.ok ? await r.json() : null;
      } catch { return null; }
    };
    (async () => {
      const [a, c, m, f, g, d, l] = await Promise.all([
        json('/api/agents'), json('/api/connections'), json('/api/members'), json('/api/founder'),
        json('/api/goals'), json('/api/documents'), json('/api/leads'),
      ]);
      if (off) return;
      const founderName = typeof f?.answers?.name === 'string' ? f.answers.name.trim() : '';
      if (founderName) setCenterLabel(founderName);
      const agentRows = Array.isArray(a) ? a : Array.isArray(a?.agents) ? a.agents : [];
      setAgents(agentRows.map((x: Record<string, unknown>) => ({
        id: String(x.id ?? ''),
        name: String(x.name ?? x.id ?? ''),
        department: typeof x.department === 'string' ? x.department : null,
        is_executive: x.is_executive === true,
        role: typeof x.role === 'string' ? x.role : undefined,
        description: typeof x.description === 'string' ? x.description : undefined,
      })).filter((x: OrgAgent) => x.id));
      const provRows = Array.isArray(c?.providers) ? c.providers : [];
      setTools(provRows.map((p: Record<string, unknown>) => ({
        id: String(p.provider ?? p.id ?? ''),
        name: String(p.label ?? p.provider ?? p.id ?? ''),
        status: typeof p.status === 'string' ? p.status : (p.connected ? 'connected' : undefined),
      })).filter((t: OrgTool) => t.id));
      const memberRows = Array.isArray(m?.members) ? m.members : Array.isArray(m) ? m : [];
      setHumans(memberRows.map((u: Record<string, unknown>) => ({
        id: String(u.id ?? u.email ?? ''),
        name: String(u.name ?? u.username ?? u.email ?? 'Teammate'),
        role: typeof u.role === 'string' ? u.role : undefined,
      })).filter((h: OrgHuman) => h.id));

      const goalRows = Array.isArray(g?.goals) ? g.goals : [];
      setGoals(goalRows.map((x: Record<string, unknown>) => ({
        id: String(x.id ?? ''), name: String(x.title ?? x.name ?? 'Goal'),
        status: typeof x.status === 'string' ? x.status : undefined,
      })).filter((x: { id: string }) => x.id));

      const docRows = Array.isArray(d?.documents) ? d.documents : [];
      setFiles(docRows.map((x: Record<string, unknown>) => ({
        id: String(x.id ?? ''), name: String(x.title ?? x.name ?? 'Document'),
        status: typeof x.status === 'string' ? x.status : undefined,
      })).filter((x: { id: string }) => x.id));

      const leadRows = Array.isArray(l?.leads) ? l.leads : Array.isArray(l) ? l : [];
      setContacts(leadRows.map((x: Record<string, unknown>) => ({
        id: String(x.id ?? ''),
        name: [x.first_name, x.last_name].filter(Boolean).join(' ').trim()
          || String(x.company ?? x.email ?? 'Contact'),
        status: typeof x.status === 'string' ? x.status : undefined,
      })).filter((x: { id: string }) => x.id));
    })();
    return () => { off = true; };
  }, []);

  const loadNeighbors = useCallback(async (id: number) => {
    setSelectedId(id);
    const res = await fetch(`/api/kg?id=${id}`, { cache: 'no-store' });
    const json = await res.json();
    setNeighbors(json.neighbors ?? []);
  }, []);

  const selected = entities.find((e) => e.id === selectedId);

  // Degree map: count how many times each entity id appears in relations
  const degreeMap = useMemo(() => {
    const m = new Map<number, number>();
    for (const r of relations) {
      m.set(r.from_id, (m.get(r.from_id) ?? 0) + 1);
      m.set(r.to_id, (m.get(r.to_id) ?? 0) + 1);
    }
    return m;
  }, [relations]);

  const sortedEntities = useMemo(() => {
    const copy = [...entities];
    if (sort === 'connections') {
      copy.sort((a, b) => {
        const diff = (degreeMap.get(b.id) ?? 0) - (degreeMap.get(a.id) ?? 0);
        return diff !== 0 ? diff : a.name.localeCompare(b.name);
      });
    } else if (sort === 'updated') {
      copy.sort((a, b) => {
        const ta = a.updated_at ? new Date(a.updated_at).getTime() : 0;
        const tb = b.updated_at ? new Date(b.updated_at).getTime() : 0;
        return tb - ta;
      });
    } else {
      copy.sort((a, b) => a.name.localeCompare(b.name));
    }
    return copy;
  }, [entities, sort, degreeMap]);

  // SOP tasks come from the entity list — documents and projects are the closest
  // thing we hold to a standing procedure.
  const orgInput = useMemo(() => ({
    workspace: 'Second Brain',
    agents,
    humans,
    tools,
    tasks: entities
      .filter((e) => e.kind === 'project')
      .slice(0, 20)
      .map((e) => ({ id: String(e.id), name: e.name })),
    goals,
    files,
    contacts,
    // Knowledge leans on the most-connected entities: with hundreds of them, degree is
    // the honest proxy for "what actually matters here".
    notes: sortedEntities.slice(0, 24).map((e) => ({ id: String(e.id), name: e.name, kind: e.kind })),
  }), [agents, humans, tools, entities, goals, files, contacts, sortedEntities]);

  const totalPages = Math.max(1, Math.ceil(sortedEntities.length / PAGE_SIZE));
  const pageStart = page * PAGE_SIZE;
  const pageEnd = Math.min(pageStart + PAGE_SIZE, sortedEntities.length);
  const pageEntities = sortedEntities.slice(pageStart, pageEnd);

  return (
    <div className="space-y-4 animate-in">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="space-y-1">
          <h1 className="text-h1">Second Brain</h1>
          <p className="text-xs text-muted-foreground">
            What the business knows — people, clients, decisions and facts worth keeping.
            It survives anyone leaving.
            <span className="ml-2 badge badge-neutral">{entities.length} entities · {relCount} relations</span>
          </p>
        </div>
      </div>

      <Explainer
        id="second-brain-intro"
        title="What the Second Brain is"
        what="Everything the business knows — people, clients, decisions and facts worth keeping — and how it all connects."
        when="Put anything durable here rather than leaving it in a chat thread. This is what survives someone leaving."
        example="That Henderson only wants to be contacted by email, and who owns that relationship."
        say={<>&ldquo;Remember that Henderson only wants to be contacted by email.&rdquo;</>}
      />

      {/* The core instrument (components/kg/brain-core.tsx) was mounted here and has
          been pulled back out: a radar gauge stacked on top of the old force-graph
          canvas read as two unrelated visuals on one page. It stays in the codebase
          for a summary tile elsewhere; this page needs ONE coherent visualisation,
          which is the graph rebuild. */}

      <div className="panel">
        <div className="panel-header">
          <h3 className="section-title">Graph</h3>
        </div>
        <div className="panel-body">
          <OrgGraphView
            input={orgInput}
            centerLabel={centerLabel}
            onSelect={(n) => {
              setPicked(n ? { kind: n.kind, label: n.label, type: n.meta?.type, entityId: n.meta?.entityId } : null);
              // A knowledge node IS an entity in the list below — select it so the
              // detail panel fills in rather than making you find it by hand.
              const eid = Number(n?.meta?.entityId);
              if (n?.kind === 'note' && Number.isFinite(eid)) loadNeighbors(eid);
            }}
          />
          {picked && (
            <p className="text-xs text-muted-foreground mt-2">
              Selected: <span className="text-foreground font-medium">{picked.label}</span>
              {picked.type ? ` · ${picked.type}` : ''}
            </p>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* ── Left: compact entity browser ── */}
        <div className="lg:col-span-1">
          <div className="panel" style={{ display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
              <h3 className="section-title">Entities</h3>
            </div>
            <div className="panel-body" style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {/* Search + Sort row */}
              <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                <div className="relative" style={{ flex: 1 }}>
                  <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground" />
                  <input
                    value={search}
                    onChange={(e) => { setSearch(e.target.value); setPage(0); }}
                    placeholder="Search by name…"
                    className="pl-7"
                    style={{ width: '100%' }}
                  />
                </div>
                <select
                  value={sort}
                  onChange={(e) => { setSort(e.target.value as SortOption); setPage(0); }}
                  style={{ flexShrink: 0, fontSize: '0.75rem' }}
                >
                  <option value="connections">Most connected</option>
                  <option value="updated">Recently updated</option>
                  <option value="name">Name A–Z</option>
                </select>
              </div>

              {/* Kind filter chips */}
              <div className="flex flex-wrap gap-1">
                <button onClick={() => { setKindFilter(null); setPage(0); }} className={`tab ${!kindFilter ? 'active' : ''}`}>all</button>
                {counts.map((c) => (
                  <button key={c.kind} onClick={() => { setKindFilter(c.kind); setPage(0); }} className={`tab ${kindFilter === c.kind ? 'active' : ''}`}>
                    {c.kind} <span className="opacity-70">({c.n})</span>
                  </button>
                ))}
              </div>

              {/* Dense table */}
              {entities.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center" style={{ padding: '1rem 0' }}>
                  No entities yet. KeyPlayer adds them via the <code>kg_remember</code> tool as it learns things.
                </div>
              ) : (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.75rem' }}>
                    <thead>
                      <tr style={{ borderBottom: '1px solid var(--border)', color: 'var(--muted-foreground)' }}>
                        <th style={{ textAlign: 'left', padding: '0.25rem 0.5rem', fontWeight: 500 }}>Entity</th>
                        <th style={{ textAlign: 'right', padding: '0.25rem 0.5rem', fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>Conn.</th>
                        <th className="hidden-sm" style={{ textAlign: 'right', padding: '0.25rem 0.5rem', fontWeight: 500 }}>Updated</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pageEntities.map((e) => {
                        const isSelected = selectedId === e.id;
                        return (
                          <tr
                            key={e.id}
                            onClick={() => loadNeighbors(e.id)}
                            style={{
                              cursor: 'pointer',
                              borderLeft: isSelected ? '2px solid var(--primary)' : '2px solid transparent',
                              background: isSelected ? 'var(--primary-muted, color-mix(in srgb, var(--primary) 10%, transparent))' : undefined,
                            }}
                            className="kg-entity-row"
                          >
                            <td style={{ padding: '0.375rem 0.5rem', maxWidth: 0, width: '99%' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: '0.375rem', overflow: 'hidden' }}>
                                <span className="badge badge-neutral" style={{ flexShrink: 0 }}>{e.kind}</span>
                                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: isSelected ? 500 : undefined }}>{e.name}</span>
                              </div>
                            </td>
                            <td style={{ padding: '0.375rem 0.5rem', textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
                              {degreeMap.get(e.id) ?? 0}
                            </td>
                            <td className="hidden-sm" style={{ padding: '0.375rem 0.5rem', textAlign: 'right', color: 'var(--muted-foreground)', whiteSpace: 'nowrap' }}>
                              {timeAgo(e.updated_at)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {/* Pagination footer */}
              {entities.length > 0 && (
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingTop: '0.25rem', borderTop: '1px solid var(--border)', marginTop: '0.25rem' }}>
                  <span style={{ fontSize: '0.7rem', color: 'var(--muted-foreground)' }}>
                    {sortedEntities.length === 0
                      ? '0 of 0'
                      : `${pageStart + 1}–${pageEnd} of ${sortedEntities.length}`}
                  </span>
                  <div style={{ display: 'flex', gap: '0.25rem' }}>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage((p) => Math.max(0, p - 1))}
                      disabled={page === 0}
                      aria-label="Previous page"
                    >
                      <ChevronLeft size={14} />
                    </button>
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
                      disabled={page >= totalPages - 1}
                      aria-label="Next page"
                    >
                      <ChevronRight size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ── Right: selected entity details + connections (unchanged) ── */}
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

      <style>{`
        .kg-entity-row:hover {
          background: var(--muted);
        }
        @media (max-width: 639px) {
          .hidden-sm { display: none; }
        }
      `}</style>
    </div>
  );
}
