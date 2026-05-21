'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { Send, Phone, AlertCircle, ArrowDownToLine, ArrowUpFromLine, MessageSquare, Network, Sparkles, Paperclip, X, Loader2, ImageIcon, Info } from 'lucide-react';
import { AgentChat } from '@/components/chat/agent-chat';
import { MissionControlChat } from '@/components/chat/mission-control-chat';
import { createClient } from '@/lib/supabase/client';

type Tab = 'imessage' | 'mission' | 'a2a';

type Direction = 'in' | 'out';

interface Attachment {
  url: string;
  type?: string;
  storage_path?: string;
  name?: string;
}

interface MessageUsage { input: number; output: number; cost_usd: number; model?: string }

interface BoardroomMessage {
  id: number;
  direction: Direction;
  sender: string;
  recipient: string | null;
  text: string;
  loop_message_id: string | null;
  status: string | null;
  attachments?: Attachment[] | null;
  metadata?: { usage?: MessageUsage } | null;
  // Supabase returns timestamptz as ISO strings; tolerate legacy unix numbers too.
  created_at: string | number;
}

function parseUsage(meta: unknown): MessageUsage | null {
  if (!meta || typeof meta !== 'object') return null;
  let m = meta as Record<string, unknown>;
  if (typeof m === 'string') { try { m = JSON.parse(m); } catch { return null; } }
  const u = (m as { usage?: unknown }).usage;
  if (!u || typeof u !== 'object') return null;
  const usage = u as Record<string, unknown>;
  if (typeof usage.input !== 'number' || typeof usage.output !== 'number') return null;
  return {
    input: usage.input,
    output: usage.output,
    cost_usd: typeof usage.cost_usd === 'number' ? usage.cost_usd : 0,
    model: typeof usage.model === 'string' ? usage.model : undefined,
  };
}

interface BoardroomResponse {
  configured: boolean;
  owner_phone: string | null;
  messages: BoardroomMessage[];
}

const STORAGE_BUCKET = 'boardroom-uploads';
// V1 is single-tenant; the browser needs the tenant id as the object path prefix
// so the storage RLS policy (folder == one of my tenants) passes.
const TENANT_ID = process.env.NEXT_PUBLIC_DEFAULT_TENANT_ID || 'fff35ccb-d1da-4fef-b8cb-e363fe1b8e14';
const SIGNED_URL_TTL = 60 * 60 * 24 * 7; // 7 days — outlives any orchestrator run

function parseAttachments(raw: unknown): Attachment[] {
  if (!raw) return [];
  let v = raw;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch { return []; } }
  if (!Array.isArray(v)) return [];
  return v
    .filter((a): a is Record<string, unknown> => !!a && typeof a === 'object' && typeof (a as Record<string, unknown>).url === 'string')
    .map((a) => ({
      url: a.url as string,
      type: typeof a.type === 'string' ? a.type : undefined,
      storage_path: typeof a.storage_path === 'string' ? a.storage_path : undefined,
      name: typeof a.name === 'string' ? a.name : undefined,
    }));
}

function isImage(att: Attachment): boolean {
  if ((att.type ?? '').startsWith('image/')) return true;
  return /\.(png|jpe?g|gif|webp)$/i.test((att.storage_path ?? att.url ?? '').split('?')[0]);
}

