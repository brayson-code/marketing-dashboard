'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  addEdge,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type Connection,
  type NodeProps,
  type ReactFlowInstance,
  type Viewport,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Sparkles, Image as ImageIcon, Film, FileText, Layers, Loader2, Type } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from '@/components/ui/toast';

type GenStatus = 'idle' | 'processing' | 'completed' | 'failed';

interface NodeData {
  prompt?: string;
  status?: GenStatus;
  jobId?: number;
  outputUrl?: string;
  error?: string;
  assetUrl?: string;
  kind?: 'image' | 'video';
  [k: string]: unknown;
}
type FlowNode = Node<NodeData>;
interface AssetItem { id: number; url: string; kind: string; name: string | null }

interface CanvasActions {
  updateNode: (id: string, patch: Partial<NodeData>) => void;
  runNode: (id: string) => void;
  assemble: () => void;
  assets: AssetItem[];
}
const Ctx = createContext<CanvasActions | null>(null);
const useCanvas = (): CanvasActions => {
  const c = useContext(Ctx);
  if (!c) throw new Error('CanvasBoard context missing');
  return c;
};

function defaultData(type: string): NodeData {
  if (type === 'prompt') return { prompt: '' };
  if (type === 'image' || type === 'video') return { status: 'idle' };
  return {};
}

// ─── Custom nodes ─────────────────────────────────────────────────────────────

function NodeShell({ title, icon, children, accent }: { title: string; icon: React.ReactNode; children: React.ReactNode; accent?: boolean }) {
  return (
    <div className="rounded-lg border bg-card shadow-sm w-56 text-xs" style={{ borderColor: accent ? 'var(--primary)' : 'var(--border)' }}>
      <div className="px-2.5 py-1.5 border-b border-border/60 font-semibold flex items-center gap-1.5">{icon} {title}</div>
      <div className="p-2 space-y-2">{children}</div>
    </div>
  );
}

function PromptNode({ id, data }: NodeProps<FlowNode>) {
  const { updateNode } = useCanvas();
  return (
    <>
      <NodeShell title="Prompt" icon={<Type size={12} className="text-[var(--primary)]" />}>
        <textarea
          value={String(data.prompt ?? '')}
          onChange={(e) => updateNode(id, { prompt: e.target.value })}
          rows={3}
          placeholder="Describe the shot…"
          className="w-full text-xs resize-none nodrag nowheel"
        />
      </NodeShell>
      <Handle type="source" position={Position.Right} />
    </>
  );
}

function GenNode({ id, data, kind }: { id: string; data: NodeData; kind: 'image' | 'video' }) {
  const { runNode } = useCanvas();
  const status = data.status as GenStatus | undefined;
  const isVideo = kind === 'video';
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <NodeShell title={isVideo ? 'Video · Veo' : 'Image · Nano Banana'} icon={isVideo ? <Film size={12} className="text-[var(--primary)]" /> : <ImageIcon size={12} className="text-[var(--primary)]" />}>
        {data.outputUrl ? (
          isVideo ? (
            <video src={String(data.outputUrl)} className="w-full rounded border border-border/60" controls muted loop />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(data.outputUrl)} alt="" className="w-full rounded border border-border/60" />
          )
        ) : (
          <div className="h-24 rounded border border-dashed border-border/60 grid place-items-center text-muted-foreground">
            {status === 'processing' ? <Loader2 size={16} className="animate-spin" /> : isVideo ? 'No clip yet' : 'No image yet'}
          </div>
        )}
        {data.error ? <div className="text-[10px] text-destructive leading-snug">{String(data.error)}</div> : null}
        <button onClick={() => runNode(id)} disabled={status === 'processing'} className="btn btn-primary btn-sm w-full nodrag">
          {status === 'processing' ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />} Generate
        </button>
      </NodeShell>
      <Handle type="source" position={Position.Right} />
    </>
  );
}
function ImageNode(props: NodeProps<FlowNode>) { return <GenNode id={props.id} data={props.data} kind="image" />; }
function VideoNode(props: NodeProps<FlowNode>) { return <GenNode id={props.id} data={props.data} kind="video" />; }

