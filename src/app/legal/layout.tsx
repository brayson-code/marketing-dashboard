import Link from 'next/link';
import { ArrowUpRight, ShieldCheck } from 'lucide-react';

export const metadata = {
  title: { default: 'Legal', template: '%s · KeyCommand' },
  description:
    'KeyCommand legal center — privacy policy and data deletion instructions for the KeyPlayers Command Center.',
};

// Public legal shell. Deliberately rendered in the LIGHT theme (no `dark` class),
// giving these pages a clean, document-style look distinct from the dark product
// shell — the convention reviewers (Meta, Google) and end users expect for legal
// pages. Rendered OUTSIDE the authenticated app chrome (see layout-content.tsx +
// proxy.ts isPublicPath), so the pages are fully public and indexable.
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-[#0a1c12]">
      {/* Top bar */}
      <header className="sticky top-0 z-40 border-b border-[#e5e7eb] bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-14 max-w-4xl items-center gap-4 px-4 sm:px-6">
          <Link
            href="/legal/privacy"
            className="flex items-center gap-2 font-semibold tracking-tight rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-[#38a169]"
          >
            <span className="grid h-7 w-7 place-items-center rounded-lg border border-[#38a169]/30 bg-[#ecfdf5] text-[#1e5a3e]">
              <ShieldCheck size={15} />
            </span>
            <span>KeyCommand</span>
            <span className="font-normal text-[#6b7280]">Legal</span>
          </Link>

          <nav className="ml-auto flex items-center gap-1 text-[13px]">
            <Link
              href="/legal/privacy"
              className="rounded-lg px-3 py-2 font-medium text-[#374151] transition-colors hover:bg-[#f4f4f5]"
            >
              Privacy
            </Link>
            <Link
              href="/legal/data-deletion"
              className="rounded-lg px-3 py-2 font-medium text-[#374151] transition-colors hover:bg-[#f4f4f5]"
            >
              Data deletion
            </Link>
            <a
              href="https://command.keyplayershq.com"
              className="ml-1 hidden items-center gap-1.5 rounded-lg border border-[#e5e7eb] bg-white px-3 py-2 font-medium text-[#0a1c12] transition-colors hover:bg-[#f4f4f5] sm:inline-flex"
            >
              Open the app <ArrowUpRight size={14} />
            </a>
          </nav>
        </div>
      </header>

      {/* Document body */}
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6 sm:py-16">{children}</main>

      {/* Footer */}
      <footer className="border-t border-[#e5e7eb]">
        <div className="mx-auto flex max-w-3xl flex-col gap-2 px-4 py-8 text-[13px] text-[#6b7280] sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <span>&copy; {new Date().getFullYear()} 1001060863 Ontario Corp. (KeyPlayers HQ)</span>
          <span className="flex items-center gap-4">
            <Link href="/legal/privacy" className="hover:text-[#0a1c12]">
              Privacy
            </Link>
            <Link href="/legal/data-deletion" className="hover:text-[#0a1c12]">
              Data deletion
            </Link>
            <a href="mailto:developer@keyplayershq.com" className="hover:text-[#0a1c12]">
              Contact
            </a>
          </span>
        </div>
      </footer>
    </div>
  );
}
