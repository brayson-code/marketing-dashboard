'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, Sparkles } from 'lucide-react';
import { CleanSections } from './clean-sections';

// A clean, readable popup for the reel-analyst's "why it won" teardown — instead
// of a big inline dropdown that fills the grid. Rendering (green headers, tidy
// bullets, stripped markdown) lives in the shared CleanSections component.
export function TeardownModal({ teardown, handle, onClose }: { teardown: string; handle: string; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = prev; };
  }, [onClose]);

  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4 bg-black/70 backdrop-blur-sm animate-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Why it Won"
    >
      <div
        className="panel relative w-full max-w-lg max-h-[82vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="panel-header flex items-center gap-2">
          <Sparkles size={15} className="text-[var(--primary)]" />
          <h3 className="text-h2">Why it Won</h3>
          {handle && handle !== '—' && <span className="text-micro text-muted-foreground">@{handle}</span>}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto p-1 rounded text-muted-foreground hover:text-foreground"
            style={{ transition: 'color var(--t-popover) var(--ease-out)' }}
          >
            <X size={16} />
          </button>
        </div>

        <div className="panel-body overflow-y-auto">
          <CleanSections text={teardown} />
        </div>
      </div>
    </div>,
    document.body,
  );
}