function AssetNode({ id, data }: NodeProps<FlowNode>) {
  const { updateNode, assets } = useCanvas();
  return (
    <>
      <NodeShell title="Asset" icon={<FileText size={12} className="text-[var(--primary)]" />}>
        {data.assetUrl ? (
          String(data.kind) === 'video' ? (
            <video src={String(data.assetUrl)} className="w-full rounded border border-border/60" muted />
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={String(data.assetUrl)} alt="" className="w-full rounded border border-border/60" />
          )
        ) : (
          <div className="h-16 rounded border border-dashed border-border/60 grid place-items-center text-muted-foreground">Pick from library</div>
        )}
        <select
          className="w-full text-xs nodrag"
          value={String(data.assetUrl ?? '')}
          onChange={(e) => {
            const a = assets.find((x) => x.url === e.target.value);
            updateNode(id, { assetUrl: e.target.value, kind: (a?.kind as 'image' | 'video') ?? 'image' });
          }}
        >
          <option value="">— select clip/image —</option>
          {assets.map((a) => (
            <option key={a.id} value={a.url}>{a.name || `${a.kind} #${a.id}`}</option>
          ))}
        </select>
      </NodeShell>
      <Handle type="source" position={Position.Right} />
    </>
  );
}

function AssemblyNode() {
  const { assemble } = useCanvas();
  return (
    <>
      <Handle type="target" position={Position.Left} />
      <NodeShell title="Assemble → Render" icon={<Layers size={12} className="text-[var(--primary)]" />} accent>
        <p className="text-[10px] text-muted-foreground leading-snug">
          Builds a reel from the connected frames (left→right) and opens the Hyperframes editor to render via HeyGen.
        </p>
        <button onClick={() => assemble()} className="btn btn-primary btn-sm w-full nodrag">
          <Layers size={11} /> Assemble reel
        </button>
      </NodeShell>
    </>
  );
}

// ─── Board ────────────────────────────────────────────────────────────────────

export interface CanvasBoardProps {
  canvasId: number;
  initialNodes: FlowNode[];
  initialEdges: Edge[];
  initialViewport?: Viewport | null;
  title?: string;
}

export function CanvasBoard(props: CanvasBoardProps) {
  return (
    <ReactFlowProvider>
      <Board {...props} />
    </ReactFlowProvider>
  );
}

