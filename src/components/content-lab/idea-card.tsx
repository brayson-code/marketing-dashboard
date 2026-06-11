'use client';

import {
  Check, X, FileText, Loader2, ExternalLink, Sparkles,
} from 'lucide-react';
import { REEL_TAGS } from '@/lib/reel-tags';
import type { ReelIdea } from '@/app/content-lab/page';

// One trial reel concept as a card. Shows the hook (bold), the angle, a format
// badge + an optional trend chip (colored when it maps to a known REEL_TAG), and
// the muted rationale. Actions depend on status:
//   proposed → Keep / Dismiss
//   kept     → Write script  (→ View draft once a script_draft_id lands)
// Dismissed ideas are filtered out upstream, so this card never renders them.

export interface IdeaCardProps {
  idea: ReelIdea;
  onKeep: () => void;
  onDismiss: () => void;
  onWriteScript: () => void;
  scripting: boolean;
}

export function IdeaCard({ idea, onKeep, onDismiss, onWriteScript, scripting }: IdeaCardProps) {
  const kept = idea.status === 'kept';
  const scripted = idea.script_draft_id != null;
  // The trend tag may be a known REEL_TAG slug (→ render in its color) or a free
  // label; either way show it as a chip.
  const tagDef = idea.trend_tag ? REEL_TAGS[idea.trend_tag] : undefined;
  const trendLabel = tagDef?.label ?? idea.trend_tag ?? null;
  const trendColor = tagDef?.color;

  return (
    <div className="panel flex flex-col card-hover">
      <div className="p-3.5 flex flex-col gap-2.5 flex-1">
        {/* status pill (only once a decision is made) */}
        {kept && (
          <span className="badge badge-success text-[10px] self-start inline-flex items-center gap-1">
            <Check size={10} /> Kept
          </span>
        )}

        {/* hook */}
        <p className="text-sm font-semibold leading-snug text-foreground">{idea.hook}</p>

        {/* angle */}
        {idea.angle && (
          <p className="text-xs leading-relaxed text-foreground/85">{idea.angle}</p>
        )}

        {/* format badge + trend chip */}
        <div className="flex flex-wrap items-center gap-1.5">
          {idea.format && (
            <span className="badge badge-neutral text-[10px]">{idea.format}</span>
          )}
          {trendLabel && (
            <span
              className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium leading-none border"
              style={trendColor
                ? {
                    background: `color-mix(in srgb, ${trendColor} 14%, transparent)`,
                    color: trendColor,
                    borderColor: `color-mix(in srgb, ${trendColor} 55%, transparent)`,
                  }
                : undefined}
            >
              <Sparkles size={9} /> {trendLabel}
            </span>
          )}
        </div>

        {/* rationale */}
        {idea.rationale && (
          <p className="text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap border-t border-border/40 pt-2 mt-0.5">
            {idea.rationale}
          </p>
        )}

        {/* actions */}
        <div className="mt-auto pt-1.5 flex items-center gap-2">
          {!kept ? (
            <>
              <button
                type="button"
                onClick={onKeep}
                className="btn btn-primary btn-sm flex-1"
              >
                <Check size={12} /> Keep
              </button>
              <button
                type="button"
                onClick={onDismiss}
                title="Dismiss this concept"
                aria-label="Dismiss"
                className="btn btn-ghost btn-sm shrink-0 !px-2"
              >
                <X size={13} />
              </button>
            </>
          ) : scripted ? (
            <a href="/scripts" className="btn btn-ghost btn-sm w-full">
              <FileText size={12} /> View draft <ExternalLink size={11} className="opacity-60" />
            </a>
          ) : (
            <button
              type="button"
              onClick={onWriteScript}
              disabled={scripting}
              className="btn btn-primary btn-sm w-full"
            >
              {scripting
                ? <><Loader2 size={12} className="animate-spin" /> Writing script…</>
                : <><FileText size={12} /> Write script</>}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
