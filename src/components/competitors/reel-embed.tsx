'use client';

import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X, ExternalLink, Instagram } from 'lucide-react';

// In-app Instagram playback. We NEVER download or re-host the video — we embed
// Instagram's own /embed/ page in an iframe, which renders the reel with its real
// cover + an inline play button and plays right inside the modal.

/** Pull the shortcode out of an IG reel/post/tv/p URL, or null when there's none. */
export function extractShortcode(url: string): string | null {
  if (!url) return null;
  const m = url.match(/\/(reel|reels|p|tv)\/([^/?#]+)/i);
  return m ? m[2] : null;
}

/** Instagram embed URL for a reel/post URL. Reels embed under /reel/<code>/embed/,
 *  everything else under /p/<code>/embed/. Null when no shortcode is extractable. */
export function instagramEmbedUrl(url: string): string | null {
  const m = url?.match(/\/(reel|reels|p|tv)\/([^/?#]+)/i);
  if (!m) return null;
  const kind = m[1].toLowerCase();
  const type = kind === 'reel' || kind === 'reels' ? 'reel' : 'p';
  return `https://www.instagram.com/${type}/${m[2]}/embed/`;
}

// Centered overlay that plays the reel inside IG's own embed iframe. Backdrop
// click, the close X, and Escape all dismiss it.
export function ReelPlayerModal({ url, onClose }: { url: string; onClose: () => void }) {
  const embedUrl = instagramEmbedUrl(url);

  // Escape closes; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [onClose]);

  // Render through a portal to <body> so the fixed overlay covers the VIEWPORT.
  // Rendered in-tree it'd be trapped inside the reel card's `card-hover`
  // transform (a transformed ancestor becomes the containing block for
  // position:fixed), which made the player fill/overflow the card.
  if (typeof document === 'undefined') return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[100] grid place-items-center p-4 bg-black/70 backdrop-blur-sm animate-in"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Reel playback"
    >
      {/* Card — stop propagation so clicks inside don't close it. */}
      <div
        className="relative w-full max-w-[380px]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close X */}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="btn btn-ghost btn-sm absolute -top-10 right-0 text-white/90"
        >
          <X size={16} /> Close
        </button>

        <div className="rounded-xl overflow-hidden bg-black shadow-2xl border border-white/10">
          {embedUrl ? (
            <iframe
              src={embedUrl}
              title="Instagram reel"
              width={400}
              height={620}
              allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
              allowFullScreen
              scrolling="no"
              loading="lazy"
              className="w-full max-h-[80vh] block"
              style={{ border: 0, borderRadius: 12 }}
            />
          ) : (
            <div className="p-8 text-center text-sm text-white/80 grid place-items-center gap-3 min-h-[280px]">
              <Instagram size={28} className="mx-auto opacity-80" />
              <p>Can&apos;t embed this one.</p>
              <a
                href={url}
                target="_blank"
                rel="noreferrer"
                className="btn btn-primary btn-sm"
              >
                Open on Instagram <ExternalLink size={13} />
              </a>
            </div>
          )}
        </div>

        {/* Open-on-IG fallback link (always available when embeddable). */}
        {embedUrl && (
          <a
            href={url}
            target="_blank"
            rel="noreferrer"
            className="mt-2 inline-flex items-center gap-1 text-xs text-white/80 hover:text-white"
            style={{ transition: 'color var(--t-press) var(--ease-out)' }}
            onClick={(e) => e.stopPropagation()}
          >
            Open on Instagram <ExternalLink size={12} />
          </a>
        )}
      </div>
    </div>,
    document.body,
  );
}
