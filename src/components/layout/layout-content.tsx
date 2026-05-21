'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { NavRail } from './nav-rail';
import { HeaderBar } from './header-bar';
import { MobileNav } from './mobile-nav';
import { AppShell } from './app-shell';
import { CommandPalette } from '../command-palette';
import { createClient } from '@/lib/supabase/client';

const AUTH_PATHS = ['/login'];

export function LayoutContent({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);

  const isAuthPath = AUTH_PATHS.some((p) => pathname.startsWith(p));

  useEffect(() => {
    if (isAuthPath) return;
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
        setAuthChecked(true);
      })
      .catch(() => {
        if (!cancelled) router.replace(`/login?from=${encodeURIComponent(pathname)}`);
      });
    return () => {
      cancelled = true;
    };
  }, [isAuthPath, pathname, router]);

  if (isAuthPath) {
    return <>{children}</>;
  }

  if (!authChecked) {
    return <div className="min-h-screen" />;
  }

  return (
    <>
      <HeaderBar />
      <div className="flex min-h-[calc(100vh-var(--header-height))]">
        <NavRail />
        <AppShell>{children}</AppShell>
      </div>
      <MobileNav />
      <CommandPalette />
    </>
  );
}
