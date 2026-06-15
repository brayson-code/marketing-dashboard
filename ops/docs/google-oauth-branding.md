# Google sign-in consent screen — branding runbook (2026)

How to make the Google "Sign in" / account-chooser / consent screen say
**KeyPlayers** instead of a bare `zgtiviorskkcuzxnpvha.supabase.co`.

Concrete values for this project:

| Thing | Value |
|---|---|
| Product name to display | **KeyPlayers Command Center** (or just **KeyPlayers**) |
| App URL | `https://command.keyplayershq.com` |
| Supabase project ref | `zgtiviorskkcuzxnpvha` |
| Supabase auth host (default) | `zgtiviorskkcuzxnpvha.supabase.co` |
| Default OAuth callback (Supabase) | `https://zgtiviorskkcuzxnpvha.supabase.co/auth/v1/callback` |
| App callback (allow-listed in Supabase) | `https://command.keyplayershq.com/auth/callback` |

Related existing docs: [google-signin.md](./google-signin.md) (the original
provider-enable steps) and [nango-oauth-setup.md](./nango-oauth-setup.md) (a
*separate* Google client for agent YouTube actions — don't confuse the two).

---

## Problem

When a user clicks **Continue with Google**, the Google consent / account-chooser
screen reads something like:

> **zgtiviorskkcuzxnpvha.supabase.co** wants to access your Google Account

…which looks unbranded and slightly sketchy. We want it to read **KeyPlayers**
with our logo.

## Why it happens

Two independent causes, fixed by two independent steps:

1. **What name/logo Google shows** is taken from the **OAuth consent screen
   "Branding"** of *the Google Cloud project whose OAuth Client ID Supabase is
   using*. If Supabase Google provider is left on Supabase's shared/demo
   credentials, you can't brand it — **you must give Supabase your OWN Google
   Client ID + Secret** (Fix A).
2. **The literal `…supabase.co` host text** that can appear ("to continue to
   zgtiviorskkcuzxnpvha.supabase.co") is the **auth endpoint's domain**. Google
   shows the host of the redirect URI. The only way to remove it is to serve
   Supabase Auth from your own domain (e.g. `auth.keyplayershq.com`) via the
   **Supabase Custom Domain** add-on (Fix B).

Do **Fix A** first — it's free and fixes 90% of the perception problem (real name
+ logo). Do **Fix B** only if the owner specifically wants the `supabase.co`
string gone; it's a paid add-on and needs DNS.

> Good news for us: sign-in only requests the **non-sensitive** `openid email
> profile` scopes. That means **no "unverified app" warning and no 100-user cap**
> apply (those only hit sensitive/restricted scopes like Gmail). See Verification
> notes — for our case, branding just needs a quick **brand verification**, not
> the multi-day security review.

---

## Fix A — Brand the consent screen (Google Cloud, dashboard-only, FREE)

This is the one that matters. ~10 minutes of dashboard clicks + a short automatic
brand-verification.

### A1. Use OUR own Google OAuth client (prerequisite) — Google Cloud + Supabase
Branding only applies to *our* Cloud project's client. If the Supabase Google
provider isn't already on our own client (it should be, per `google-signin.md`),
fix that first:

- **[Google Cloud]** https://console.cloud.google.com → our project →
  **APIs & Services → Credentials** → confirm there's an **OAuth 2.0 Client ID**
  (Web application) we own, with **Authorized redirect URI**:
  ```
  https://zgtiviorskkcuzxnpvha.supabase.co/auth/v1/callback
  ```
- **[Supabase]** Dashboard → **Authentication → Sign In / Providers → Google** →
  the **Client ID** and **Client Secret** must be **ours** (from the client
  above), not blank/shared. Save.

If those are already set (per the earlier google-signin runbook), you're good.

### A2. Open the Branding page — Google Cloud
- **[Google Cloud]** **APIs & Services → Google Auth Platform → Branding**.
  (Google renamed this in 2024; the old "OAuth consent screen" menu is now the
  **Google Auth Platform** section, split into three tabs: **Branding**,
  **Audience**, **Clients**.)
  - If the menu is missing: the project hasn't enabled any OAuth-capable API yet,
    or your account lacks **Owner/Editor**.

### A3. Set App information — Google Cloud
On the **Branding** tab → **App information**:
- **App name**: `KeyPlayers Command Center` (or `KeyPlayers`). This is the exact
  text users see ("**KeyPlayers Command Center** wants to access…"). Don't use
  names that could be confused with Google's brands.
- **User support email**: an address you control (e.g. `support@keyplayershq.com`
  or `brayson@keyplayershq.com`). Shown after the app name is selected.
- **App logo**: square **PNG/JPG, min 120×120px**. Optional but strongly
  recommended — appears on the consent screen and in the user's "third-party apps
  with account access" list. **Note: the logo (and to be safe, the name) only
  display once brand verification passes** — see A6.

### A4. Set App domain / links — Google Cloud
Under **App domain**:
- **Application home page**: `https://command.keyplayershq.com` (must be a live,
  public URL — not the login page).
- **Privacy policy link**: e.g. `https://command.keyplayershq.com/privacy`
  (or the marketing site). Required for External apps; must be live.
- **Terms of service link**: optional but recommended,
  e.g. `https://command.keyplayershq.com/terms`.

### A5. Authorized domains + developer contact — Google Cloud
- **Authorized domains**: add `keyplayershq.com` (the registrable domain — covers
  `command.keyplayershq.com` and `auth.keyplayershq.com`). Every URL above
  (home/privacy/ToS) and the redirect URI host must live under an authorized
  domain.
- **Developer contact information**: your email (Google uses it for notices).
- Save.

### A6. Verify branding — Google Cloud
- On the **Branding** page, if a **"Verify Branding"** / **"Publish app"** /
  **"Prepare for verification"** button appears, click it.
- For our **non-sensitive scopes** (`openid email profile`), brand verification is
  lightweight and **usually completes in a few minutes**. Until it passes, Google
  may show only the domain rather than the logo/name.
- Make sure **Audience** tab → publishing status is **In production** (External)
  so it's not stuck in Testing.

**After A:** the consent screen reads **"KeyPlayers Command Center"** with our
logo. It may still show the `…supabase.co` host in the "to continue to …" line —
that's Fix B.

---

## Fix B — Remove the `supabase.co` host text (Custom Auth Domain, PAID + DNS)

Only do this if the owner wants the literal `zgtiviorskkcuzxnpvha.supabase.co`
gone. This serves Supabase Auth from **`auth.keyplayershq.com`** so the consent
screen's "to continue to …" shows our domain.

> **Paid:** Supabase **Custom Domain** is a **paid add-on**, available only on a
> **paid plan (Pro+)**. Billed **hourly**, **not** covered by the Spend Cap. One
> custom domain per project.

### B1. Pick the host
Use `auth.keyplayershq.com` for the auth endpoint. (You *could* point the whole
Supabase URL at a custom domain, but a dedicated `auth.` subdomain is cleanest and
keeps `command.keyplayershq.com` for the app itself.)

### B2. Start the custom domain — Supabase
- **[Supabase]** Dashboard → **Project Settings → General → Custom Domains** →
  enable the add-on and enter `auth.keyplayershq.com`.
- Or **[CLI]**:
  ```bash
  supabase domains create --project-ref zgtiviorskkcuzxnpvha --custom-hostname auth.keyplayershq.com
  ```
  This prints the **CNAME target** and a **TXT challenge value**.

### B3. Add DNS records — DNS provider (registrar / Cloudflare / Route53 …)
- **CNAME**: `auth.keyplayershq.com` → the target Supabase gives you
  (typically `zgtiviorskkcuzxnpvha.supabase.co`, but use the exact value shown).
- **TXT**: `_acme-challenge.auth.keyplayershq.com` → the token Supabase gives you
  (used for the SSL cert via ACME).
- **Cloudflare gotcha:** set the CNAME to **DNS only (grey cloud)**, NOT proxied
  (orange). Supabase terminates its own SSL; a second proxy breaks cert issuance
  and WebSockets.

### B4. Verify + activate — Supabase
- **[CLI]**:
  ```bash
  supabase domains reverify  --project-ref zgtiviorskkcuzxnpvha   # may need a few retries while DNS propagates
  supabase domains activate  --project-ref zgtiviorskkcuzxnpvha   # cuts over once cert is issued
  ```
- Or click **Verify** then **Activate** in the dashboard. SSL issuance can take up
  to ~30 min; DNS up to ~48h (usually 15–30 min). The old `supabase.co` URL keeps
  working until you activate, so there's no downtime window.

### B5. Add the NEW callback URL to Google — Google Cloud (REQUIRED)
Once auth is served from the custom domain, the OAuth redirect URI changes. **Add
the new one to the Google client** (keep the old one too, in addition):
- **[Google Cloud]** **APIs & Services → Credentials →** our OAuth client →
  **Authorized redirect URIs** → add:
  ```
  https://auth.keyplayershq.com/auth/v1/callback
  ```
  Keep `https://zgtiviorskkcuzxnpvha.supabase.co/auth/v1/callback` as well.

### B6. Point the app's auth requests at the custom domain — Supabase / app
- **[Supabase]** **Authentication → URL Configuration** → confirm **Site URL** =
  `https://command.keyplayershq.com` and the app callback
  `https://command.keyplayershq.com/auth/callback` is allow-listed (unchanged).
- The app's `NEXT_PUBLIC_SUPABASE_URL` can stay on `…supabase.co` (the two are
  interchangeable after activation), but to fully reflect the new auth host you
  may set it to the custom domain. Not required just for consent-screen branding.

