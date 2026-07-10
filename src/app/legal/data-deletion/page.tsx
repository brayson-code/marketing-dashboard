import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Data Deletion',
  description:
    'How to delete your data from KeyCommand, including data accessed through the Meta (Instagram & Facebook) APIs — disconnect in-app to revoke tokens, or email developer@keyplayershq.com.',
  alternates: { canonical: '/legal/data-deletion' },
};

const UPDATED = 'July 10, 2026';

export default function DataDeletionPage() {
  return (
    <article className="legal-prose">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-wider text-[#38a169]">Legal</p>
      <h1 className="mb-2 font-sans text-[2.2rem] font-bold leading-tight tracking-tight text-[#0a1c12] sm:text-[2.6rem]">
        Data Deletion
      </h1>
      <p className="mb-10 text-[14px] text-[#6b7280]">Last updated: {UPDATED}</p>

      <p className="lead">
        You can delete the data KeyCommand holds about your connected accounts — including everything
        accessed through the Meta (Instagram and Facebook) APIs — at any time. There are two ways to do
        it: disconnect the account inside the app (instant, self-serve), or email us and we will do it
        for you.
      </p>

      <h2 id="option-1">Option 1 — Disconnect in the app (instant)</h2>
      <p>This is the fastest way and revokes our access immediately:</p>
      <ol>
        <li>
          Sign in to KeyCommand at <code>command.keyplayershq.com</code>.
        </li>
        <li>
          Open <strong>Connections</strong> from the left navigation (
          <code>/connections</code>).
        </li>
        <li>
          Find the provider you want to remove (e.g., <strong>Instagram</strong> or{' '}
          <strong>Facebook</strong>) and click <strong>Disconnect</strong>.
        </li>
      </ol>
      <p>When you disconnect a provider, the app does all of the following:</p>
      <ul>
        <li>
          <strong>Revokes the OAuth token.</strong> We call our OAuth provider (Nango) to delete the
          upstream connection, so the stored access token for that account is destroyed and can no
          longer be used to reach the Meta APIs.
        </li>
        <li>
          <strong>Deletes our connection record.</strong> The row that links your workspace to that
          account (provider, connection ID, connection metadata) is deleted from our database.
        </li>
        <li>
          <strong>Stops all access and syncing.</strong> Our agents can no longer publish, read
          comments/DMs, or pull insights for that account, because the credential is gone.
        </li>
      </ul>
      <p>
        <em>Note on permissions:</em> if you are a workspace owner (or billing admin), disconnect takes
        effect immediately. If you are a team member without those rights, the app sends a one-tap
        approval request to the workspace owner, and the disconnect completes as soon as they confirm —
        this exists so a credential is never destroyed by accident.
      </p>
      <p>
        You can also revoke KeyCommand&rsquo;s access from Meta&rsquo;s side at any time via{' '}
        <a
          href="https://accounts.meta.com/"
          target="_blank"
          rel="noreferrer noopener"
        >
          your Meta Accounts Center
        </a>{' '}
        (Instagram/Facebook &rarr; Settings &rarr; Apps and websites), which independently invalidates
        the token.
      </p>

      <h2 id="option-2">Option 2 — Email us</h2>
      <p>
        If you can&rsquo;t sign in, or you want us to delete your data for you, email{' '}
        <a href="mailto:developer@keyplayershq.com?subject=Data%20deletion%20request">
          developer@keyplayershq.com
        </a>{' '}
        with the subject <strong>&ldquo;Data deletion request&rdquo;</strong>. Tell us which account
        (the Instagram/Facebook username, or the email on your KeyCommand account) so we can locate it.
        We will confirm your identity, carry out the deletion described below, and reply to confirm when
        it is complete — normally within 30 days.
      </p>

      <h2 id="what-gets-deleted">What gets deleted</h2>
      <p>Whether you disconnect in-app or ask us by email, deletion removes:</p>
      <ul>
        <li>
          <strong>The OAuth connection and access token</strong> held by our provider Nango for that
          account (revoked and deleted upstream).
        </li>
        <li>
          <strong>The connection record</strong> in our database (provider, connection ID, and
          connection metadata for that account).
        </li>
        <li>
          <strong>Cached content and metrics</strong> we pulled from that account through the Meta
          APIs — including comments, messages, media references, and insights held in your workspace
          for that provider.
        </li>
      </ul>
      <p>
        If you ask us to delete your <strong>entire workspace</strong> (account closure), we
        additionally delete or anonymize all personal data in that workspace, except records we are
        legally required to keep (for example, billing/tax records). See the{' '}
        <Link href="/legal/privacy#retention">Privacy Policy — Data retention</Link> for details.
      </p>

      <h2 id="already-published">A note on content you already published</h2>
      <p>
        Content that was already <em>published to your own Instagram or Facebook account</em> (a post
        you approved) lives on Meta&rsquo;s platform under your control — deleting your KeyCommand data
        does not remove those posts. To take those down, delete them from Instagram/Facebook directly.
        Data deletion here removes what <strong>KeyCommand</strong> stores and our ability to access
        your account.
      </p>

      <h2 id="contact">Contact</h2>
      <p>
        Questions about deletion or privacy? Email{' '}
        <a href="mailto:developer@keyplayershq.com">developer@keyplayershq.com</a>. See also our{' '}
        <Link href="/legal/privacy">Privacy Policy</Link>.
      </p>
    </article>
  );
}
