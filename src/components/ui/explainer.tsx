'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Info, X, MessageSquare } from 'lucide-react';

// Dismissible "what is this / when to use" card for surfaces operators find
// confusing (Campaigns, Missions, Goals, Approvals…). Dismissal persists per id
// in localStorage. Renders nothing until the dismissed state is read, so there's
// no flash either way.
export function Explainer({ id, title, what, when, example, say }: {
  id: string;
  title?: string;
  what: ReactNode;
  when?: ReactNode;
  example?: ReactNode;
  /** What to TEXT to do this without opening the app. Most real use of KeyCommand is a
   *  group chat with the orchestrator, so "where do I click" is usually the wrong
   *  answer — this makes the chat-first path visible on the surface itself, matching
   *  /how-it-works. Rendered last, styled apart, and omitted when there's no chat path. */
  say?: ReactNode;
}) {
  const storageKey = `explainer.dismissed.${id}`;
  const [ready, setReady] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try { setDismissed(localStorage.getItem(storageKey) === '1'); } catch { /* ignore */ }
    setReady(true);
  }, [storageKey]);

  if (!ready || dismissed) return null;

  const dismiss = () => {
    try { localStorage.setItem(storageKey, '1'); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <div
      className="panel p-3 flex items-start gap-2.5"
      style={{ background: 'color-mix(in srgb, var(--primary) 6%, transparent)', borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)' }}
    >
      <Info size={15} className="text-[var(--primary)] shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 text-xs space-y-1">
        {title && <div className="font-semibold text-sm">{title}</div>}
        <p className="text-muted-foreground"><span className="text-foreground/90 font-medium">What:</span> {what}</p>
        {when && <p className="text-muted-foreground"><span className="text-foreground/90 font-medium">When to use:</span> {when}</p>}
        {example && <p className="text-muted-foreground"><span className="text-foreground/90 font-medium">Example:</span> {example}</p>}
        {say && (
          <p className="flex items-start gap-1.5 pt-0.5">
            <MessageSquare size={11} className="text-[var(--primary)] shrink-0 mt-[3px]" />
            <span className="text-muted-foreground">
              <span className="text-foreground/90 font-medium">Or just say:</span> {say}
            </span>
          </p>
        )}
      </div>
      <button onClick={dismiss} className="btn btn-ghost btn-sm shrink-0" title="Dismiss"><X size={12} /></button>
    </div>
  );
}