**After B:** the consent screen reads **"KeyPlayers Command Center … to continue
to auth.keyplayershq.com"** — fully branded, no `supabase.co`.

---

## Verification notes

- **Our scopes are non-sensitive.** Sign-in uses only `openid email profile`, so:
  - **No "Google hasn't verified this app" warning** and **no permanent 100-user
    cap** — those apply only to **sensitive/restricted** scopes (Gmail, Drive,
    Calendar, YouTube, etc.). The *Nango/YouTube* client (separate, see
    `nango-oauth-setup.md`) DOES hit those and needs full verification; this
    sign-in client does not.
  - Branding just needs the quick **brand verification** (A6), typically minutes.
- **Re-submit on change:** if you later change the app name, logo, home page,
  privacy URL, or authorized domains, Google requires re-verification before the
  new values display.
- **Don't trigger the heavy review by accident:** keep this sign-in client's
  scopes limited to `openid email profile`. Adding any sensitive scope here would
  pull in the 2–3 business-day security review and the unverified-app screen.
- **Internal vs External:** if every signing-in account were inside one Google
  Workspace org you could publish **Internal** and skip warnings entirely — not
  our case (clients use arbitrary Google accounts), so we stay **External**.

---

## Checklist

**Fix A — branding (FREE, ~10 min, no DNS):**
- [ ] [Supabase] Google provider uses OUR Client ID + Secret (not shared/demo)
- [ ] [Google Cloud] Branding → App name = `KeyPlayers Command Center`
- [ ] [Google Cloud] Branding → support email set (you control it)
- [ ] [Google Cloud] Branding → square logo ≥120×120 uploaded
- [ ] [Google Cloud] Home `https://command.keyplayershq.com` + privacy URL (live)
- [ ] [Google Cloud] Authorized domain `keyplayershq.com` + developer contact
- [ ] [Google Cloud] Audience = In production; click Verify Branding; wait for pass
- [ ] Test: logout → /login → Continue with Google → screen shows "KeyPlayers…"

