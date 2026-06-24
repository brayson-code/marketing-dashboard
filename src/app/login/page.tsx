'use client';

import { Suspense, useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';

// Official Google "G" mark (brand guidelines require the four-color logo on
// sign-in buttons). Inline so we don't ship another asset request.
function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="#4285F4" d="M23.49 12.27c0-.79-.07-1.54-.19-2.27H12v4.51h6.47c-.29 1.48-1.14 2.73-2.4 3.58v3h3.86c2.26-2.09 3.56-5.17 3.56-8.82z" />
      <path fill="#34A853" d="M12 24c3.24 0 5.95-1.08 7.93-2.91l-3.86-3c-1.08.72-2.45 1.16-4.07 1.16-3.13 0-5.78-2.11-6.73-4.96H1.29v3.09C3.26 21.3 7.31 24 12 24z" />
      <path fill="#FBBC05" d="M5.27 14.29c-.25-.72-.38-1.49-.38-2.29s.14-1.57.38-2.29V6.62H1.29C.47 8.24 0 10.06 0 12s.47 3.76 1.29 5.38l3.98-3.09z" />
      <path fill="#EA4335" d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0 7.31 0 3.26 2.7 1.29 6.62l3.98 3.09c.95-2.85 3.6-4.96 6.73-4.96z" />
    </svg>
  );
}

function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);
  const router = useRouter();
  const searchParams = useSearchParams();

  useEffect(() => {
    const msg = searchParams.get('error');
    if (msg) setError(msg);
  }, [searchParams]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(signInError.message || 'Login failed');
        return;
      }

      const redirect = searchParams.get('from') || '/';
      router.push(redirect);
      router.refresh();
    } catch {
      setError('Connection error');
    } finally {
      setLoading(false);
    }
  }

  // Google OAuth via Supabase. The browser navigates to the Supabase /authorize
  // endpoint, which redirects through Google and back to /auth/callback (server-side
  // code exchange). `signInWithOAuth` builds that URL locally and never hits the
  // server, so a disabled provider would otherwise surface as a raw JSON error page —
  // we preflight the URL here to catch that case inline instead.
  async function handleGoogle() {
    setError('');
    setGoogleLoading(true);

    try {
      const supabase = createClient();
      const next = searchParams.get('from') || '/';
      const { data, error: oauthError } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
          skipBrowserRedirect: true, // we navigate ourselves after the preflight
        },
      });

      if (oauthError || !data?.url) {
        const msg = oauthError?.message || 'Google sign-in failed';
        setError(/not enabled/i.test(msg) ? "Google sign-in isn't enabled yet — use email and password for now." : msg);
        setGoogleLoading(false);
        return;
      }

      // Preflight: an enabled provider answers /authorize with a 302 to Google
      // (opaque to fetch, status 0); a disabled one returns a 4xx JSON error.
      try {
        const res = await fetch(data.url, { redirect: 'manual' });
        if (res.status >= 400) {
          const body = (await res.json().catch(() => null)) as { msg?: string; error_description?: string } | null;
          const msg = String(body?.msg || body?.error_description || '');
          setError(
            /not enabled/i.test(msg)
              ? "Google sign-in isn't enabled yet — use email and password for now."
              : msg || 'Google sign-in failed',
          );
          setGoogleLoading(false);
          return;
        }
      } catch {
        // Preflight blocked (CORS/network quirk) — fall through and let the
        // real navigation surface whatever the server says.
      }

      window.location.assign(data.url);
      // Keep the button in its loading state while the browser navigates away.
    } catch {
      setError('Connection error');
      setGoogleLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
          Email
        </label>
        <input
          id="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          autoComplete="email"
          autoFocus
          required
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-[var(--foreground)] mb-1.5">
          Password
        </label>
        <input
          id="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full px-3 py-2 rounded-lg border border-[var(--border)] bg-[var(--background)] text-[var(--foreground)] text-sm focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          autoComplete="current-password"
          required
        />
        <div className="mt-1.5 text-right">
          <Link
            href="/auth/reset-password"
            className="text-xs text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
          >
            Forgot password?
          </Link>
        </div>
      </div>

      {error && (
        <p className="text-sm text-[var(--destructive)] bg-[var(--destructive)]/10 px-3 py-2 rounded-lg">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full py-2.5 rounded-lg bg-[var(--primary)] text-[var(--primary-foreground)] text-sm font-medium hover:opacity-90 transition-opacity disabled:opacity-50"
      >
        {loading ? 'Signing in...' : 'Sign in'}
      </button>

      <div className="flex items-center gap-3" aria-hidden="true">
        <div className="h-px flex-1 bg-[var(--border)]" />
        <span className="text-xs text-[var(--muted-foreground)]">or</span>
        <div className="h-px flex-1 bg-[var(--border)]" />
      </div>

      {/* `.btn` carries the motion language (property-scoped transition + :active
          scale); inline min-height matches the primary button above, since the
          unlayered .btn rules win over Tailwind's layered utilities. */}
      <button
        type="button"
        onClick={handleGoogle}
        disabled={googleLoading}
        className="btn btn-ghost w-full"
        style={{ minHeight: 40 }}
      >
        <GoogleMark />
        {googleLoading ? 'Redirecting to Google...' : 'Continue with Google'}
      </button>
    </form>
  );
}

export default function LoginPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[var(--background)]">
      <div className="w-full max-w-sm p-8 rounded-xl border border-[var(--border)] bg-[var(--card)]">
        <div className="text-center mb-8">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/kp-logo.png" alt="KeyPlayers" width={56} height={56} className="mx-auto mb-4 w-14 h-14 object-contain" />
          {/* Inline type styles: the global unlayered `.text-h1` (Sora 600) reads
              heavy here. Geist at a calmer weight/size is cleaner for a sign-in card. */}
          <h1
            className="text-[var(--foreground)]"
            style={{ fontFamily: 'var(--font-geist), system-ui, sans-serif', fontSize: '1.25rem', fontWeight: 600, letterSpacing: '-0.012em' }}
          >
            KeyPlayers Command Center
          </h1>
          <p className="text-sm text-[var(--muted-foreground)] mt-1.5">Sign in to your workspace</p>
        </div>

        <Suspense fallback={<div className="h-48" />}>
          <LoginForm />
        </Suspense>
      </div>
    </div>
  );
}
