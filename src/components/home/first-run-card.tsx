import Link from 'next/link';
import { ArrowRight, ClipboardCheck, Sparkles } from 'lucide-react';
import { getFounderProfile } from '@/lib/founder-profile';
import { getSubject } from '@/lib/authz';
import { sql } from '@/lib/db/client';
import { tenantId } from '@/lib/tenant';
import { firstRunCard, type Viewer } from '@/lib/first-run';

// The first thing each person sees on day one. SERVER component, so it renders with the
// page rather than fetching after paint — a "you have not set this up" card that flashes
// in a second late is worse than not having one.
//
// Reads the role from the already-resolved subject, so the client is sent to confirm
// what was captured and the assistant is given the questions still worth asking.
//
// Renders nothing once the essentials are answered. The caller must already be inside
// enterTenant(await resolveTenant()).

export async function FirstRunCard() {
  const [profile, subject] = await Promise.all([getFounderProfile(), getSubject()]);

  let captured = false;
  try {
    const rows = (await sql()`
      SELECT business_profile -> 'onboarding_capture' AS c
      FROM public.tenants WHERE id = ${tenantId()} LIMIT 1
    `) as unknown as Array<{ c: { at?: string } | null }>;
    captured = typeof rows[0]?.c?.at === 'string';
  } catch { /* treated as not captured — the card still renders the cold version */ }

  const answers = profile.answers ?? {};
  const card = firstRunCard({
    viewer: (subject.role as Viewer) ?? 'owner',
    answers,
    captured,
    founderName: (answers as Record<string, string>).name ?? null,
  });

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