**Fix B — remove supabase.co (PAID add-on + DNS, optional):**
- [ ] [Supabase] Enable Custom Domain add-on (paid plan) for `auth.keyplayershq.com`
- [ ] [DNS] CNAME `auth.keyplayershq.com` → Supabase target (Cloudflare: grey cloud)
- [ ] [DNS] TXT `_acme-challenge.auth.keyplayershq.com` → ACME token
- [ ] [Supabase] reverify → activate (SSL issued)
- [ ] [Google Cloud] Add redirect URI `https://auth.keyplayershq.com/auth/v1/callback` (keep old one)
- [ ] Test: consent screen now reads "to continue to auth.keyplayershq.com"

---

## Sources
- [Manage OAuth App Branding — Google Cloud Help](https://support.google.com/cloud/answer/15549049?hl=en)
- [Google OAuth Consent Screen: Setup, Fixes & Why It's Not Showing (2026) — Unipile](https://www.unipile.com/google-oauth-consent-screen/)
- [Submit for brand verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Supabase Custom Domains — Docs](https://supabase.com/docs/guides/platform/custom-domains)
- [Supabase Custom Domains — feature/pricing](https://supabase.com/features/custom-domains)
- [Supabase CLI — manage custom domains](https://supabase.com/docs/reference/cli/supabase-domains)
- [Unverified apps — Google Cloud Help](https://support.google.com/cloud/answer/7454865?hl=en)
- [Google OAuth 100 User Limit (2026) — Unipile](https://www.unipile.com/google-oauth-100-user-limit/)
