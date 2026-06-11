import Link from 'next/link';
import { ArrowUpRight, BookOpen } from 'lucide-react';
import { DocsSidebar } from '@/components/docs/docs-sidebar';
import { DocsSearch } from '@/components/docs/docs-search';
import { getSearchIndex } from '@/lib/docs-content';

export const metadata = {
  title: { default: 'KeyCommand Docs', template: '%s · KeyCommand Docs' },
  description: 'Learn how to use KeyCommand — the AI marketing command center. Guides for competitors, content, agents, and more.',
};

// Public knowledge-base shell. Forced into the branded dark theme (the `dark`
// class sets the design tokens for this subtree) regardless of the visitor's
// system preference, so the docs always look like the product. This layout is
// rendered OUTSIDE the authenticated app chrome (see layout-content.tsx).
export default function DocsLayout({ children }: { children: React.ReactNode }) {
  const index = getSearchIndex();

  return (
    <div className="dark min-h-screen bg-background text-foreground">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-border bg-[color-mix(in_srgb,var(--background)_82%,transparent)] backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link href="/docs" className="flex items-center gap-2 font-semibold tracking-tight focus-ring rounded-lg">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/15 text-primary border border-primary/30">
              <BookOpen size={15} />
            </span>
            <span className="hidden sm:inline">KeyCommand</span>
            <span className="text-muted-foreground font-normal">Docs</span>
          </Link>

          <div className="ml-auto flex items-center gap-3">
            <DocsSearch index={index} />
            <Link
              href="/"
              className="hidden sm:inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-2 text-[13px] font-medium text-foreground hover:bg-muted/60 transition-colors focus-ring"
            >
              Open the app <ArrowUpRight size={14} />
            </Link>
          </div>
        </div>
      </header>

      {/* Body: sidebar + content (stacked on mobile, side-by-side on desktop) */}
      <div className="mx-auto flex max-w-7xl flex-col lg:flex-row gap-8 px-4 sm:px-6 py-8">
        <aside className="lg:w-[230px] lg:shrink-0">
          <div className="lg:sticky lg:top-20 lg:max-h-[calc(100vh-6rem)] lg:overflow-y-auto lg:pb-8">
            <DocsSidebar />
          </div>
        </aside>

        <main className="min-w-0 flex-1">{children}</main>
      </div>
    </div>
  );
}
