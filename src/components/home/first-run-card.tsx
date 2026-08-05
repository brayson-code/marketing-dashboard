import Link from 'next/link';
import { ArrowRight, ClipboardCheck, Sparkles } from 'lucide-react';
import type { FirstRunCard as Card } from '@/lib/first-run';

// The first thing each person sees on day one. PRESENTATIONAL ONLY.
//
// ── WHY THIS TAKES A PROP INSTEAD OF FETCHING ───────────────────────────────
// It used to call getSubject() and getFounderProfile() itself, which was wrong in a way
// that produced no error. The tenant context is established with enterTenant() in the
// PAGE body and lives in AsyncLocalStorage; a child server component renders outside
// that scope, so currentUserId() came back null (silently downgrading every viewer to
// the least-privilege 'va' branch) and tenantId() fell through to DEFAULT_TENANT_ID —
// meaning every client would have been shown HQ's founder profile.
//
// Anything needing tenant scope must be resolved in the page, where the context exists,
// and handed down. Nothing here touches the database.

export function FirstRunCard({ card }: { card: Card | null }) {
  if (!card) return null;

  const Icon = card.tone === 'confirm' ? ClipboardCheck : Sparkles;

  return (
    <div
      className="panel p-4 flex items-start gap-3"
      style={{
        background: 'color-mix(in srgb, var(--primary) 6%, transparent)',
        borderColor: 'color-mix(in srgb, var(--primary) 25%, transparent)',
      }}
    >
      <Icon size={17} className="text-[var(--primary)] shrink-0 mt-0.5" />
      <div className="flex-1 min-w-0 space-y-2">
        <div>
          <p className="text-sm font-semibold">{card.title}</p>
          <p className="text-xs text-muted-foreground max-w-prose">{card.body}</p>
        </div>

        {card.items.length > 0 && (
          <ul className="space-y-1">
            {card.items.slice(0, 5).map((item) => (
              <li key={item} className="text-xs text-muted-foreground flex items-start gap-1.5">
                <span className="text-[var(--primary)] mt-px">·</span>
                <span>{item}</span>
              </li>
            ))}
            {card.items.length > 5 && (
              <li className="text-[11px] text-muted-foreground pl-3">
                and {card.items.length - 5} more
              </li>
            )}
          </ul>
        )}

        <Link
          href={card.ctaHref}
          className="inline-flex items-center gap-1.5 text-xs font-medium text-[var(--primary)]"
        >
          {card.ctaLabel} <ArrowRight size={12} />
        </Link>
      </div>
    </div>
  );
}