function formatTs(ts: string | number): string {
  const d = new Date(typeof ts === 'number' ? ts * 1000 : Date.parse(ts));
  return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function IMessageThread() {
  const [data, setData] = useState<BoardroomResponse | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [staged, setStaged] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(0);
  const [dragOver, setDragOver] = useState(false);
  const [openInfo, setOpenInfo] = useState<number | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/boardroom/messages?limit=200', { cache: 'no-store' });
      const json = (await res.json()) as BoardroomResponse;
      setData(json);
    } catch (err) {
      setError((err as Error).message);
    }
  }, []);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [data?.messages.length, sending]);

  // Upload an image to Supabase Storage and stage a signed-URL attachment.
  const uploadFiles = useCallback(async (files: File[]) => {
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;
    setError(null);
    setUploading((n) => n + images.length);
    const supabase = createClient();
    for (const file of images) {
      try {
        const safe = file.name.replace(/[^\w.\-]+/g, '_') || 'image.png';
        const path = `${TENANT_ID}/${crypto.randomUUID()}-${safe}`;
        const up = await supabase.storage.from(STORAGE_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
        if (up.error) throw up.error;
        const signed = await supabase.storage.from(STORAGE_BUCKET).createSignedUrl(path, SIGNED_URL_TTL);
        if (signed.error || !signed.data) throw signed.error ?? new Error('Could not sign URL');
        setStaged((prev) => [...prev, { url: signed.data.signedUrl, type: file.type, storage_path: path, name: file.name }]);
      } catch (err) {
        setError(`Upload failed: ${(err as Error).message}`);
      } finally {
        setUploading((n) => Math.max(0, n - 1));
      }
    }
  }, []);

  function handlePaste(e: React.ClipboardEvent) {
    const files = Array.from(e.clipboardData.files);
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      uploadFiles(files);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    uploadFiles(Array.from(e.dataTransfer.files));
  }

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if ((!draft.trim() && staged.length === 0) || sending || uploading > 0) return;
    setSending(true);
    setError(null);
    const text = draft.trim();
    const attachments = staged;
    // Optimistically clear the composer.
    setDraft('');
    setStaged([]);
    try {
      const res = await fetch('/api/boardroom/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, attachments }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        setError(json.error || `KeyPlayer couldn't respond (${res.status})`);
      }
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSending(false);
    }
  }

  const messages = data?.messages ?? [];
  const ownerPhone = data?.owner_phone;
  const configured = data?.configured ?? false;
  const canSend = (draft.trim().length > 0 || staged.length > 0) && uploading === 0 && !sending;

  return (
    <div
      className="space-y-3"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <div className="flex items-center justify-end gap-3 text-xs text-muted-foreground flex-wrap">
        {ownerPhone && (
          <span className="badge badge-neutral inline-flex items-center gap-1.5">
            <Phone size={11} /> {ownerPhone}
          </span>
        )}
        <span className={`badge ${configured ? 'badge-success' : 'badge-warning'}`}>
          {configured ? 'LoopMessage connected' : 'Not configured'}
        </span>
      </div>

      {!configured && (
        <div className="panel p-3 flex items-start gap-2 text-xs">
          <AlertCircle size={14} className="text-warning mt-0.5 shrink-0" />
          <div>
            <div className="font-medium">LoopMessage is not configured.</div>
            <div className="text-muted-foreground mt-1">
              Set <code className="text-foreground">LOOPMESSAGE_AUTH_KEY</code> and <code className="text-foreground">KEYPLAYERS_OWNER_PHONE</code> in <code className="text-foreground">.env.local</code> and restart.
            </div>
          </div>
        </div>
      )}

      <div className="panel flex flex-col" style={{ height: 'calc(100vh - 260px)', minHeight: 400 }}>
        <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 space-y-3">
          {messages.length === 0 && (
            <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
              No messages yet. Send the first one below — or wait for an agent to ping you.
            </div>
          )}
          {messages.map((m) => {
            const mine = m.direction === 'in';
            const atts = parseAttachments(m.attachments).filter(isImage);
            const usage = parseUsage(m.metadata);
            const infoOpen = openInfo === m.id;
            return (
              <div key={m.id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                <div
                  className={`max-w-[78%] rounded-2xl px-3.5 py-2 text-sm leading-snug ${
                    mine
                      ? 'bg-[var(--bubble-mine)] text-[var(--bubble-mine-foreground)]'
                      : 'bg-[var(--surface-2)] text-foreground border border-border/60'
                  }`}
                >
                  <div className="flex items-center gap-1.5 text-[10px] opacity-80 mb-0.5">
                    {mine ? <ArrowUpFromLine size={10} /> : <ArrowDownToLine size={10} />}
                    <span className="font-medium">{mine ? 'You' : m.sender || 'agent'}</span>
                    <span>·</span>
                    <span>{formatTs(m.created_at)}</span>
                    {m.status && !mine && <><span>·</span><span>{m.status}</span></>}
                    {usage && (
                      <button
                        type="button"
                        onClick={() => setOpenInfo(infoOpen ? null : m.id)}
                        className="ml-0.5 inline-flex items-center hover:opacity-100 opacity-70"
                        title="Token cost for this reply"
                        aria-label="Token cost"
                      >
                        <Info size={11} />
                      </button>
                    )}
                  </div>
                  {atts.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1.5">
                      {atts.map((a, i) => (
                        // eslint-disable-next-line @next/next/no-img-element
                        <a key={i} href={a.url} target="_blank" rel="noreferrer" title={a.name}>
                          <img
                            src={a.url}
                            alt={a.name ?? 'attachment'}
                            className="rounded-lg max-h-44 max-w-[220px] object-cover border border-black/10"
                          />
                        </a>
                      ))}
                    </div>
                  )}
                  {m.text && <div className="whitespace-pre-wrap break-words">{m.text}</div>}
                  {usage && infoOpen && (
                    <div className="mt-1.5 pt-1.5 border-t border-current/15 text-[10px] font-mono opacity-90 space-y-0.5">
                      <div>{usage.input.toLocaleString()} in · {usage.output.toLocaleString()} out · {(usage.input + usage.output).toLocaleString()} tokens</div>
                      <div>≈ {usage.cost_usd < 0.01 ? '<$0.01' : `$${usage.cost_usd.toFixed(4)}`}{usage.model ? ` · ${usage.model}` : ''}</div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[78%] rounded-2xl px-3.5 py-2 text-xs bg-[var(--surface-2)] text-muted-foreground border border-border/60 inline-flex items-center gap-2">
                <Loader2 size={12} className="animate-spin" /> KeyPlayer is looking…
              </div>
            </div>
          )}
        </div>

        <div className="border-t border-border/60 p-3 space-y-2">
          {(staged.length > 0 || uploading > 0) && (
            <div className="flex flex-wrap gap-2">
              {staged.map((a, i) => (
                <div key={i} className="relative group">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={a.url} alt={a.name ?? 'staged'} className="h-14 w-14 rounded-lg object-cover border border-border/60" />
                  <button
                    type="button"
                    onClick={() => setStaged((prev) => prev.filter((_, j) => j !== i))}
                    className="absolute -top-1.5 -right-1.5 bg-foreground text-background rounded-full p-0.5 shadow"
                    aria-label="Remove attachment"
                  >
                    <X size={11} />
                  </button>
                </div>
              ))}
              {uploading > 0 && (
                <div className="h-14 w-14 rounded-lg border border-dashed border-border/60 flex items-center justify-center text-muted-foreground">
                  <Loader2 size={16} className="animate-spin" />
                </div>
              )}
            </div>
          )}

          <form onSubmit={handleSend} className="flex gap-2 items-end">
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              className="hidden"
              onChange={(e) => { uploadFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={sending}
              className="btn btn-ghost shrink-0"
              title="Attach an image"
            >
              <Paperclip size={15} />
            </button>
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onPaste={handlePaste}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault();
                  handleSend(e as unknown as React.FormEvent);
                }
              }}
              placeholder="Ask KeyPlayer anything — paste or drop a screenshot for it to read…"
              disabled={sending}
              rows={2}
              className="flex-1 resize-none"
            />
            <button type="submit" disabled={!canSend} className="btn btn-primary">
              <Send size={14} /> {sending ? 'Thinking…' : 'Send'}
            </button>
          </form>

          <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
            <ImageIcon size={11} /> KeyPlayer can see images you paste, drop, or attach.
            {!configured && <span className="text-warning">· iMessage replies need LoopMessage configured.</span>}
          </div>
        </div>

        {error && (
          <div className="px-4 pb-3 text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle size={12} /> {error}
          </div>
        )}
      </div>

      {dragOver && (
        <div className="fixed inset-0 z-50 pointer-events-none flex items-center justify-center bg-primary/10 border-4 border-dashed border-primary/40">
          <div className="panel px-6 py-4 text-sm font-medium flex items-center gap-2">
            <ImageIcon size={16} className="text-primary" /> Drop image to share with KeyPlayer
          </div>
        </div>
      )}
    </div>
  );
}

const TABS: { id: Tab; label: string; icon: typeof MessageSquare; description: string }[] = [
  { id: 'imessage', label: 'iMessage', icon: MessageSquare, description: 'You ↔ orchestrator over iMessage' },
  { id: 'mission', label: 'Mission Control', icon: Sparkles, description: 'Operator ↔ orchestrator (in-app)' },
  { id: 'a2a', label: 'Agent ↔ Agent', icon: Network, description: 'Bridge threads between agents' },
];

export default function BoardroomPage() {
  const [tab, setTab] = useState<Tab>('imessage');
  const active = TABS.find((t) => t.id === tab)!;

  return (
    <div className="space-y-4 animate-in">
      <div className="space-y-1">
        <h1 className="text-xl font-semibold">Boardroom</h1>
        <p className="text-xs text-muted-foreground">{active.description}</p>
      </div>

      <div className="flex items-center gap-1 border-b border-border">
        {TABS.map((t) => {
          const Icon = t.icon;
          const isActive = t.id === tab;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={`tab inline-flex items-center gap-1.5 ${isActive ? 'active' : ''}`}
            >
              <Icon size={13} /> {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'imessage' && <IMessageThread />}
      {tab === 'mission' && <MissionControlChat />}
      {tab === 'a2a' && <AgentChat />}
    </div>
  );
}
