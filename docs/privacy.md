# Privacy Policy

**Effective date:** June 15, 2026
**Last updated:** June 15, 2026

> **Template notice.** This policy is a thorough starting draft tailored to the KeyPlayers Command Center. It is **not legal advice** and must be reviewed by qualified counsel — and the bracketed placeholders (legal entity, governing law, contact addresses) completed — before you rely on it. Laws that may apply include the EU/UK GDPR, the California Consumer Privacy Act as amended (CCPA/CPRA), and U.S. messaging laws (TCPA, CAN-SPAM).

This Privacy Policy explains how **[Company Legal Name]** ("KeyPlayers," "we," "us") collects, uses, shares, and protects information in connection with the KeyPlayers Command Center (the "Service") at `command.keyplayershq.com`.

---

## 1. Who we are and our two roles

The Command Center is a multi-tenant, AI-agent platform for marketing and sales operations. Our privacy responsibilities depend on the data:

- **As a data controller** — for information about you as our customer/account holder (your account, billing, and how you use the Service), we decide why and how it is processed.
- **As a data processor / service provider** — for the **Workspace Data** you and your AI agents load into or generate inside the Service (leads, contacts, messages, content, knowledge graph, etc.), **you are the controller** and we process it on your behalf and on your instructions, under our Terms of Service and any applicable Data Processing Addendum (DPA).

If you are an individual whose data a customer has loaded into the Service (for example, a lead or contact), please direct privacy requests to that customer; we will assist them as our agreement requires.

---

## 2. Information we process

**Account & identity data.** Name, email address, authentication identifiers. You can sign in with email/password or Google (via Supabase Auth); for Google sign-in we receive your basic profile and email from Google to create and secure your account.

**Workspace configuration.** Your business profile, settings, agent definitions, playbooks, goals, and preferences.

**Workspace Data (customer content).** Data you import, connect, or your agents create or collect, which may include:
- CRM/leads and contacts (names, email addresses, phone numbers, company, notes);
- Messages and conversations across connected channels (SMS, iMessage, email, social comments and DMs);
- Generated content (drafts, scripts, posts, documents), the knowledge graph, reports, and campaign/mission records.

**Connected-account credentials & tokens.** API keys and OAuth tokens for the integrations you enable (see §6). Secrets are **encrypted at rest** and never displayed back to you in full.

**Usage, billing & technical data.** Subscription and payment status (processed by Stripe — we do not store full card numbers), AI token usage and cost, audit logs, IP address, device/browser information, and diagnostic logs.

**Cookies.** We use strictly-necessary cookies for authentication and session security, and may use privacy-respecting product analytics (see §11).

---

## 3. How we use information

We process information to:
- provide, secure, and operate the Service and its AI agents;
- authenticate you and enforce per-workspace ("tenant") isolation;
- run the automations, integrations, and agent actions you configure or approve;
- process payments and manage subscriptions;
- monitor usage, prevent abuse, debug, and improve reliability and features;
- provide support and send service communications;
- comply with legal obligations and enforce our Terms.

**Legal bases (GDPR).** Depending on the processing: performance of our contract with you; our legitimate interests in operating and securing the Service; your consent (e.g., optional integrations); and compliance with legal obligations.

---

## 4. AI processing and your prompts/content

The Service uses **Anthropic's Claude** models to power its agents. When agents run, relevant Workspace Data and prompts are sent to Anthropic's API to generate responses.

- Many workspaces use a **bring-your-own-key** model: agent calls run against **your own Anthropic API key**, under your agreement with Anthropic.
- We do **not** use your Workspace Data to train our own models. Anthropic's API does not train models on inputs/outputs submitted through it in the default course of providing the API; see Anthropic's terms for details.
- AI output can be inaccurate or incomplete. Approval queues exist so a human can review sensitive actions before they take effect; you remain responsible for actions your agents take (see the Terms of Service).

---

## 5. How information is shared

We share information only as needed to run the Service:
- **Sub-processors / service providers** that host and power the Service (§6), under contracts that restrict their use of the data.
- **Integrations you enable** — when you connect a third party (e.g., Google, Twilio, a social platform), data flows to/from that provider per your configuration and *their* privacy policies.
- **Within your workspace** — other authorized members of your tenant.
- **Legal / safety** — to comply with law, enforce our Terms, or protect rights, safety, and security.
- **Business transfers** — in a merger, acquisition, or asset sale, subject to this policy.

We do **not** sell your personal information, and we do not "share" it for cross-context behavioral advertising as defined by the CCPA/CPRA.

---

## 6. Sub-processors and integrations

We rely on the following providers. Those marked **Core** process data for every workspace; the rest process data only when you connect/enable them.

