// Renders a docs markdown string into styled React. Runs as a Server Component
// (no client JS) so the prose is fully static. Two pieces of smarts:
//   1. Relative ./*.md links are rewritten to /docs/* routes.
//   2. "> _Screenshot: …_" blockquotes become dashed image placeholders, so the
//      docs read as a real product walkthrough even before screenshots land.
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeSlug from 'rehype-slug';
import Link from 'next/link';
import { ImageIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { existingDocImages } from '@/lib/docs-content';

// Dashed "screenshot goes here" card, shown until the real PNG is captured.
function ShotPlaceholder({ caption }: { caption: string }) {
  return (
    <div className="my-6 grid place-items-center rounded-xl border border-dashed border-border bg-muted/40 px-6 py-10 text-center">
      <ImageIcon size={22} className="mb-2 text-muted-foreground" />
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Screenshot</div>
      {caption && <div className="mt-1 max-w-md text-small">{caption}</div>}
    </div>
  );
}

// ./overview.md → /docs/overview · ./README.md → /docs · #anchor and http(s) untouched.
function rewriteHref(href?: string): string {
  if (!href) return '#';
  if (/^(https?:|mailto:|tel:)/.test(href) || href.startsWith('#')) return href;
  const h = href.replace(/^\.\//, '');
  if (/^readme\.md(#.*)?$/i.test(h)) {
    const i = h.indexOf('#');
    return '/docs' + (i >= 0 ? h.slice(i) : '');
  }
  const m = /^([\w-]+)\.md(#.*)?$/.exec(h);
  if (m) return `/docs/${m[1]}${m[2] ?? ''}`;
  return href;
}

function textOf(node: ReactNode): string {
  if (node == null || node === false || node === true) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  const props = (node as { props?: { children?: ReactNode } }).props;
  return props?.children ? textOf(props.children) : '';
}

export function Markdown({ children }: { children: string }) {
  const imgs = existingDocImages();
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      rehypePlugins={[rehypeSlug]}
      components={{
        h1: ({ children }) => (
          <h1 className="text-h1 mt-0 mb-4 text-[2rem] sm:text-[2.4rem] leading-tight">{children}</h1>
        ),
        h2: ({ children, id }) => (
          <h2 id={id} className="scroll-mt-28 text-h2 mt-12 mb-3 pb-2 border-b border-border/60 text-[1.4rem]">
            {children}
          </h2>
        ),
        h3: ({ children, id }) => (
          <h3 id={id} className="scroll-mt-28 mt-8 mb-2 text-[1.1rem] font-semibold tracking-tight">
            {children}
          </h3>
        ),
        p: ({ children }) => <p className="my-4 leading-7 text-[15px] text-foreground/85">{children}</p>,
        a: ({ href, children }) => {
          const to = rewriteHref(href);
          const external = /^https?:/.test(to);
          const cls = 'text-primary underline decoration-primary/30 underline-offset-2 hover:decoration-primary transition-[text-decoration-color] duration-[var(--t-press)]';
          return external ? (
            <a href={to} target="_blank" rel="noreferrer noopener" className={cls}>{children}</a>
          ) : (
            <Link href={to} className={cls}>{children}</Link>
          );
        },
        ul: ({ children }) => <ul className="my-4 ml-5 list-disc space-y-1.5 text-[15px] text-foreground/85 marker:text-muted-foreground">{children}</ul>,
        ol: ({ children }) => <ol className="my-4 ml-5 list-decimal space-y-1.5 text-[15px] text-foreground/85 marker:text-muted-foreground">{children}</ol>,
        li: ({ children }) => <li className="leading-7 pl-1">{children}</li>,
        strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
        em: ({ children }) => <em className="italic text-foreground/90">{children}</em>,
        hr: () => <hr className="my-10 border-border/70" />,
        img: ({ src, alt }) => {
          const raw = typeof src === 'string' ? src : '';
          // Docs screenshots are authored as ![caption](images/<file>.png).
          const docImg = /^\.?\/?images\//.test(raw);
          if (docImg) {
            const file = raw.replace(/^\.?\/?images\//, '');
            if (!imgs.has(file)) return <ShotPlaceholder caption={alt ?? ''} />;
            return (
              <figure className="my-6">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={`/docs-images/${file}`} alt={alt ?? ''} className="rounded-xl border border-border w-full shadow-lg" />
                {alt && <figcaption className="mt-2 text-center text-small">{alt}</figcaption>}
              </figure>
            );
          }
          // eslint-disable-next-line @next/next/no-img-element
          return <img src={raw} alt={alt ?? ''} className="my-6 rounded-xl border border-border w-full" />;
        },
        code: ({ className, children }) => {
          const isBlock = /language-/.test(className ?? '');
          if (isBlock) return <code className="font-mono text-[13px] leading-relaxed">{children}</code>;
          return <code className="rounded-md bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground border border-border/60">{children}</code>;
        },
        pre: ({ children }) => (
          <pre className="my-5 overflow-x-auto rounded-xl border border-border bg-[color-mix(in_srgb,var(--background)_60%,#000)] p-4 text-[13px]">{children}</pre>
        ),
        blockquote: ({ children }) => {
          const t = textOf(children).trim();
          // Legacy "> _Screenshot: …_" placeholders (kept for any not yet
          // converted to ![](images/…) image slots).
          if (/^screenshot[:\s]/i.test(t)) {
            return <ShotPlaceholder caption={t.replace(/^screenshot[:\s]+/i, '').trim()} />;
          }
          return (
            <blockquote className="my-5 border-l-2 border-primary/50 bg-accent/40 rounded-r-lg py-2 pl-4 pr-3 text-[15px] text-foreground/80 [&>p]:my-1">
              {children}
            </blockquote>
          );
        },
        table: ({ children }) => (
          <div className="my-6 overflow-x-auto rounded-xl border border-border">
            <table className="w-full border-collapse text-[14px]">{children}</table>
          </div>
        ),
        thead: ({ children }) => <thead className="bg-muted/60">{children}</thead>,
        tr: ({ children }) => <tr className="border-b border-border/60 last:border-0">{children}</tr>,
        th: ({ children }) => <th className="px-4 py-2.5 text-left font-semibold text-foreground">{children}</th>,
        td: ({ children }) => <td className="px-4 py-2.5 align-top text-foreground/85">{children}</td>,
      }}
    >
      {children}
    </ReactMarkdown>
  );
}
