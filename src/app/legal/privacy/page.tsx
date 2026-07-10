import type { Metadata } from 'next';
import Link from 'next/link';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: 'Privacy Policy',
  description:
    'How KeyCommand collects, uses, retains, and shares data — including data accessed through the Meta (Instagram & Facebook) APIs. We never sell your data.',
  alternates: { canonical: '/legal/privacy' },
};

const UPDATED = 'July 10, 2026';

export default function PrivacyPage() {
  return (
    <article className="legal-prose">
      <p className="mb-2 text-[13px] font-medium uppercase tracking-wider text-[#38a169]">
        Legal
      </p>
      <h1 className="mb-2 font-sans text-[2.2rem] font-bold leading-tight tracking-tight text-[#0a1c12] sm:text-[2.6rem]">
        Privacy Policy
      </h1>
      <p className="mb-10 text-[14px] text-[#6b7280]">Last updated: {UPDATED}</p>

      <p className="lead">
        This Privacy Policy explains how <strong>1001060863 Ontario Corp.</strong>, operating as
        KeyPlayers HQ (&ldquo;KeyPlayers,&rdquo; &ldquo;KeyCommand,&rdquo; &ldquo;we,&rdquo;
        &ldquo;us&rdquo;), collects, uses, retains, shares, and protects information in connection with
        the KeyPlayers Command Center (the &ldquo;Service&rdquo;) at{' '}
        <code>command.keyplayershq.com</code>.
      </p>

      <p>
        KeyCommand provides done-for-you AI marketing command centers. Each client connects{' '}
        <strong>their own</strong> social accounts (including Instagram and Facebook) so our software
        can draft posts for human approval, publish approved content, and read comments and insights
        on the client&rsquo;s behalf. This policy covers all of that, with a dedicated section on data
        we access through the Meta (Instagram and Facebook) APIs.
      </p>

      <h2 id="who-we-are">1. Who we are and our two roles</h2>
      <p>Our privacy responsibilities depend on the data:</p>
      <ul>
        <li>
          <strong>As a data controller</strong> — for information about you as our customer/account
          holder (your account, billing, and how you use the Service), we decide why and how it is
          processed.
        </li>
        <li>
          <strong>As a data processor / service provider</strong> — for the workspace data you and
          your AI agents load into or generate inside the Service (including content pulled from your
          connected social accounts), <strong>you are the controller</strong> and we process it on
          your behalf and on your instructions.
        </li>
      </ul>

      <h2 id="what-we-collect">2. Information we collect</h2>
      <p>
        <strong>Account &amp; identity data.</strong> Name, email address, and authentication
        identifiers. You can sign in with email/password or Google (via Supabase Auth).
      </p>
      <p>
        <strong>Workspace configuration.</strong> Your business profile, settings, agent definitions,
        playbooks, goals, and preferences.
      </p>
      <p>
        <strong>Connected-account tokens.</strong> The OAuth access tokens for the social and other
        accounts you connect. Tokens are held by our OAuth provider, Nango, and are used only to make
        API calls you authorized. They are encrypted at rest and never displayed back to you in full.
      </p>
      <p>
        <strong>Content and analytics from connected accounts.</strong> When you connect an account,
        our agents may draft, publish, and read content and metrics on your behalf — see the Meta data
        section below for exactly what we access from Instagram and Facebook.
      </p>
      <p>
        <strong>Usage, billing &amp; technical data.</strong> Subscription and payment status
        (processed by Stripe — we do not store full card numbers), AI token usage, audit logs, IP
        address, device/browser information, and diagnostic logs.
      </p>

      <h2 id="meta-data">3. Data we access through Meta (Instagram &amp; Facebook) APIs</h2>
      <p>
        When you connect your Instagram Business/Creator account and its linked Facebook Page, you
        grant KeyCommand a set of permissions through Meta&rsquo;s official OAuth flow. Using those
        permissions, we access the following data <strong>only for the connected account</strong> and
        only to power the features you enabled:
      </p>
      <div className="my-6 overflow-x-auto rounded-xl border border-[#e5e7eb]">
        <table className="w-full border-collapse text-[14px]">
          <thead className="bg-[#f9fafb]">
            <tr>
              <th className="px-4 py-2.5 text-left font-semibold">Permission</th>
              <th className="px-4 py-2.5 text-left font-semibold">What we access</th>
              <th className="px-4 py-2.5 text-left font-semibold">Why</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="px-4 py-2.5 align-top">
                <code>instagram_business_basic</code>
              </td>
              <td className="px-4 py-2.5 align-top">
                Account profile (username, account ID, media list)
              </td>
              <td className="px-4 py-2.5 align-top">
                Identify the connected account and show it in your dashboard
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 align-top">
                <code>instagram_business_content_publish</code>
              </td>
              <td className="px-4 py-2.5 align-top">Ability to publish media you approve</td>
              <td className="px-4 py-2.5 align-top">
                Publish posts/reels after a human on your team approves the draft
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 align-top">
                <code>instagram_business_manage_comments</code>
              </td>
              <td className="px-4 py-2.5 align-top">Comments on your media</td>
              <td className="px-4 py-2.5 align-top">
                Show comments in your dashboard and let your team reply
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 align-top">
                <code>instagram_business_manage_messages</code>
              </td>
              <td className="px-4 py-2.5 align-top">Direct messages to your account</td>
              <td className="px-4 py-2.5 align-top">
                Show DMs in your dashboard and let your team respond
              </td>
            </tr>
            <tr>
              <td className="px-4 py-2.5 align-top">
                <code>instagram_business_manage_insights</code>
              </td>
              <td className="px-4 py-2.5 align-top">Reach, impressions, and engagement metrics</td>
              <td className="px-4 py-2.5 align-top">Report on how your content performs</td>
            </tr>
          </tbody>
        </table>
      </div>
      <p>
        We use Meta data <strong>only</strong> to provide the features above to you, the account
        owner. We do <strong>not</strong> sell it, do <strong>not</strong> use it for advertising, and
        do <strong>not</strong> use it to train AI models. You can revoke our access at any time — see{' '}
        <Link href="/legal/data-deletion">Data Deletion</Link>.
      </p>

      <h2 id="how-we-use">4. How we use information</h2>
      <ul>
        <li>Provide, secure, and operate the Service and its AI agents;</li>
        <li>Authenticate you and enforce per-workspace (&ldquo;tenant&rdquo;) isolation;</li>
        <li>Run the automations and agent actions you configure or approve;</li>
        <li>Draft content for human review and publish only what a human approves;</li>
        <li>Process payments, monitor usage, prevent abuse, and provide support;</li>
        <li>Comply with legal obligations and enforce our Terms.</li>
      </ul>

      <h2 id="ai">5. AI processing</h2>
      <p>
        The Service uses Anthropic&rsquo;s Claude models to power its agents. Relevant workspace data
        and prompts are sent to Anthropic&rsquo;s API to generate drafts and responses. Many workspaces
        run against their <strong>own</strong> Anthropic API key. We do <strong>not</strong> use your
        workspace data — including Meta data — to train our own models, and Anthropic does not train on
        API inputs/outputs in the default course of providing the API. AI output can be inaccurate;
        approval queues keep a human in the loop before content is published or messages are sent.
      </p>

      <h2 id="sharing">6. How information is shared — we never sell it</h2>
      <p>
        We <strong>never sell your personal information</strong>, and we do not &ldquo;share&rdquo; it
        for cross-context behavioral advertising. We disclose information only as needed to run the
        Service:
      </p>
      <ul>
        <li>
          <strong>Sub-processors</strong> that host and power the Service, under contracts that
          restrict their use of the data — including <strong>Anthropic</strong> (AI inference),{' '}
          <strong>Supabase</strong> (database, auth, storage), <strong>Vercel</strong> (hosting),{' '}
          <strong>Nango</strong> (OAuth token management), and <strong>Stripe</strong> (billing).
        </li>
        <li>
          <strong>Integrations you enable</strong> — when you connect a third party (e.g., Meta,
          Google), data flows to/from that provider per your configuration and their policies.
        </li>
        <li>
          <strong>Within your workspace</strong> — other authorized members of your tenant.
        </li>
        <li>
          <strong>Legal / safety</strong> — to comply with law, enforce our Terms, or protect rights
          and security.
        </li>
      </ul>

      <h2 id="retention">7. Data retention</h2>
      <p>
        We retain workspace data — including content and metrics cached from your connected accounts —
        for as long as your workspace is active. When you disconnect an account or delete your
        workspace, the associated tokens and cached content are deleted as described in{' '}
        <Link href="/legal/data-deletion">Data Deletion</Link>. Account and billing records are retained
        as needed for legal, tax, and accounting purposes. You can export your workspace data at any
        time from <strong>Settings → Export your data</strong>.
      </p>

      <h2 id="security">8. Security</h2>
      <ul>
        <li>Encryption in transit (TLS) and at rest; connected-account tokens are encrypted and never returned in full;</li>
        <li>Tenant isolation enforced at the database layer with Row-Level Security (RLS);</li>
        <li>Least-privilege access controls and audit logging of sensitive actions;</li>
        <li>Approval gates that keep a human in the loop for publishing and messaging.</li>
      </ul>
      <p>No system is perfectly secure; if we become aware of a breach affecting your personal data, we will notify you as required by law.</p>

      <h2 id="rights">9. Your rights</h2>
      <p>
        Subject to your location, you may have rights to access, correct, delete, or export your
        personal data, to object to or restrict certain processing, and to lodge a complaint with your
        supervisory authority. To exercise rights, email{' '}
        <a href="mailto:developer@keyplayershq.com">developer@keyplayershq.com</a>. If you are in
        Canada, you also have rights under PIPEDA (Office of the Privacy Commissioner of Canada,
        priv.gc.ca).
      </p>

      <h2 id="children">10. Children</h2>
      <p>
        The Service is for business use and is not directed to children under 16. We do not knowingly
        collect personal data from children.
      </p>

      <h2 id="changes">11. Changes to this policy</h2>
      <p>
        We may update this policy from time to time. Material changes will be announced in-app or by
        email, and the &ldquo;Last updated&rdquo; date above will change.
      </p>

      <h2 id="contact">12. Contact</h2>
      <p>
        <strong>1001060863 Ontario Corp.</strong> (KeyPlayers HQ)
        <br />
        Privacy contact: <a href="mailto:developer@keyplayershq.com">developer@keyplayershq.com</a>
        <br />
        Mailing address: 2025 Maria Street, Burlington, ON, Canada L7R 0E9
      </p>
    </article>
  );
}
