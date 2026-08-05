'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NavRail } from './nav-rail';
import { HeaderBar } from './header-bar';
import { MobileNav } from './mobile-nav';
import { AppShell } from './app-shell';
import { CommandPalette } from '../command-palette';
import { WalkthroughController } from '../walkthrough/walkthrough-controller';
import { createClient } from '@/lib/supabase/client';
import { PrepBanner } from '@/components/layout/prep-banner';

const AUTH_PATHS = ['/login'];

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  // Standalone paths render their own chrome (no dashboard shell / tenant fetches):
  // the login screen, the public /docs knowledge base, and the no-workspace wall
  // (an authed-but-unprovisioned user must not trigger tenant-scoped data loads).
  const isAuthPath = AUTH_PATHS.some((p) => pathname.startsWith(p));
  const isAuthCallback = pathname.startsWith('/auth/'); // set-password, OAuth callbacks
  const isPublicDocs = pathname === '/docs' || pathname.startsWith('/docs/');
  const isPublicLegal = pathname.startsWith('/legal/'); // /legal/privacy, /legal/data-deletion
  const isNoWorkspace = pathname === '/no-workspace';
  const isStandalone = isAuthPath || isAuthCallback || isPublicDocs || isPublicLegal || isNoWorkspace;

  useEffect(() => {
    if (isStandalone) return;
    let cancelled = false;
    const supabase = createClient();
    supabase.auth
      .getUser()
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data?.user) {
          router.replace(`/login?from=${encodeURIComponent(pathname)}`);
          return;
        }
        // Authenticated but no assigned workspace (no JWT tenant claim) → the
        // no-workspace wall. Data is fail-closed server-side (resolveTenant →
        // NO_TENANT) regardless; this is the UX gate, done client-side because the
        // server middleware that would normally redirect is not currently wired.
        const claim = (data.user.app_metadata as Record<string, unknown> | undefined)?.tenant_id;
        if (!(typeof claim === 'string' && claim)) {
          router.replace('/no-workspace');
          return;
        }
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) router.replace(`/login?from=${encodeURIComponent(pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isStandalone, pathname, router]);

  if (isStandalone) {
    return <>{children}</>;
  }

  if (!authChecked) {
    return <div className="min-h-screen" />;
  }

  return (
    <>
      <HeaderBar />
      {/* 100dvh (not vh) so the page tracks the VISIBLE viewport on mobile — without
          it, the bottom of long pages (e.g. the Ideas "Keep" section) sits behind the
          browser chrome and can't be scrolled to. */}
      <div className="flex min-h-[calc(100dvh-var(--header-height))]">
        <NavRail />
        <AppShell>
          {/* Renders only for an assistant in prep — nothing for everyone else. */}
          <PrepBanner />
          {children}
        </AppShell>
      </div>
      <MobileNav />
      <CommandPalette />
      <WalkthroughController />
    </>
  );
}
