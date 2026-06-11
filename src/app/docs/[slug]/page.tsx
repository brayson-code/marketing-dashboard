import { notFound } from 'next/navigation';
import Link from 'next/link';
import { ChevronRight } from 'lucide-react';
import { getDoc } from '@/lib/docs-content';
import { allDocSlugs } from '@/lib/docs-nav';
import { Markdown } from '@/components/docs/markdown';
import { DocsToc } from '@/components/docs/docs-toc';

// One static page per doc. generateStaticParams enumerates the curated nav, so
// the routes are prerendered at build time (no runtime filesystem access).
export const dynamic = 'force-static';
export const dynamicParams = false;

export function generateStaticParams() {
  return allDocSlugs().map((slug) => ({ slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  return { title: doc?.title ?? 'Docs' };
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const doc = getDoc(slug);
  if (!doc) notFound();

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 max-w-3xl pb-24">
        {/* Breadcrumb */}
        <nav className="mb-5 flex items-center gap-1.5 text-small">
          <Link href="/docs" className="hover:text-foreground transition-colors">Docs</Link>
          {doc.group && (
            <>
              <ChevronRight size={13} className="text-muted-foreground" />
              <span>{doc.group}</span>
            </>
          )}
          <ChevronRight size={13} className="text-muted-foreground" />
          <span className="text-foreground">{doc.title}</span>
        </nav>

        <Markdown>{doc.markdown}</Markdown>
      </article>
      <DocsToc headings={doc.headings} />
    </div>
  );
}