function Board({ canvasId, initialNodes, initialEdges, initialViewport, title }: CanvasBoardProps) {
  const [nodes, setNodes, onNodesChange] = useNodesState<FlowNode>(initialNodes ?? []);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>(initialEdges ?? []);
  const [assets, setAssets] = useState<AssetItem[]>([]);
  const rf = useRef<ReactFlowInstance<FlowNode, Edge> | null>(null);
  const router = useRouter();

  useEffect(() => {
    fetch('/api/assets').then((r) => r.json()).then((j) => setAssets(j.assets ?? [])).catch(() => {});
  }, []);

  // Debounced autosave of the graph.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      const viewport = rf.current?.getViewport();
      fetch(`/api/generation/canvas/${canvasId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nodes, edges, viewport }),
      }).catch(() => {});
    }, 900);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [nodes, edges, canvasId]);

  const updateNode = useCallback((id: string, patch: Partial<NodeData>) => {
    setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...patch } } : n)));
  }, [setNodes]);

  const runNode = useCallback(async (id: string) => {
    const node = nodes.find((n) => n.id === id);
    if (!node) return;
    const provider = node.type === 'video' ? 'veo' : 'nanobanana';
    const incoming = edges.filter((e) => e.target === id).map((e) => e.source);
    const upstream = nodes.filter((n) => incoming.includes(n.id));
    const promptParts: string[] = [];
    if (typeof node.data.prompt === 'string' && node.data.prompt.trim()) promptParts.push(node.data.prompt.trim());
    let imageUrl: string | undefined;
    for (const u of upstream) {
      if (u.type === 'prompt' && typeof u.data.prompt === 'string' && u.data.prompt.trim()) promptParts.push(u.data.prompt.trim());
      const out = (u.data.outputUrl || u.data.assetUrl) as string | undefined;
      if (out && !imageUrl) imageUrl = out;
    }
    if (node.type === 'video' && !imageUrl) { toast.error('Connect an image into this video node first.'); return; }
    const input = { prompt: promptParts.join('. '), imageUrl, aspect: '9:16' };
    updateNode(id, { status: 'processing', error: undefined });
    try {
      const res = await fetch('/api/generation/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider, canvasId, nodeId: id, input }) });
      const j = (await res.json()) as { status?: string; outputUrl?: string; jobId?: number; error?: string };
      if (!res.ok) { updateNode(id, { status: 'failed', error: j.error }); toast.error(j.error || 'Generation failed'); return; }
      if (j.status === 'completed') { updateNode(id, { status: 'completed', outputUrl: j.outputUrl, jobId: j.jobId }); return; }
      updateNode(id, { jobId: j.jobId });
      const poll = async () => {
        try {
          const r = await fetch(`/api/generation/jobs/${j.jobId}`);
          const s = (await r.json()) as { status?: string; outputUrl?: string; error?: string };
          if (s.status === 'completed') { updateNode(id, { status: 'completed', outputUrl: s.outputUrl }); return; }
          if (s.status === 'failed') { updateNode(id, { status: 'failed', error: s.error }); toast.error(s.error || 'Generation failed'); return; }
          setTimeout(poll, 5000);
        } catch { setTimeout(poll, 6000); }
      };
      setTimeout(poll, 4000);
    } catch (e) {
      updateNode(id, { status: 'failed', error: (e as Error).message });
    }
  }, [nodes, edges, updateNode, canvasId]);

  const assemble = useCallback(async () => {
    const sceneNodes = nodes.filter((n) => ['image', 'video', 'asset'].includes(n.type || '') && (n.data.outputUrl || n.data.assetUrl));
    if (sceneNodes.length === 0) { toast.error('Generate at least one frame first.'); return; }
    const ordered = [...sceneNodes].sort((a, b) => a.position.x - b.position.x);
    const scenes = ordered.map((n) => {
      const url = (n.data.outputUrl || n.data.assetUrl) as string;
      const isVideo = n.type === 'video' || n.data.kind === 'video';
      const promptUp = edges
        .filter((e) => e.target === n.id)
        .map((e) => nodes.find((x) => x.id === e.source))
        .find((x) => x?.type === 'prompt');
      return { type: isVideo ? 'video' : 'image', url, caption: (promptUp?.data.prompt as string | undefined) ?? undefined };
    });
    try {
      const res = await fetch('/api/generation/assemble', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: title || 'Canvas reel', scenes }) });
      const j = (await res.json()) as { draftId?: number; error?: string };
      if (!res.ok || !j.draftId) { toast.error(j.error || 'Assemble failed'); return; }
      toast.success('Reel assembled — opening the editor to render.');
      router.push(`/content/hyperframes/${j.draftId}`);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [nodes, edges, title, router]);

  const onConnect = useCallback((c: Connection) => setEdges((es) => addEdge({ ...c, animated: true }, es)), [setEdges]);

  const addNode = useCallback((type: string) => {
    const id = `${type}-${Date.now().toString(36)}`;
    setNodes((ns) => [...ns, { id, type, position: { x: 120 + Math.random() * 220, y: 100 + Math.random() * 180 }, data: defaultData(type) }]);
  }, [setNodes]);

  const ctx = useMemo<CanvasActions>(() => ({ updateNode, runNode, assemble, assets }), [updateNode, runNode, assemble, assets]);
  const nodeTypes = useMemo(() => ({ prompt: PromptNode, image: ImageNode, video: VideoNode, asset: AssetNode, assembly: AssemblyNode }), []);

  return (
    <Ctx.Provider value={ctx}>
      <div className="relative rounded-xl border border-border overflow-hidden" style={{ height: 'calc(100vh - 210px)', minHeight: 520 }}>
        <div className="absolute z-10 top-3 left-3 flex flex-wrap gap-1.5">
          {([
            ['prompt', 'Prompt', Type],
            ['image', 'Image', ImageIcon],
            ['video', 'Video', Film],
            ['asset', 'Asset', FileText],
            ['assembly', 'Assemble', Layers],
          ] as const).map(([t, label, Icon]) => (
            <button key={t} onClick={() => addNode(t)} className="btn btn-secondary btn-sm inline-flex items-center gap-1 shadow-sm">
              <Icon size={12} /> {label}
            </button>
          ))}
        </div>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={onConnect}
          nodeTypes={nodeTypes}
          onInit={(inst) => { rf.current = inst; if (initialViewport) inst.setViewport(initialViewport); }}
          fitView
          minZoom={0.2}
        >
          <Background />
          <Controls />
          <MiniMap pannable zoomable />
        </ReactFlow>
      </div>
    </Ctx.Provider>
  );
}