| Provider | Role | Data involved |
|---|---|---|
| **Anthropic** (Core) | Claude AI model inference | Prompts + relevant Workspace Data |
| **Supabase** (Core) | Database, authentication, storage | All Workspace Data, account data |
| **Vercel** (Core) | Application hosting & compute | Requests, logs, technical data |
| **Stripe** (Core, if billed) | Payments & subscriptions | Billing contact, payment status (no full card data stored by us) |
| **Twilio** | SMS send/receive | Recipient phone numbers, message content |
| **LoopMessage** | iMessage send/receive | Recipient identifiers, message content |
| **Google Workspace** (via **Nango**) | Gmail, Drive, Docs, Sheets, Calendar, Meet | Content you act on in your Google account (see §7) |
| **AgentMail** | Agent email inboxes | Email addresses, message content |
| **Nango** | OAuth connection management | OAuth tokens, connection metadata |
| **X, LinkedIn, Meta/Instagram, TikTok** | Social posting & engagement | Account tokens, post/comment content, analytics |
| **Telegram** | Notifications | Chat ID, notification content |
| **Apify** | Competitor content scraping | Public competitor content/URLs |
| **Deepgram** | Speech-to-text | Audio from reels you analyze |
| **HeyGen** (Hyperframes) | Video generation | Scripts/briefs you submit |
| **Google Analytics 4 / Plausible** | Product/web analytics | Usage events, IP-derived data |
| **MCP servers you connect** | Custom agent tools | Whatever you route to them |

A current sub-processor list is available on request at **[privacy@keyplayershq.com]**. We require sub-processors to protect data consistent with this policy.

---

## 7. Google user data (Limited Use)

When you connect Google Workspace, your agents may access Gmail, Drive, Docs, Sheets, Calendar, and Meet using the OAuth scopes you grant. Our use of information received from Google APIs adheres to the **[Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy)**, including its **Limited Use** requirements. Specifically, we use Google user data only to provide and improve the features you enabled, do not transfer or sell it for advertising, do not use it to train generalized AI models, and only allow humans to access it with your consent, for security/abuse/legal reasons, or in aggregated/anonymized form. You can revoke access at any time on the Connections page or via your Google Account settings.

---

## 8. International transfers

We and our sub-processors may process data in the United States and other countries. Where required, we rely on appropriate safeguards (such as the EU Standard Contractual Clauses) for transfers of personal data out of the EEA/UK.

---

## 9. Security

We implement administrative, technical, and physical safeguards, including:
- **Encryption in transit** (TLS) and **encryption at rest**; connected-account secrets are encrypted with **AES-256-GCM** under a dedicated key and never returned in full;
- **Tenant isolation** enforced at the database layer with Row-Level Security (RLS);
- least-privilege access controls and audit logging of sensitive actions;
- approval gates that keep a human in the loop for risky agent actions.

No system is perfectly secure; we cannot guarantee absolute security. If we become aware of a breach affecting your personal data, we will notify you as required by law.

---

## 10. Data retention

We retain Workspace Data for as long as your workspace is active, then per your instructions and our Terms. Account and billing records are retained as needed for legal, tax, and accounting purposes. You can **export your workspace data at any time** from **Settings → Export your data**, and you can request deletion as described below. On account closure we delete or anonymize personal data within a commercially reasonable period, except where retention is legally required.

---

## 11. Cookies and analytics

We use **strictly-necessary cookies** to keep you signed in and protect sessions. We may use privacy-respecting analytics (e.g., Plausible) and/or Google Analytics 4 to understand product usage. Where required, we will request consent for non-essential analytics. You can control cookies through your browser settings.

---

## 12. Your rights

Subject to your location and role (controller vs. the workspace owner), you may have rights to:
- **access, correct, delete, or export** your personal data (portability);
- **object to or restrict** certain processing, and **withdraw consent**;
- **opt out** of sale/sharing and certain profiling (CCPA/CPRA) — note that we do not sell personal data;
- **lodge a complaint** with your supervisory authority.

To exercise rights, email **[privacy@keyplayershq.com]**. We will verify your request and respond within the timeframes required by law. If your data sits inside a customer's workspace, we will refer or assist that customer as the controller. We will not discriminate against you for exercising your rights.

---

## 13. Children

The Service is for business use and is **not directed to children under 16**. We do not knowingly collect personal data from children. If you believe a child has provided us data, contact us and we will delete it.

---

## 14. Changes to this policy

We may update this policy from time to time. Material changes will be announced in-app or by email, and the "Last updated" date above will change. Continued use after changes take effect constitutes acceptance.

---

## 15. Contact

**[Company Legal Name]**
Privacy: **[privacy@keyplayershq.com]**
Mailing address: **[Company mailing address]**
Data Protection Officer / EU-UK Representative (if applicable): **[name / contact]**
