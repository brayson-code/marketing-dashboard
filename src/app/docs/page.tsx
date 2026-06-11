import { notFound } from 'next/navigation';
import { getDoc } from '@/lib/docs-content';
import { Markdown } from '@/components/docs/markdown';
import { DocsToc } from '@/components/docs/docs-toc';

// The docs home — renders README.md. Fully static (content baked at build time).
export const dynamic = 'force-static';

export default function DocsHome() {
  const doc = getDoc('index');
  if (!doc) notFound();

  return (
    <div className="flex gap-10">
      <article className="min-w-0 flex-1 max-w-3xl pb-24">
        <Markdown>{doc.markdown}</Markdown>
      </article>
      <DocsToc headings={doc.headings} />
    </div>
  );
}
