# Google sign-in — operator setup (Supabase OAuth)

The login page has a **Continue with Google** button wired through Supabase Auth.
The code path is live; nothing works until **you** create a Google OAuth client and
enable the provider in the Supabase dashboard. Until then the button shows a
friendly "Google sign-in isn't enabled yet" message — it never crashes.

> Note: this is a DIFFERENT OAuth client from the Nango/YouTube one in
> [nango-oauth-setup.md](./nango-oauth-setup.md). That one lets agents act on a
> connected YouTube account; this one signs users **into the app**. Keep them
> separate (separate redirect URIs, and sign-in needs no sensitive scopes).

## 1. Google Cloud — create the OAuth client
1. https://console.cloud.google.com → pick (or create) a project → **APIs & Services → Credentials**
2. If prompted, configure the **OAuth consent screen** first: External, app name +
   support email. Sign-in only needs the default `openid email profile` scopes —
   no sensitive-scope review required.
3. **Create Credentials → OAuth client ID → Web application**
4. **Authorized redirect URI** — exactly one, and it's Supabase's (NOT the app's):
   ```
   https://<supabase-project-ref>.supabase.co/auth/v1/callback
   ```
   (`<supabase-project-ref>` is the subdomain in `NEXT_PUBLIC_SUPABASE_URL`.)
5. Copy the **Client ID** and **Client Secret**.

## 2. Supabase dashboard — enable the provider
1. **Authentication → Providers (Sign In / Up) → Google** → toggle **Enable**
2. Paste the Client ID + Client Secret → Save.

## 3. Supabase dashboard — allow the app's callback URL
The app sends users back to `https://<app-origin>/auth/callback` after Google, and
Supabase only follows redirects on its allow-list:

1. **Authentication → URL Configuration**
2. **Site URL**: the production origin (e.g. `https://app.keyplayershq.com`)
3. **Redirect URLs**: add every origin you sign in from, e.g.
   ```
   https://<app-origin>/auth/callback
   http://localhost:3000/auth/callback
   ```
   (A wildcard like `https://<app-origin>/**` also works.)

## 4. Verify
- Log out → `/login` → **Continue with Google** with an **already-invited** account
  → you should land back on the dashboard, in your workspace.
- Try a Google account that was never invited → you should be bounced back to
  `/login` with **"No workspace yet — ask your admin for an invite"**, signed out.

## How it behaves (invite-only)
- **Existing invited users**: Supabase matches the Google identity to the existing
  user **by email** and links the accounts automatically (the email must be
  confirmed on the existing user — admin-invited users are). Their workspace and
  `tenant_id` claim carry over; password login keeps working alongside Google.
- **Brand-new users**: Google sign-in technically authenticates them, but this
  platform is invite-only — they have no `workspace_members` row and no tenant
  claim. The server-side callback (`src/app/auth/callback/route.ts`) detects this,
  signs them out, and returns them to `/login` with a clear "ask your admin for an
  invite" message. They never see an empty/broken dashboard.
- Sign-in errors from Google/Supabase (denied consent, misconfig) surface inline
  on the login page via `/login?error=…`.
