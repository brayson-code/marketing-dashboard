'use client';

import { useEffect } from 'react';
import { useDashboard } from '@/store';
import { LiveFeed } from '@/components/live-feed';
import { HelpWidget } from '@/components/help/help-widget';

export function AppShell({ children }: { children: React.ReactNode }) {
  const { feedOpen, toggleFeed } = useDashboard();

  // Cmd+. to toggle feed
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '.') {
        e.preventDefault();
        toggleFeed();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleFeed]);

  return (
    <>
      <main className={`main-content surface-0 flex-1 ml-[var(--nav-width)] mt-[var(--header-height)] p-3 sm:p-5 pb-20 sm:pb-5 overflow-auto transition-[margin] duration-300 ${
        feedOpen ? 'lg:mr-80' : ''
      }`}>
        {children}
      </main>
      <LiveFeed open={feedOpen} onClose={toggleFeed} />
      <HelpWidget />
    </>
  );
}
